// The CEL backend: Google's cel-java runtime and formal verifier (Z3 underneath) in a JVM child
// process, one JSON request and one JSON reply per line (cel/src/.../ComplierCel.java). cel/build.sh
// builds it and writes backend.json, which says which java to run with what classpath. A backend
// that is missing, won't start or dies is an error, never a pass.

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

#[derive(Deserialize)]
struct Config {
    java: String,
    classpath: String,
}

// backend.json as cel/build.sh writes it in this checkout, unless COMPLIER_CEL names another.
fn config_path() -> PathBuf {
    match std::env::var_os("COMPLIER_CEL") {
        Some(path) => PathBuf::from(path),
        None => PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../cel/build/backend.json")),
    }
}

pub struct Backend {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    // Which jars and Z3 answered, for reports.
    pub version: String,
}

impl Backend {
    pub fn spawn() -> Result<Self> {
        // An installed release: its jar, run by the Java on JAVA_HOME or PATH.
        if let (None, Some(root)) = (std::env::var_os("COMPLIER_CEL"), crate::install::root()) {
            let java = match std::env::var_os("JAVA_HOME") {
                Some(home) => PathBuf::from(home).join("bin/java").display().to_string(),
                None => "java".to_string(),
            };
            let jar = root.join("lib/complier-cel.jar");
            return Self::start(&java, &jar.display().to_string())
                .context("complier's CEL verifier runs on Java 11 or later: install a JDK or JRE, or set JAVA_HOME");
        }
        let path = config_path();
        let text = std::fs::read_to_string(&path)
            .with_context(|| format!("no CEL backend at {} (run cel/build.sh, or point COMPLIER_CEL at its backend.json)", path.display()))?;
        let config: Config = serde_json::from_str(&text).with_context(|| format!("reading {}", path.display()))?;
        Self::start(&config.java, &config.classpath)
    }

    pub fn start(java: &str, classpath: &str) -> Result<Self> {
        let mut child = Command::new(java)
            .args(["-cp", classpath, "dev.cel.verifier.tools.ComplierCel"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .with_context(|| format!("starting the CEL backend ({java})"))?;
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let mut backend = Self { child, stdin, stdout, version: String::new() };
        // Asking for Z3's version loads its native library, so this fails if Z3 can't run.
        let v = backend.request(json!({ "op": "version" })).context("the CEL backend didn't start")?;
        if v["ok"] != true {
            bail!("the CEL backend didn't start: {}", v["error"]);
        }
        let field = |k: &str| v[k].as_str().unwrap_or("?").to_string();
        backend.version = format!("{}, {}, {}, Java {}", field("verifier"), field("runtime"), field("z3"), field("java"));
        Ok(backend)
    }

    pub fn request(&mut self, request: Value) -> Result<Value> {
        writeln!(self.stdin, "{request}")?;
        self.stdin.flush()?;
        let mut line = String::new();
        if self.stdout.read_line(&mut line)? == 0 {
            return Err(anyhow!("the CEL backend exited"));
        }
        Ok(serde_json::from_str(&line)?)
    }
}

impl Drop for Backend {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
