// Where complier's parts live. An installed release is one folder: bin/complier, lib/complier-cel.jar
// (the CEL backend), lib/complier-fdr (the bridge to your FDR), plugin/, packages/ and examples/.
// A complier built from a checkout instead finds the backends the build scripts wrote in the repo.
// COMPLIER_CEL and COMPLIER_FDR (each a backend.json) override both.

use std::path::{Path, PathBuf};

// The release folder this binary runs from, if it runs from one.
pub fn root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?.canonicalize().ok()?;
    let root = exe.parent()?.parent()?.to_path_buf();
    root.join("lib/complier-cel.jar").is_file().then_some(root)
}

// The folder FDR's libraries are in, so the FDR bridge can load your FDR: FDR_HOME if it's set,
// else where FDR installs by default (/Applications/FDR4.app on macOS, `refines` on PATH on Linux).
pub fn fdr_libs() -> Option<PathBuf> {
    let home = std::env::var_os("FDR_HOME").map(PathBuf::from);
    let candidates: Vec<PathBuf> = if cfg!(target_os = "macos") {
        let app = home.unwrap_or_else(|| PathBuf::from("/Applications/FDR4.app"));
        vec![app.join("Contents/Frameworks"), app.join("Frameworks")]
    } else {
        let home = home.or_else(|| {
            let refines = which("refines")?.canonicalize().ok()?;
            Some(refines.parent()?.parent()?.to_path_buf())
        });
        home.map(|h| vec![h.join("lib")]).unwrap_or_default()
    };
    let lib = if cfg!(target_os = "macos") { "libfdr.dylib" } else { "libfdr.so" };
    candidates.into_iter().find(|dir| dir.join(lib).is_file())
}

fn which(program: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?).map(|dir| dir.join(program)).find(|p| p.is_file())
}

// The environment variable through which the FDR bridge finds FDR's libraries.
pub fn library_path_var() -> &'static str {
    if cfg!(target_os = "macos") { "DYLD_LIBRARY_PATH" } else { "LD_LIBRARY_PATH" }
}

// `dir` put in front of the existing value of `var`.
pub fn prepend(var: &str, dir: &Path) -> std::ffi::OsString {
    let mut paths = vec![dir.to_path_buf()];
    if let Some(old) = std::env::var_os(var) {
        paths.extend(std::env::split_paths(&old));
    }
    std::env::join_paths(paths).unwrap_or_default()
}
