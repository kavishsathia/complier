//! Keeps the daemon running through a per-user LaunchAgent: started at
//! login, restarted if it crashes.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::paths;

pub const LABEL: &str = "dev.complier.daemon";

fn plist_path() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
        .join("Library/LaunchAgents")
        .join(format!("{LABEL}.plist"))
}

fn domain() -> String {
    let uid = Command::new("id")
        .arg("-u")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    format!("gui/{uid}")
}

fn launchctl(args: &[&str]) -> bool {
    Command::new("launchctl")
        .args(args)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn install(exe: &Path) -> Result<PathBuf, String> {
    let plist = plist_path();
    let log = paths::log();
    std::fs::create_dir_all(paths::home()).map_err(|e| e.to_string())?;
    if let Some(dir) = plist.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let body = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{exe}</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>{log}</string>
  <key>StandardErrorPath</key>
  <string>{log}</string>
</dict>
</plist>
"#,
        exe = exe.display(),
        log = log.display(),
    );
    std::fs::write(&plist, body).map_err(|e| e.to_string())?;

    // Reload so a moved or upgraded binary takes effect.
    let target = format!("{}/{LABEL}", domain());
    launchctl(&["bootout", &target]);
    if !launchctl(&["bootstrap", &domain(), &plist.to_string_lossy()]) {
        return Err(format!("launchctl could not load {}", plist.display()));
    }
    Ok(plist)
}

pub fn uninstall() -> bool {
    launchctl(&["bootout", &format!("{}/{LABEL}", domain())]);
    std::fs::remove_file(plist_path()).is_ok()
}

pub fn kickstart() {
    launchctl(&["kickstart", &format!("{}/{LABEL}", domain())]);
}
