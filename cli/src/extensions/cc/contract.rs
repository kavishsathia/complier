//! Locate the .cpl contract for a Claude Code session.
//!
//! Resolution order (mirrors extensions/cc/contract.py):
//!   1. $CC_CONTRACT environment variable
//!   2. <cwd>/.claude/complier.cpl
//!   3. <cwd>/complier.cpl

use std::path::{Path, PathBuf};

pub fn resolve(cwd: &str) -> PathBuf {
    if let Ok(env) = std::env::var("CC_CONTRACT") {
        if !env.is_empty() {
            return PathBuf::from(env);
        }
    }
    let cwd_path = Path::new(cwd);
    let project = cwd_path.join(".claude").join("complier.cpl");
    if project.exists() {
        return project;
    }
    cwd_path.join("complier.cpl")
}
