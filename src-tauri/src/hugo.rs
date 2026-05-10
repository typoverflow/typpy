use std::net::TcpListener;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;

use crate::error::{AppError, AppResult};

struct ActiveSession {
    kill_tx: oneshot::Sender<()>,
    handle: JoinHandle<()>,
    port: u16,
}

#[derive(Default)]
pub struct HugoState {
    inner: Arc<Mutex<Option<ActiveSession>>>,
}

#[derive(Debug, Serialize, Clone)]
pub struct HugoVersion {
    pub version: String,
    pub extended: bool,
    pub path: String,
}

pub fn detect() -> AppResult<HugoVersion> {
    let path = which("hugo")
        .ok_or_else(|| AppError::msg("`hugo` not found on PATH. Install with `brew install hugo`."))?;
    let out = std::process::Command::new(&path)
        .arg("version")
        .env("PATH", user_path())
        .output()?;
    if !out.status.success() {
        return Err(AppError::msg(format!(
            "hugo version failed: {}",
            String::from_utf8_lossy(&out.stderr)
        )));
    }
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    let extended = text.contains("extended");
    let version = text
        .split_whitespace()
        .find(|tok| tok.starts_with('v'))
        .unwrap_or("v?.?.?")
        .to_string();
    Ok(HugoVersion { version, extended, path })
}

fn user_path() -> String {
    let extra = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin";
    let home_bins = std::env::var("HOME")
        .map(|h| format!("{h}/.cargo/bin:{h}/go/bin:{h}/.local/bin"))
        .unwrap_or_default();
    let current = std::env::var("PATH").unwrap_or_default();
    let from_shell = std::process::Command::new("/bin/zsh")
        .arg("-lc")
        .arg("printf %s \"$PATH\"")
        .output()
        .ok()
        .and_then(|o| if o.status.success() { Some(String::from_utf8_lossy(&o.stdout).into_owned()) } else { None })
        .unwrap_or_default();
    let parts = [from_shell.as_str(), extra, home_bins.as_str(), current.as_str()];
    let mut seen = std::collections::HashSet::new();
    let mut out = String::new();
    for chunk in parts.iter() {
        for p in chunk.split(':') {
            let p = p.trim();
            if p.is_empty() {
                continue;
            }
            if seen.insert(p.to_string()) {
                if !out.is_empty() {
                    out.push(':');
                }
                out.push_str(p);
            }
        }
    }
    out
}

fn which(cmd: &str) -> Option<String> {
    let out = std::process::Command::new("/bin/sh")
        .arg("-lc")
        .arg(format!("command -v {cmd}"))
        .env("PATH", user_path())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

/// Check whether `port` is free for binding on 127.0.0.1.
fn port_is_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Find PIDs listening on the given localhost TCP port.
fn pids_on_port(port: u16) -> Vec<u32> {
    let out = std::process::Command::new("/usr/sbin/lsof")
        .args(["-ti", &format!("tcp:{port}"), "-sTCP:LISTEN"])
        .output();
    let Ok(out) = out else { return Vec::new() };
    if !out.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.trim().parse::<u32>().ok())
        .collect()
}

