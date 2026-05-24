//! Claude Code extension.
//!
//! Top-level commands dispatch into:
//! - `setup()`:    writes hook entries into Claude Code's settings.json
//! - `run_hook()`: handles a hook event read from stdin

mod contract;
mod hook;

pub fn setup() -> i32 {
    // TODO: implemented in the install commit.
    eprintln!("complier install cc: not yet implemented");
    1
}

pub fn run_hook() -> i32 {
    hook::run()
}
