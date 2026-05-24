//! `complier install cc`: write Claude Code hook entries into settings.json.
//!
//! Writes to `<cwd>/.claude/settings.json`. Merges with whatever's already
//! there — existing hooks for other events are preserved, and we don't add
//! a duplicate `complier hook cc` entry on a second run.

use std::fs;
use std::io;
use std::path::Path;

use serde_json::{json, Value};

const COMMAND: &str = "complier hook cc";
const EVENTS_WITH_MATCHER: [&str; 2] = ["PreToolUse", "PostToolUse"];
const EVENTS_WITHOUT_MATCHER: [&str; 1] = ["SessionStart"];

pub fn run() -> i32 {
    let cwd = match std::env::current_dir() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("complier install cc: cannot read cwd: {e}");
            return 1;
        }
    };
    let settings_path = cwd.join(".claude").join("settings.json");
    match install_at(&settings_path) {
        Ok(action) => {
            println!("complier install cc: {action} {}", settings_path.display());
            0
        }
        Err(e) => {
            eprintln!("complier install cc: {e}");
            1
        }
    }
}

#[derive(Debug)]
enum InstallError {
    Io(io::Error),
    Json(String),
}

impl std::fmt::Display for InstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InstallError::Io(e) => write!(f, "{e}"),
            InstallError::Json(s) => write!(f, "settings.json: {s}"),
        }
    }
}

impl From<io::Error> for InstallError {
    fn from(e: io::Error) -> Self {
        InstallError::Io(e)
    }
}

fn install_at(path: &Path) -> Result<&'static str, InstallError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let (mut settings, existed) = read_or_default(path)?;
    let hooks = settings
        .as_object_mut()
        .and_then(|m| {
            m.entry("hooks").or_insert_with(|| json!({}));
            m["hooks"].as_object_mut()
        })
        .ok_or_else(|| InstallError::Json("top-level must be an object".into()))?;

    let mut changed = false;
    for event in EVENTS_WITH_MATCHER {
        if ensure_matcher_event(hooks, event)? {
            changed = true;
        }
    }
    for event in EVENTS_WITHOUT_MATCHER {
        if ensure_simple_event(hooks, event)? {
            changed = true;
        }
    }

    if !changed && existed {
        return Ok("already installed at");
    }

    let serialized = serde_json::to_string_pretty(&settings)
        .map_err(|e| InstallError::Json(format!("serialize: {e}")))?;
    fs::write(path, format!("{serialized}\n"))?;
    Ok(if existed { "updated" } else { "wrote" })
}

fn read_or_default(path: &Path) -> Result<(Value, bool), InstallError> {
    match fs::read_to_string(path) {
        Ok(contents) => {
            let trimmed = contents.trim();
            if trimmed.is_empty() {
                return Ok((json!({}), true));
            }
            let parsed: Value = serde_json::from_str(trimmed)
                .map_err(|e| InstallError::Json(format!("parse: {e}")))?;
            if !parsed.is_object() {
                return Err(InstallError::Json("top-level must be an object".into()));
            }
            Ok((parsed, true))
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok((json!({}), false)),
        Err(e) => Err(InstallError::Io(e)),
    }
}

/// PreToolUse / PostToolUse style: array of matcher groups.
/// Returns true if we added our hook (i.e. file needs rewriting).
fn ensure_matcher_event(
    hooks: &mut serde_json::Map<String, Value>,
    event: &str,
) -> Result<bool, InstallError> {
    let entry = hooks.entry(event).or_insert_with(|| json!([]));
    let arr = entry
        .as_array_mut()
        .ok_or_else(|| InstallError::Json(format!("{event} must be an array")))?;

    if matcher_group_has_command(arr, "") {
        return Ok(false);
    }

    arr.push(json!({
        "matcher": "",
        "hooks": [
            {"type": "command", "command": COMMAND}
        ]
    }));
    Ok(true)
}

/// SessionStart style: array of hook groups (no matcher).
fn ensure_simple_event(
    hooks: &mut serde_json::Map<String, Value>,
    event: &str,
) -> Result<bool, InstallError> {
    let entry = hooks.entry(event).or_insert_with(|| json!([]));
    let arr = entry
        .as_array_mut()
        .ok_or_else(|| InstallError::Json(format!("{event} must be an array")))?;

    if simple_group_has_command(arr) {
        return Ok(false);
    }

    arr.push(json!({
        "hooks": [
            {"type": "command", "command": COMMAND}
        ]
    }));
    Ok(true)
}

fn matcher_group_has_command(groups: &[Value], matcher: &str) -> bool {
    groups.iter().any(|group| {
        group_matcher(group) == matcher
            && group_hook_commands(group).any(|c| c == COMMAND)
    })
}

fn simple_group_has_command(groups: &[Value]) -> bool {
    groups
        .iter()
        .any(|group| group_hook_commands(group).any(|c| c == COMMAND))
}

fn group_matcher(group: &Value) -> &str {
    group.get("matcher").and_then(Value::as_str).unwrap_or("")
}

fn group_hook_commands(group: &Value) -> impl Iterator<Item = &str> {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .map(|hs| {
            hs.iter()
                .filter_map(|h| h.get("command").and_then(Value::as_str))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
        .into_iter()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::path::PathBuf;

    fn tmpdir(name: &str) -> PathBuf {
        let mut p = env::temp_dir();
        p.push(format!("complier-install-test-{}-{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn creates_settings_when_absent() {
        let dir = tmpdir("absent");
        let path = dir.join(".claude").join("settings.json");
        let action = install_at(&path).unwrap();
        assert_eq!(action, "wrote");
        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("complier hook cc"));
        assert!(raw.contains("PreToolUse"));
        assert!(raw.contains("PostToolUse"));
        assert!(raw.contains("SessionStart"));
    }

    #[test]
    fn second_install_is_idempotent() {
        let dir = tmpdir("idempotent");
        let path = dir.join(".claude").join("settings.json");
        install_at(&path).unwrap();
        let action = install_at(&path).unwrap();
        assert_eq!(action, "already installed at");
    }

    #[test]
    fn preserves_existing_unrelated_settings() {
        let dir = tmpdir("preserve");
        let path = dir.join(".claude").join("settings.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"someOtherKey": "untouched", "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "other-tool"}]}]}}"#,
        )
        .unwrap();

        install_at(&path).unwrap();
        let parsed: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(parsed["someOtherKey"], json!("untouched"));
        let pre = parsed["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre.iter().any(|g| {
            g["hooks"][0]["command"] == "other-tool"
        }));
        assert!(pre.iter().any(|g| {
            g["hooks"][0]["command"] == "complier hook cc"
        }));
    }
}
