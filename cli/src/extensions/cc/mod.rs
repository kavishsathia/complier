//! Claude Code extension.
//!
//! Exposes two entry points for the top-level CLI:
//! - `setup()`: writes hook entries into Claude Code's settings.json.
//! - `run_hook()`: reads a hook event JSON from stdin and dispatches.

pub fn setup() -> i32 {
    // TODO: write hook entries into Claude Code settings.json.
    eprintln!("complier install cc: not yet implemented");
    1
}

pub fn run_hook() -> i32 {
    // TODO: read stdin, dispatch PreToolUse/PostToolUse/SessionStart.
    eprintln!("complier hook cc: not yet implemented");
    1
}
