//! `complier init` and `complier uninstall`.

use std::path::Path;
use std::time::Duration;

use serde_json::{json, Map, Value};

use crate::{daemon, launchd, paths};

const DEMO: &str = include_str!("demo.csp");
const EVENTS: [&str; 2] = ["PreToolUse", "PostToolUse"];

/// Hooks go in settings.local.json: the command holds this machine's
/// absolute path to the binary, which should not be committed.
const SETTINGS: &str = ".claude/settings.local.json";

pub fn run() -> i32 {
    match init() {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("complier init: {e}");
            1
        }
    }
}

fn init() -> Result<(), String> {
    let root = paths::repo_root().map_err(|e| e.to_string())?;
    let exe = std::env::current_exe()
        .and_then(|p| p.canonicalize())
        .map_err(|e| format!("cannot locate the complier binary: {e}"))?;
    let command = format!("{} hook", shell_quote(&exe.to_string_lossy()));

    let settings = root.join(SETTINGS);
    let changed = edit_settings(&settings, |hooks| add_hooks(hooks, &command))?;
    println!(
        "{} hooks in {}",
        if changed { "added" } else { "kept" },
        settings.display()
    );

    let contract = root.join(paths::CONTRACT);
    if contract.exists() {
        println!("kept existing contract {}", contract.display());
    } else {
        std::fs::create_dir_all(contract.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(&contract, DEMO).map_err(|e| e.to_string())?;
        println!("wrote demo contract {}", contract.display());
    }

    let plist = launchd::install(&exe)?;
    println!("installed LaunchAgent {}", plist.display());
    for _ in 0..15 {
        if daemon::request(&json!({ "op": "ping" })).is_ok() {
            println!("daemon running at {}", paths::socket().display());
            println!("\nRestart Claude Code in this repo to pick up the hooks.");
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Err(format!(
        "the daemon did not start; see {}",
        paths::log().display()
    ))
}

pub fn uninstall() -> i32 {
    if let Ok(root) = paths::repo_root() {
        let settings = root.join(SETTINGS);
        if settings.exists() {
            match edit_settings(&settings, remove_hooks) {
                Ok(true) => println!("removed hooks from {}", settings.display()),
                Ok(false) => {}
                Err(e) => eprintln!("complier uninstall: {e}"),
            }
        }
    }
    if launchd::uninstall() {
        println!("removed LaunchAgent {}", launchd::LABEL);
    }
    println!("left the contract file and {} in place", paths::home().display());
    0
}

fn shell_quote(s: &str) -> String {
    if s.chars().all(|c| c.is_ascii_alphanumeric() || "/._-".contains(c)) {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

fn is_ours(hook: &Value) -> bool {
    hook["command"].as_str().is_some_and(|c| c.contains("complier") && c.ends_with(" hook"))
}

/// Reads settings, lets `f` edit the hooks object, writes back if it changed.
fn edit_settings(path: &Path, f: impl Fn(&mut Map<String, Value>) -> bool) -> Result<bool, String> {
    let mut settings: Value = match std::fs::read_to_string(path) {
        Ok(s) if !s.trim().is_empty() => {
            serde_json::from_str(&s).map_err(|e| format!("{}: {e}", path.display()))?
        }
        _ => json!({}),
    };
    let root = settings
        .as_object_mut()
        .ok_or_else(|| format!("{}: top level must be an object", path.display()))?;
    let hooks = root
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| format!("{}: hooks must be an object", path.display()))?;
    if !f(hooks) {
        return Ok(false);
    }
    if hooks.is_empty() {
        root.remove("hooks");
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let out = serde_json::to_string_pretty(&settings).unwrap();
    std::fs::write(path, out + "\n").map_err(|e| e.to_string())?;
    Ok(true)
}

fn add_hooks(hooks: &mut Map<String, Value>, command: &str) -> bool {
    let mut changed = false;
    for event in EVENTS {
        let groups = hooks.entry(event).or_insert_with(|| json!([]));
        let Some(groups) = groups.as_array_mut() else { continue };
        let existing = groups
            .iter_mut()
            .flat_map(|g| g["hooks"].as_array_mut().into_iter().flatten())
            .find(|h| is_ours(h));
        match existing {
            Some(h) if h["command"] == command => {}
            Some(h) => {
                h["command"] = json!(command);
                changed = true;
            }
            None => {
                groups.push(json!({
                    "matcher": "*",
                    "hooks": [{ "type": "command", "command": command }],
                }));
                changed = true;
            }
        }
    }
    changed
}

fn remove_hooks(hooks: &mut Map<String, Value>) -> bool {
    let mut changed = false;
    for event in EVENTS {
        let Some(groups) = hooks.get_mut(event).and_then(Value::as_array_mut) else { continue };
        for g in groups.iter_mut() {
            if let Some(hs) = g["hooks"].as_array_mut() {
                let before = hs.len();
                hs.retain(|h| !is_ours(h));
                changed |= hs.len() != before;
            }
        }
        groups.retain(|g| g["hooks"].as_array().is_some_and(|h| !h.is_empty()));
        if groups.is_empty() {
            hooks.remove(event);
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_is_idempotent_and_keeps_other_hooks() {
        let mut settings = json!({
            "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "lint" }] }]
        });
        let hooks = settings.as_object_mut().unwrap();
        assert!(add_hooks(hooks, "/bin/complier hook"));
        assert!(!add_hooks(hooks, "/bin/complier hook"));
        assert_eq!(hooks["PreToolUse"].as_array().unwrap().len(), 2);
        assert!(add_hooks(hooks, "/new/complier hook"));
        assert_eq!(hooks["PreToolUse"][1]["hooks"][0]["command"], "/new/complier hook");
        assert!(remove_hooks(hooks));
        assert_eq!(hooks["PreToolUse"].as_array().unwrap().len(), 1);
        assert!(!hooks.contains_key("PostToolUse"));
    }
}
