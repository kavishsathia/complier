//! Claude Code extension.
//!
//! Top-level commands dispatch into:
//! - `setup()`:    writes hook entries into Claude Code's settings.json
//! - `run_hook()`: handles a hook event read from stdin

mod contract;
mod hook;
mod setup;

pub fn setup() -> i32 {
    setup::run()
}

pub fn run_hook() -> i32 {
    hook::run()
}
