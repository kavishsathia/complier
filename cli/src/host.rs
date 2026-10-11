// Runs a translation unit's pure functions in a Node child process. Rust keeps all state
// (credentials, MCP session, previous snapshots); Node only answers diff(prev, next).

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

const HOST: &str = include_str!("host.js");

#[derive(Deserialize)]
pub struct Description {
    pub server: String,
    #[serde(rename = "readOnly")]
    pub read_only: Vec<String>,
    pub polls: Vec<PollSpec>,
}

#[derive(Deserialize)]
pub struct PollSpec {
    pub tool: String,
    pub every: u64,
    pub args: Value,
}

#[derive(Deserialize)]
pub struct Event {
    pub channel: String,
    pub value: Value,
}

pub struct Host {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Host {
    pub fn spawn(unit: &Path) -> Result<(Self, Description)> {
        let unit = unit.canonicalize().with_context(|| format!("no unit at {}", unit.display()))?;
        let mut child = Command::new("node")
            .args(["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "-e", HOST])
            .arg(&unit)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .context("spawning node")?;
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let mut host = Self { child, stdin, stdout };
        let description = serde_json::from_value(host.recv()?)?;
        Ok((host, description))
    }

    pub fn diff(&mut self, poll: usize, prev: &str, next: &str) -> Result<Vec<Event>> {
        writeln!(self.stdin, "{}", json!({ "poll": poll, "prev": prev, "next": next }))?;
        self.stdin.flush()?;
        Ok(serde_json::from_value(self.recv()?)?)
    }

    fn recv(&mut self) -> Result<Value> {
        let mut line = String::new();
        if self.stdout.read_line(&mut line)? == 0 {
            return Err(anyhow!("translation unit host exited"));
        }
        Ok(serde_json::from_str(&line)?)
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
