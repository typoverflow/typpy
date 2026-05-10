use serde_yaml::Value;

use crate::error::{AppError, AppResult};

/// Split a markdown file into (frontmatter YAML, body markdown).
/// Supports `---` (YAML) and `+++` (TOML) fences. For TOML we return the raw
/// block as a string so the frontend can render it verbatim — Hugo accepts it
/// and we don't want to lose user formatting.
pub fn split(raw: &str) -> (FrontMatter, &str) {
    let trimmed_start = raw.trim_start_matches('\u{feff}');
    if let Some(rest) = trimmed_start.strip_prefix("---\n").or_else(|| trimmed_start.strip_prefix("---\r\n")) {
        if let Some(end_idx) = find_fence(rest, "---") {
            let (yaml, body) = rest.split_at(end_idx);
            let body = strip_fence(body, "---");
            return (FrontMatter::Yaml(yaml.to_string()), body);
        }
    }
    if let Some(rest) = trimmed_start.strip_prefix("+++\n").or_else(|| trimmed_start.strip_prefix("+++\r\n")) {
        if let Some(end_idx) = find_fence(rest, "+++") {
            let (toml, body) = rest.split_at(end_idx);
            let body = strip_fence(body, "+++");
            return (FrontMatter::Toml(toml.to_string()), body);
        }
    }
    (FrontMatter::None, raw)
}

fn find_fence(s: &str, fence: &str) -> Option<usize> {
    for (i, line) in line_indices(s) {
        if line.trim_end() == fence {
            return Some(i);
        }
    }
    None
}

fn line_indices(s: &str) -> impl Iterator<Item = (usize, &str)> {
    let mut idx = 0usize;
    std::iter::from_fn(move || {
        if idx >= s.len() {
            return None;
        }
        let start = idx;
        let rest = &s[idx..];
        match rest.find('\n') {
            Some(nl) => {
                idx += nl + 1;
                Some((start, &rest[..nl]))
            }
            None => {
                idx = s.len();
                Some((start, rest))
            }
        }
    })
}

fn strip_fence<'a>(s: &'a str, fence: &str) -> &'a str {
    let pat_lf = format!("{fence}\n");
    let pat_crlf = format!("{fence}\r\n");
    if let Some(r) = s.strip_prefix(&pat_lf) {
        return r;
    }
    if let Some(r) = s.strip_prefix(&pat_crlf) {
        return r;
    }
    s.strip_prefix(fence).unwrap_or(s)
}

#[derive(Debug, Clone)]
pub enum FrontMatter {
    Yaml(String),
    Toml(String),
    None,
}

impl FrontMatter {
    pub fn to_value(&self) -> AppResult<Value> {
        match self {
            FrontMatter::Yaml(s) => Ok(serde_yaml::from_str(s).unwrap_or(Value::Null)),
            FrontMatter::Toml(s) => {
                // Best-effort: surface raw text under a synthetic key so the UI
                // can fall back to a raw editor for TOML front matter.
                let mut m = serde_yaml::Mapping::new();
                m.insert(Value::String("__raw_toml__".into()), Value::String(s.clone()));
                Ok(Value::Mapping(m))
            }
            FrontMatter::None => Ok(Value::Null),
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            FrontMatter::Yaml(_) => "yaml",
            FrontMatter::Toml(_) => "toml",
            FrontMatter::None => "none",
        }
    }
}

/// Build a markdown document from a structured front-matter value + body.
/// `kind` is one of "yaml", "toml", "none". For "toml" we expect the caller
/// to provide a single-key mapping `{"__raw_toml__": "..."}` containing the
/// final TOML text (we preserve, not regenerate, the user's TOML).
pub fn join(kind: &str, frontmatter: &Value, body: &str) -> AppResult<String> {
    match kind {
        "yaml" => {
            if frontmatter.is_null() {
                return Ok(body.to_string());
            }
            let yaml = serde_yaml::to_string(frontmatter)?;
            let yaml = yaml.trim_end_matches('\n');
            Ok(format!("---\n{yaml}\n---\n\n{body}", yaml = yaml, body = body.trim_start_matches('\n')))
        }
        "toml" => {
            let raw = frontmatter
                .as_mapping()
                .and_then(|m| m.get(&Value::String("__raw_toml__".into())))
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::msg("toml front matter requires __raw_toml__ key"))?;
            let raw = raw.trim_end_matches('\n');
            Ok(format!("+++\n{raw}\n+++\n\n{body}", raw = raw, body = body.trim_start_matches('\n')))
        }
        "none" | "" => Ok(body.to_string()),
        other => Err(AppError::msg(format!("unknown front-matter kind: {other}"))),
    }
}
