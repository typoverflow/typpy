mod error;
mod frontmatter;
mod gitops;
mod hugo;
mod imaging;
mod repo;
mod settings;

use std::path::PathBuf;

use serde::Deserialize;
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::hugo::HugoState;
use crate::imaging::CompressOptions;
use crate::settings::SettingsStore;

// ---------- Settings ----------

#[tauri::command]
fn settings_get(store: State<'_, SettingsStore>) -> settings::Settings {
    store.get()
}

#[tauri::command]
fn settings_update(
    patch: serde_json::Value,
    store: State<'_, SettingsStore>,
) -> AppResult<settings::Settings> {
    store.update(|s| {
        if let serde_json::Value::Object(map) = &patch {
            let mut current = serde_json::to_value(&*s).unwrap_or(serde_json::Value::Null);
            if let serde_json::Value::Object(target) = &mut current {
                for (k, v) in map {
                    target.insert(k.clone(), v.clone());
                }
                if let Ok(parsed) = serde_json::from_value::<settings::Settings>(current) {
                    *s = parsed;
                }
            }
        }
    })
}

// ---------- Repo ----------

#[tauri::command]
fn repo_detect(path: PathBuf) -> AppResult<repo::RepoInfo> {
    repo::detect(&path)
}

#[tauri::command]
fn repo_open(path: PathBuf, store: State<'_, SettingsStore>) -> AppResult<repo::RepoInfo> {
    let info = repo::detect(&path)?;
    store.remember_repo(&info.root)?;
    Ok(info)
}

#[tauri::command]
fn repo_content_tree(root: PathBuf) -> AppResult<Vec<repo::ContentNode>> {
    repo::content_tree(&root)
}

#[tauri::command]
fn post_read(path: PathBuf) -> AppResult<repo::PostDoc> {
    repo::read_post(&path)
}

#[derive(Deserialize)]
struct WritePostArgs {
    path: PathBuf,
    kind: String,
    frontmatter: serde_yaml::Value,
    body: String,
}

#[tauri::command]
fn post_write(args: WritePostArgs) -> AppResult<()> {
    repo::write_post(&args.path, &args.kind, &args.frontmatter, &args.body)
}

#[derive(Deserialize)]
struct CreatePostArgs {
    repo_root: PathBuf,
    section: String,
    slug: String,
    frontmatter: serde_yaml::Value,
}

#[tauri::command]
fn post_create(args: CreatePostArgs) -> AppResult<PathBuf> {
    repo::create_bundle(&args.repo_root, &args.section, &args.slug, &args.frontmatter)
}

// ---------- Images ----------

#[derive(Deserialize)]
struct ImportImageArgs {
    src: PathBuf,
    bundle_dir: PathBuf,
    desired_stem: Option<String>,
    options: Option<CompressOptions>,
}

#[tauri::command]
fn image_import(args: ImportImageArgs) -> AppResult<imaging::CompressResult> {
    let opts = args.options.unwrap_or_default();
    let (rel, mut result) = imaging::import_into_bundle(
        &args.src,
        &args.bundle_dir,
        args.desired_stem.as_deref(),
        &opts,
    )?;
    result.path = PathBuf::from(rel);
    Ok(result)
}

#[derive(Deserialize)]
struct CompressInPlaceArgs {
    src: PathBuf,
    options: Option<CompressOptions>,
    overwrite: Option<bool>,
}

#[tauri::command]
fn image_compress(args: CompressInPlaceArgs) -> AppResult<imaging::CompressResult> {
    let opts = args.options.unwrap_or_default();
    let dst = if args.overwrite.unwrap_or(true) {
        args.src.clone()
    } else {
        let mut d = args.src.clone();
        let stem = d
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("image")
            .to_string();
        let ext = d.extension().and_then(|s| s.to_str()).unwrap_or("jpg").to_string();
        d.set_file_name(format!("{stem}-compressed.{ext}"));
        d
    };
    imaging::compress(&args.src, &dst, &opts)
}

// ---------- Git ----------

#[tauri::command]
fn git_status(repo_root: PathBuf) -> AppResult<gitops::GitStatus> {
    gitops::status(&repo_root)
}

#[tauri::command]
fn git_pull(repo_root: PathBuf) -> AppResult<String> {
    gitops::pull(&repo_root)
}

#[tauri::command]
fn git_push(repo_root: PathBuf) -> AppResult<String> {
    gitops::push(&repo_root)
}

#[derive(Deserialize)]
struct CommitArgs {
    repo_root: PathBuf,
    files: Vec<String>,
    message: String,
}

#[tauri::command]
fn git_commit(args: CommitArgs) -> AppResult<String> {
    gitops::commit(&args.repo_root, &args.files, &args.message)
}

#[derive(Deserialize)]
struct DiscardArgs {
    repo_root: PathBuf,
    file: String,
}

#[tauri::command]
fn git_discard(args: DiscardArgs) -> AppResult<()> {
    gitops::discard(&args.repo_root, &args.file)
}

// ---------- Hugo ----------

#[tauri::command]
fn hugo_detect() -> AppResult<hugo::HugoVersion> {
    hugo::detect()
}

#[tauri::command]
async fn hugo_start(
    app: AppHandle,
    state: State<'_, HugoState>,
    repo_root: PathBuf,
    port: Option<u16>,
) -> AppResult<u16> {
    hugo::start(app.clone(), &state, &repo_root, port.unwrap_or(1313)).await
}

#[tauri::command]
async fn hugo_stop(app: AppHandle, state: State<'_, HugoState>) -> AppResult<()> {
    hugo::stop(app, &state).await
}

#[tauri::command]
async fn hugo_status(state: State<'_, HugoState>) -> AppResult<Option<u16>> {
    Ok(hugo::is_running(&state).await)
}

// ---------- File system helpers ----------

#[tauri::command]
fn fs_exists(path: PathBuf) -> bool {
    path.exists()
}

#[tauri::command]
fn fs_read_text(path: PathBuf) -> AppResult<String> {
    std::fs::read_to_string(&path).map_err(|e| AppError::msg(format!("read {}: {e}", path.display())))
}

#[tauri::command]
fn fs_write_text(path: PathBuf, contents: String) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, contents)?;
    Ok(())
}

#[tauri::command]
fn fs_write_bytes(path: PathBuf, contents: Vec<u8>) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, contents)?;
    Ok(())
}

#[tauri::command]
fn fs_temp_path(filename: String) -> AppResult<PathBuf> {
    let dir = std::env::temp_dir();
    std::fs::create_dir_all(&dir)?;
    let safe: String = filename
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .collect();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    Ok(dir.join(format!("typy-{now}-{safe}")))
}

#[tauri::command]
fn fs_reveal(path: PathBuf) -> AppResult<()> {
    let _ = std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .status();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(HugoState::default())
        .setup(|app| {
            let handle = app.handle();
            let store = SettingsStore::load(handle).expect("failed to load settings");
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings_get,
            settings_update,
            repo_detect,
            repo_open,
            repo_content_tree,
            post_read,
            post_write,
            post_create,
            image_import,
            image_compress,
            git_status,
            git_pull,
            git_push,
            git_commit,
            git_discard,
            hugo_detect,
            hugo_start,
            hugo_stop,
            hugo_status,
            fs_exists,
            fs_read_text,
            fs_write_text,
            fs_write_bytes,
            fs_temp_path,
            fs_reveal
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
