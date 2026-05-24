//! Daemon JSON-RPC client.
//!
//! Speaks the four-method per-session protocol over a Unix socket:
//!   attach   -> {hint}
//!   check    -> {allowed, reason, missing, hint}
//!   record   -> {hint}
//!   choose   -> {}
//!
//! Wire format is newline-delimited JSON, one object per line. The Python
//! daemon lives at $COMPLIER_SOCK (or ~/.complier/daemon.sock). This client
//! does not spawn the daemon — if the socket is missing, it returns an error
//! and lets the caller surface it.

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

/// Errors the client can return.
#[derive(Debug)]
pub enum DaemonError {
    SocketMissing(PathBuf),
    Io(std::io::Error),
    Protocol(String),
    Server(String),
}

impl std::fmt::Display for DaemonError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DaemonError::SocketMissing(p) => write!(f, "daemon socket not found at {}", p.display()),
            DaemonError::Io(e) => write!(f, "io error: {e}"),
            DaemonError::Protocol(msg) => write!(f, "protocol error: {msg}"),
            DaemonError::Server(msg) => write!(f, "daemon error: {msg}"),
        }
    }
}

impl std::error::Error for DaemonError {}

impl From<std::io::Error> for DaemonError {
    fn from(e: std::io::Error) -> Self {
        DaemonError::Io(e)
    }
}

/// Resolve the daemon socket path: `$COMPLIER_SOCK` or `~/.complier/daemon.sock`.
pub fn socket_path() -> PathBuf {
    if let Ok(env) = std::env::var("COMPLIER_SOCK") {
        if !env.is_empty() {
            return PathBuf::from(env);
        }
    }
    let mut p = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push(".complier");
    p.push("daemon.sock");
    p
}

/// Client bound to one session name.
pub struct DaemonClient {
    pub session: String,
    sock_path: PathBuf,
}

#[derive(Deserialize, Debug, Default)]
pub struct CheckResult {
    pub allowed: bool,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub missing: Vec<String>,
    #[serde(default)]
    pub hint: String,
}

#[derive(Deserialize, Debug, Default)]
pub struct HintResult {
    #[serde(default)]
    pub hint: String,
}

#[derive(Deserialize, Debug, Default)]
pub struct HumanResult {
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub hint: String,
}

impl DaemonClient {
    pub fn new(session: impl Into<String>) -> Result<Self, DaemonError> {
        let sock_path = socket_path();
        if !sock_path.exists() {
            return Err(DaemonError::SocketMissing(sock_path));
        }
        Ok(Self {
            session: session.into(),
            sock_path,
        })
    }

    pub fn attach(
        &self,
        contract_path: &str,
        workflow: Option<&str>,
    ) -> Result<HintResult, DaemonError> {
        let mut params = Map::new();
        params.insert("session".into(), Value::String(self.session.clone()));
        params.insert("contract_path".into(), Value::String(contract_path.into()));
        params.insert(
            "workflow".into(),
            workflow
                .map(|w| Value::String(w.into()))
                .unwrap_or(Value::Null),
        );
        self.request("attach", Value::Object(params))
    }

    pub fn check(
        &self,
        tool: &str,
        tool_params: &Value,
        choice: Option<&str>,
    ) -> Result<CheckResult, DaemonError> {
        let mut params = Map::new();
        params.insert("session".into(), Value::String(self.session.clone()));
        params.insert("tool".into(), Value::String(tool.into()));
        params.insert("params".into(), tool_params.clone());
        if let Some(arm) = choice {
            params.insert("choice".into(), Value::String(arm.into()));
        }
        self.request("check", Value::Object(params))
    }

    pub fn record(
        &self,
        tool: &str,
        tool_params: &Value,
        result: &Value,
        choice: Option<&str>,
    ) -> Result<HintResult, DaemonError> {
        let mut params = Map::new();
        params.insert("session".into(), Value::String(self.session.clone()));
        params.insert("tool".into(), Value::String(tool.into()));
        params.insert("params".into(), tool_params.clone());
        params.insert("result".into(), result.clone());
        if let Some(arm) = choice {
            params.insert("choice".into(), Value::String(arm.into()));
        }
        self.request("record", Value::Object(params))
    }

    pub fn choose(&self, arm: &str) -> Result<Value, DaemonError> {
        let mut params = Map::new();
        params.insert("session".into(), Value::String(self.session.clone()));
        params.insert("arm".into(), Value::String(arm.into()));
        self.request_raw("choose", Value::Object(params))
    }

    pub fn human(&self) -> Result<HumanResult, DaemonError> {
        let mut params = Map::new();
        params.insert("session".into(), Value::String(self.session.clone()));
        self.request("human", Value::Object(params))
    }

    /// Typed request: parse the `result` field into T.
    fn request<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: Value,
    ) -> Result<T, DaemonError> {
        let raw = self.request_raw(method, params)?;
        serde_json::from_value(raw)
            .map_err(|e| DaemonError::Protocol(format!("decoding {method} result: {e}")))
    }

    /// Raw request: returns the `result` field as a Value (or an error from
    /// the daemon's `error` field).
    fn request_raw(&self, method: &str, params: Value) -> Result<Value, DaemonError> {
        let payload = json!({"method": method, "params": params}).to_string() + "\n";

        let mut stream = UnixStream::connect(&self.sock_path)?;
        stream.write_all(payload.as_bytes())?;
        stream.shutdown(std::net::Shutdown::Write)?;

        let mut buf = String::new();
        stream.read_to_string(&mut buf)?;
        let line = buf.trim();
        if line.is_empty() {
            return Err(DaemonError::Protocol("empty response".into()));
        }

        let parsed: Value = serde_json::from_str(line)
            .map_err(|e| DaemonError::Protocol(format!("invalid JSON: {e}")))?;

        if let Some(err) = parsed.get("error").and_then(Value::as_str) {
            return Err(DaemonError::Server(err.into()));
        }

        parsed
            .get("result")
            .cloned()
            .ok_or_else(|| DaemonError::Protocol("response missing 'result' field".into()))
    }
}

/// JSON helper used by other modules — wraps a kwargs dict.
#[derive(Serialize, Deserialize, Debug, Default)]
pub struct ToolParams(pub Map<String, Value>);
