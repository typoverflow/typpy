use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::imaging::CompressOptions;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
    #[serde(default)]
    pub recent_repos: Vec<PathBuf>,
    #[serde(default)]
    pub last_repo: Option<PathBuf>,
    #[serde(default = "default_image_opts")]
    pub image_defaults: SerializableCompressOptions,
    #[serde(default = "default_theme")]
    pub theme: String, // "system" | "light" | "dark"
    #[serde(default = "default_port")]
    pub hugo_port: u16,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SerializableCompressOptions {
    pub max_width: Option<u32>,
    pub quality: Option<u8>,
    pub format: Option<String>,
}

impl From<SerializableCompressOptions> for CompressOptions {
    fn from(s: SerializableCompressOptions) -> CompressOptions {
        CompressOptions {
            max_width: s.max_width,
            quality: s.quality,
            format: s.format,
        }
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            recent_repos: vec![],
            last_repo: None,
            image_defaults: default_image_opts(),
            theme: default_theme(),
            hugo_port: default_port(),
        }
    }
}

fn default_image_opts() -> SerializableCompressOptions {
    SerializableCompressOptions {
        max_width: Some(2000),
        quality: Some(85),
        format: Some("keep".into()),
    }
}
fn default_theme() -> String { "system".into() }
fn default_port() -> u16 { 1313 }

pub struct SettingsStore {
    pub path: PathBuf,
    pub inner: Mutex<Settings>,
}

impl SettingsStore {
    pub fn load(app: &AppHandle) -> AppResult<Self> {
        let dir = app
            .path()
            .app_config_dir()
            .map_err(|e| AppError::msg(format!("no app config dir: {e}")))?;
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("settings.json");
        let settings = if path.is_file() {
            let raw = std::fs::read_to_string(&path)?;
            serde_json::from_str(&raw).unwrap_or_default()
        } else {
            Settings::default()
        };
        Ok(Self {
            path,
            inner: Mutex::new(settings),
        })
    }

    pub fn get(&self) -> Settings {
        self.inner.lock().unwrap().clone()
    }

    pub fn update<F: FnOnce(&mut Settings)>(&self, f: F) -> AppResult<Settings> {
        let updated = {
            let mut s = self.inner.lock().unwrap();
            f(&mut s);
            s.clone()
        };
        let json = serde_json::to_string_pretty(&updated)?;
        std::fs::write(&self.path, json)?;
        Ok(updated)
    }

    pub fn remember_repo(&self, repo: &Path) -> AppResult<Settings> {
        self.update(|s| {
            s.last_repo = Some(repo.to_path_buf());
            s.recent_repos.retain(|p| p != repo);
            s.recent_repos.insert(0, repo.to_path_buf());
            s.recent_repos.truncate(8);
        })
    }
}
