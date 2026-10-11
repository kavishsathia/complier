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
    // Tools whose calls translate to an output event, and tools the agent may call unchecked.
    pub outputs: Vec<String>,
    pub hidden: Vec<String>,
    // Input schema hashes the service's types were generated from.
    #[serde(default)]
    pub hashes: std::collections::HashMap<String, String>,
}

#[derive(Deserialize)]
pub struct PollSpec {
    pub tool: String,
    pub every: u64,
    pub args: Value,
}

#[derive(Deserialize, Clone)]
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

    // Translates an agent's call of `tool` into its output event, or the reason it can't be.
    pub fn output(&mut self, tool: &str, args: &Value) -> Result<std::result::Result<Event, String>> {
        writeln!(self.stdin, "{}", json!({ "output": tool, "args": args }))?;
        self.stdin.flush()?;
        let reply = self.recv()?;
        Ok(match reply.get("error") {
            Some(error) => Err(error.as_str().unwrap_or("translation failed").to_string()),
            None => Ok(serde_json::from_value(reply["event"].clone())?),
        })
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
