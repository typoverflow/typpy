use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::error::{AppError, AppResult};
use crate::frontmatter;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoInfo {
    pub root: PathBuf,
    pub name: String,
    pub hugo_config_kind: String, // "single", "split", "none"
}

#[derive(Debug, Serialize)]
pub struct ContentNode {
    pub name: String,
    pub path: PathBuf,
    pub kind: String, // "section" | "bundle" | "single"
    pub children: Vec<ContentNode>,
    pub title: Option<String>,
    pub date: Option<String>,
    pub draft: Option<bool>,
}

/// Detect whether a path looks like a Hugo project root.
pub fn detect(root: &Path) -> AppResult<RepoInfo> {
    if !root.is_dir() {
        return Err(AppError::msg(format!("not a directory: {}", root.display())));
    }
    let single_candidates = ["hugo.toml", "hugo.yaml", "hugo.yml", "hugo.json", "config.toml", "config.yaml", "config.yml", "config.json"];
    let has_single = single_candidates.iter().any(|f| root.join(f).is_file());
    let split_dir = root.join("config").join("_default");
    let has_split = split_dir.is_dir();
    if !has_single && !has_split {
        return Err(AppError::msg(format!(
            "no Hugo config found in {} (looked for hugo.{{toml,yaml,yml,json}}, config.{{toml,yaml,yml,json}}, or config/_default/)",
            root.display()
        )));
    }
    if !root.join("content").is_dir() {
        return Err(AppError::msg(format!("missing content/ directory in {}", root.display())));
    }
    let name = root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("hugo-blog")
        .to_string();
    let kind = if has_single { "single".into() } else { "split".into() };
    Ok(RepoInfo {
        root: root.to_path_buf(),
        name,
        hugo_config_kind: kind,
    })
}

/// Walk `content/` and return a section/bundle tree.
/// - A `content/<section>/<slug>/index.md` is a bundle.
/// - A `content/<section>/<slug>.md` is a single page.
/// - `_index.md` at any level represents the section/branch page itself.
pub fn content_tree(root: &Path) -> AppResult<Vec<ContentNode>> {
    let content = root.join("content");
    if !content.is_dir() {
        return Err(AppError::msg("content/ does not exist"));
    }
    let mut sections: Vec<ContentNode> = Vec::new();
    for entry in std::fs::read_dir(&content)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            sections.push(build_section(&path)?);
        }
    }
    // Add top-level markdown files (rare, but possible).
    for entry in std::fs::read_dir(&content)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && is_markdown(&path) && path.file_name().and_then(|s| s.to_str()) != Some("_index.md") {
            sections.push(load_single(&path)?);
        }
    }
    sections.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(sections)
}

fn build_section(dir: &Path) -> AppResult<ContentNode> {
    let mut children: Vec<ContentNode> = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let fname = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if path.is_dir() {
            let index = path.join("index.md");
            let underscore_index = path.join("_index.md");
            if index.is_file() {
                children.push(load_bundle(&path, &index)?);
            } else if underscore_index.is_file() {
                // Section with branch page; descend recursively.
                let mut sub = build_section(&path)?;
                if let Ok(meta) = read_post_meta(&underscore_index) {
                    sub.title = meta.title;
                    sub.date = meta.date;
                    sub.draft = meta.draft;
                }
                children.push(sub);
            } else {
                children.push(build_section(&path)?);
            }
        } else if path.is_file() && is_markdown(&path) && fname != "_index.md" {
            children.push(load_single(&path)?);
        }
    }
    children.sort_by(|a, b| match (b.date.as_deref(), a.date.as_deref()) {
        (Some(b), Some(a)) => b.cmp(a),
        _ => a.name.cmp(&b.name),
    });
    Ok(ContentNode {
        name: dir.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string(),
        path: dir.to_path_buf(),
        kind: "section".into(),
        children,
        title: None,
        date: None,
        draft: None,
    })
}

