use std::path::{Path, PathBuf};

/// Where the contract lives inside a repo.
pub const CONTRACT: &str = ".claude/complier/contract.csp";

/// Per-user state: socket and log. `COMPLIER_HOME` overrides it for tests.
pub fn home() -> PathBuf {
    if let Some(h) = std::env::var_os("COMPLIER_HOME") {
        return PathBuf::from(h);
    }
    PathBuf::from(std::env::var_os("HOME").unwrap_or_else(|| ".".into())).join(".complier")
}

pub fn socket() -> PathBuf {
    home().join("complier.sock")
}

pub fn log() -> PathBuf {
    home().join("daemon.log")
}

/// The nearest contract at or above `dir`.
pub fn find_contract(dir: &Path) -> Option<PathBuf> {
    dir.ancestors().map(|d| d.join(CONTRACT)).find(|p| p.is_file())
}

/// The git root containing the current directory, or the directory itself.
pub fn repo_root() -> std::io::Result<PathBuf> {
    let cwd = std::env::current_dir()?;
    let out = std::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output();
    Ok(match out {
        Ok(o) if o.status.success() => PathBuf::from(String::from_utf8_lossy(&o.stdout).trim()),
        _ => cwd,
    })
}
