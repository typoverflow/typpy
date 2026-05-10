use std::path::Path;
use std::process::Command;

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Serialize)]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFile>,
    pub remote_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GitFile {
    pub path: String,
    pub status: String, // "modified", "added", "deleted", "renamed", "untracked"
    pub staged: bool,
}

pub fn status(repo: &Path) -> AppResult<GitStatus> {
    if !repo.join(".git").exists() {
        return Ok(GitStatus {
            is_repo: false,
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            files: vec![],
            remote_url: None,
        });
    }
    let porcelain = run(repo, &["status", "--porcelain=v2", "--branch", "--untracked-files=all"])?;
    let mut branch = None;
    let mut upstream = None;
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut files = Vec::new();
    for line in porcelain.lines() {
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            branch = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("# branch.upstream ") {
            upstream = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            // format: +N -M
            let parts: Vec<&str> = rest.split_whitespace().collect();
            if parts.len() == 2 {
                ahead = parts[0].trim_start_matches('+').parse().unwrap_or(0);
                behind = parts[1].trim_start_matches('-').parse().unwrap_or(0);
            }
        } else if let Some(rest) = line.strip_prefix("1 ") {
            // Changed entries: XY ... path
            let parts: Vec<&str> = rest.splitn(9, ' ').collect();
            if parts.len() >= 9 {
                let xy = parts[0];
                let path = parts[8];
                files.push(GitFile {
                    path: path.to_string(),
                    status: status_letter(xy),
                    staged: xy.chars().next() != Some('.'),
                });
            }
        } else if let Some(rest) = line.strip_prefix("2 ") {
            // Renamed/copied entries.
            let parts: Vec<&str> = rest.splitn(10, ' ').collect();
            if parts.len() >= 10 {
                let xy = parts[0];
                let path_and_orig = parts[9];
                let path = path_and_orig.split('\t').next().unwrap_or(path_and_orig);
                files.push(GitFile {
                    path: path.to_string(),
                    status: "renamed".into(),
                    staged: xy.chars().next() != Some('.'),
                });
            }
        } else if let Some(rest) = line.strip_prefix("? ") {
            files.push(GitFile {
                path: rest.to_string(),
                status: "untracked".into(),
                staged: false,
            });
        }
    }
    let remote_url = run(repo, &["config", "--get", "remote.origin.url"]).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    Ok(GitStatus {
        is_repo: true,
        branch,
        upstream,
        ahead,
        behind,
        files,
        remote_url,
    })
}

fn status_letter(xy: &str) -> String {
    // First char = staged (X), second = unstaged (Y).
    let c = xy.chars().filter(|c| *c != '.').next().unwrap_or('?');
    match c {
        'M' => "modified".into(),
        'A' => "added".into(),
        'D' => "deleted".into(),
        'R' => "renamed".into(),
        'C' => "copied".into(),
        'U' => "conflicted".into(),
        _ => "modified".into(),
    }
}

pub fn pull(repo: &Path) -> AppResult<String> {
    run(repo, &["pull", "--ff-only"])
}

pub fn push(repo: &Path) -> AppResult<String> {
    run(repo, &["push"])
}

pub fn commit(repo: &Path, files: &[String], message: &str) -> AppResult<String> {
    if message.trim().is_empty() {
        return Err(AppError::msg("commit message is empty"));
    }
    // Reset stage to a known state — only stage what the user picked.
    // (Don't blow away their pre-existing index; instead use --pathspec args
    // for `git add` and only commit those paths via `git commit -- <files>`.)
    let mut add = vec!["add", "--"];
    let owned: Vec<String> = files.iter().cloned().collect();
    for f in &owned {
        add.push(f.as_str());
    }
    run(repo, &add)?;
    let mut cmt = vec!["commit", "-m", message, "--"];
    for f in &owned {
        cmt.push(f.as_str());
    }
    run(repo, &cmt)
}

pub fn discard(repo: &Path, file: &str) -> AppResult<()> {
    // For tracked files, checkout the index version. For untracked files, delete.
    let st = run(repo, &["status", "--porcelain", "--", file])?;
    if st.starts_with("??") {
        let target = repo.join(file);
        if target.is_file() {
            std::fs::remove_file(target)?;
        }
    } else {
        run(repo, &["checkout", "--", file])?;
    }
    Ok(())
}

fn run(repo: &Path, args: &[&str]) -> AppResult<String> {
    let out = Command::new("git").current_dir(repo).args(args).output().map_err(|e| AppError::msg(format!("git not found or failed to start: {e}")))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
        return Err(AppError::msg(format!("git {args:?} failed: {stderr}{stdout}").trim().to_string()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}