fn load_bundle(dir: &Path, index: &Path) -> AppResult<ContentNode> {
    let meta = read_post_meta(index).unwrap_or_default();
    Ok(ContentNode {
        name: dir.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string(),
        path: index.to_path_buf(),
        kind: "bundle".into(),
        children: Vec::new(),
        title: meta.title,
        date: meta.date,
        draft: meta.draft,
    })
}

fn load_single(file: &Path) -> AppResult<ContentNode> {
    let meta = read_post_meta(file).unwrap_or_default();
    Ok(ContentNode {
        name: file
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string(),
        path: file.to_path_buf(),
        kind: "single".into(),
        children: Vec::new(),
        title: meta.title,
        date: meta.date,
        draft: meta.draft,
    })
}

#[derive(Default)]
struct PostMeta {
    title: Option<String>,
    date: Option<String>,
    draft: Option<bool>,
}

fn read_post_meta(file: &Path) -> AppResult<PostMeta> {
    let raw = std::fs::read_to_string(file)?;
    let (fm, _body) = frontmatter::split(&raw);
    let value = fm.to_value()?;
    let title = value.get("title").and_then(|v| v.as_str()).map(|s| s.to_string());
    let date = value
        .get("date")
        .and_then(|v| match v {
            serde_yaml::Value::String(s) => Some(s.clone()),
            serde_yaml::Value::Number(n) => Some(n.to_string()),
            _ => None,
        });
    let draft = value.get("draft").and_then(|v| v.as_bool());
    Ok(PostMeta { title, date, draft })
}

fn is_markdown(p: &Path) -> bool {
    p.extension().and_then(|s| s.to_str()).map(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown")).unwrap_or(false)
}

#[derive(Debug, Serialize)]
pub struct PostDoc {
    pub path: PathBuf,
    pub bundle_dir: Option<PathBuf>,
    pub frontmatter_kind: String,
    pub frontmatter: serde_yaml::Value,
    pub body: String,
}

pub fn read_post(file: &Path) -> AppResult<PostDoc> {
    let raw = std::fs::read_to_string(file)?;
    let (fm, body) = frontmatter::split(&raw);
    let bundle_dir = if file.file_name().and_then(|s| s.to_str()) == Some("index.md") {
        file.parent().map(|p| p.to_path_buf())
    } else {
        None
    };
    Ok(PostDoc {
        path: file.to_path_buf(),
        bundle_dir,
        frontmatter_kind: fm.kind().to_string(),
        frontmatter: fm.to_value()?,
        body: body.to_string(),
    })
}

pub fn write_post(file: &Path, kind: &str, frontmatter: &serde_yaml::Value, body: &str) -> AppResult<()> {
    let out = frontmatter::join(kind, frontmatter, body)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(file, out)?;
    Ok(())
}

pub fn create_bundle(repo_root: &Path, section: &str, slug: &str, frontmatter: &serde_yaml::Value) -> AppResult<PathBuf> {
    let bundle = repo_root.join("content").join(section).join(slug);
    if bundle.exists() {
        return Err(AppError::msg(format!("already exists: {}", bundle.display())));
    }
    std::fs::create_dir_all(&bundle)?;
    let index = bundle.join("index.md");
    write_post(&index, "yaml", frontmatter, "\n")?;
    Ok(index)
}

#[allow(dead_code)]
pub fn walk_orphan_assets(_root: &Path) -> AppResult<Vec<PathBuf>> {
    // Reserved for future cleanup helpers.
    Ok(Vec::new())
}

#[allow(dead_code)]
pub fn list_bundle_assets(bundle_dir: &Path) -> AppResult<Vec<PathBuf>> {
    let mut out = Vec::new();
    for entry in WalkDir::new(bundle_dir).max_depth(1) {
        let e = entry?;
        if e.file_type().is_file() {
            let p = e.into_path();
            if !is_markdown(&p) {
                out.push(p);
            }
        }
    }
    Ok(out)
}