fn process_name(pid: u32) -> Option<String> {
    let out = std::process::Command::new("/bin/ps")
        .args(["-p", &pid.to_string(), "-o", "comm="])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

/// Try to free `port` by killing any hugo process holding it. Only kills
/// processes whose executable basename is `hugo` — never anything else,
/// to avoid clobbering unrelated apps.
fn release_hugo_port(port: u16, app: &AppHandle) -> AppResult<bool> {
    let pids = pids_on_port(port);
    if pids.is_empty() {
        return Ok(false);
    }
    let mut killed_any = false;
    for pid in pids {
        let name = process_name(pid).unwrap_or_default();
        let is_hugo = name == "hugo"
            || name.ends_with("/hugo")
            || std::path::Path::new(&name).file_name().and_then(|s| s.to_str()) == Some("hugo");
        if !is_hugo {
            return Err(AppError::msg(format!(
                "port {port} is held by `{name}` (PID {pid}) — not a hugo process, refusing to kill. Free the port manually or change the configured port."
            )));
        }
        let _ = app.emit(
            "hugo:log",
            LogLine {
                stream: "info".into(),
                line: format!("found orphan hugo PID {pid} on :{port} — terminating"),
            },
        );
        // SIGTERM first.
        let _ = std::process::Command::new("/bin/kill")
            .args(["-TERM", &pid.to_string()])
            .status();
        // Wait up to ~1s for it to die.
        let mut died = false;
        for _ in 0..20 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let alive = std::process::Command::new("/bin/kill")
                .args(["-0", &pid.to_string()])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if !alive {
                died = true;
                break;
            }
        }
        if !died {
            // Force-kill.
            let _ = std::process::Command::new("/bin/kill")
                .args(["-KILL", &pid.to_string()])
                .status();
            let _ = app.emit(
                "hugo:log",
                LogLine { stream: "info".into(), line: format!("PID {pid} did not respond to TERM — sent KILL") },
            );
        }
        killed_any = true;
    }
    // Give the kernel a moment to release the port after the process dies.
    if killed_any {
        for _ in 0..20 {
            if port_is_free(port) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
    Ok(killed_any)
}

pub async fn start(app: AppHandle, state: &HugoState, repo: &Path, port: u16) -> AppResult<u16> {
    // If there's already a session, refuse — caller should stop first.
    {
        let guard = state.inner.lock().await;
        if guard.is_some() {
            return Err(AppError::msg("hugo server is already running"));
        }
    }

    let hugo_path = detect()?.path;
    let path_env = user_path();

    // If the requested port is held by an orphan hugo (e.g. from a previous
    // force-quit of this app), free it before spawning a fresh server. We
    // refuse to kill anything that isn't a hugo process.
    if !port_is_free(port) {
        let app_for_kill = app.clone();
        let killed = release_hugo_port(port, &app_for_kill)?;
        if !killed {
            return Err(AppError::msg(format!(
                "port {port} is in use but the holder couldn't be identified. Run `lsof -i :{port}` to investigate."
            )));
        }
        if !port_is_free(port) {
            return Err(AppError::msg(format!(
                "port {port} is still busy after killing orphan(s) — try again in a moment."
            )));
        }
    }

    let mut child = TokioCommand::new(&hugo_path)
        .current_dir(repo)
        .env("PATH", &path_env)
        .args([
            "server",
            "-D",
            "--port",
            &port.to_string(),
            "--bind",
            "127.0.0.1",
            "--disableFastRender",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| AppError::msg(format!("failed to spawn hugo: {e}")))?;

    let _ = app.emit(
        "hugo:log",
        LogLine {
            stream: "info".into(),
            line: format!("$ {} server -D --port {}", hugo_path, port),
        },
    );

    if let Some(stdout) = child.stdout.take() {
        let app2 = app.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app2.emit("hugo:log", LogLine { stream: "stdout".into(), line });
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app2 = app.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let _ = app2.emit("hugo:log", LogLine { stream: "stderr".into(), line });
            }
        });
    }

    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    let state_arc = state.inner.clone();
    let app2 = app.clone();
    // Spawn the watcher and keep its JoinHandle so stop() can await its cleanup.
    let handle = tokio::spawn(async move {
        tokio::select! {
            wait = child.wait() => {
                if let Ok(status) = wait {
                    let _ = app2.emit(
                        "hugo:log",
                        LogLine {
                            stream: "info".into(),
                            line: format!("hugo exited with status {}", status),
                        },
                    );
                }
            }
            _ = kill_rx => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                let _ = app2.emit(
                    "hugo:log",
                    LogLine { stream: "info".into(), line: "hugo stopped".into() },
                );
            }
        }
        {
            let mut guard = state_arc.lock().await;
            *guard = None;
        }
        let _ = app2.emit("hugo:state", HugoEvent { running: false, port: None });
    });

    {
        let mut guard = state.inner.lock().await;
        *guard = Some(ActiveSession { kill_tx, handle, port });
    }
    let _ = app.emit("hugo:state", HugoEvent { running: true, port: Some(port) });

    Ok(port)
}

pub async fn stop(app: AppHandle, state: &HugoState) -> AppResult<()> {
    let session = {
        let mut guard = state.inner.lock().await;
        guard.take()
    };
    if let Some(s) = session {
        // Send kill signal; the watcher will receive it, kill the child, wait
        // for it to fully terminate, then exit. Await its completion here so
        // a subsequent start() doesn't race on the same port.
        let _ = s.kill_tx.send(());
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), s.handle).await;
    }
    let _ = app.emit("hugo:state", HugoEvent { running: false, port: None });
    Ok(())
}

pub async fn is_running(state: &HugoState) -> Option<u16> {
    let guard = state.inner.lock().await;
    guard.as_ref().map(|s| s.port)
}

#[derive(Serialize, Clone)]
struct LogLine {
    stream: String,
    line: String,
}

#[derive(Serialize, Clone)]
struct HugoEvent {
    running: bool,
    port: Option<u16>,
}
