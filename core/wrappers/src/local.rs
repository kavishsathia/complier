//! Local stdio MCP wrapper — port of Python's
//! `complier.wrappers.local_mcp` + `local_stdio_proxy` helpers.
//!
//! In Rust the gating path lives inside rmcp (`McpProxyServer`), but the
//! caller-facing helpers (launch-command construction, arg parsing,
//! server-params splitting) still exist as standalone functions so they can
//! be unit-tested exactly like the Python equivalents.

use std::path::PathBuf;

/// Launch details for a wrapped local stdio MCP server — mirrors Python's
/// `LocalMCPDetails`.
#[derive(Debug, Clone)]
pub struct LocalMCPDetails {
    pub namespace: String,
    pub command: Vec<String>,
}

/// Build the launch command for `complier-mcp-proxy` that will namespace the
/// given downstream command. The binary itself still has to be on PATH (or
/// accessible via cargo); this helper only assembles the argv.
pub fn wrap_local_mcp(
    namespace: &str,
    contract_path: impl Into<PathBuf>,
    downstream_command: &[impl AsRef<str>],
) -> Result<LocalMCPDetails, String> {
    let ns = crate::naming::public_tool_name(namespace)?;
    let parts: Vec<String> = downstream_command
        .iter()
        .map(|s| s.as_ref().trim().to_owned())
        .filter(|s| !s.is_empty())
        .collect();
    if parts.is_empty() {
        return Err("Local MCP command cannot be empty.".into());
    }
    let contract: PathBuf = contract_path.into();
    let mut cmd = vec![
        "complier-mcp-proxy".to_string(),
        "--namespace".to_string(),
        ns.clone(),
        "--contract".to_string(),
        contract.to_string_lossy().into_owned(),
        "--".to_string(),
    ];
    cmd.extend(parts);
    Ok(LocalMCPDetails {
        namespace: ns,
        command: cmd,
    })
}

/// Parsed args for the local stdio proxy binary — mirrors the Python
/// `_parse_args` return. Kept deliberately small for unit testing.
#[derive(Debug, Clone, PartialEq)]
pub struct LocalProxyArgs {
    pub namespace: String,
    pub contract: PathBuf,
    pub workflow: Option<String>,
    pub downstream_command: Vec<String>,
}

/// Parse the CLI args for `complier-mcp-proxy`. Mirrors Python's
/// `_parse_args` (strips the `--` separator, requires a downstream command).
pub fn parse_local_proxy_args(argv: &[impl AsRef<str>]) -> Result<LocalProxyArgs, String> {
    let mut namespace: Option<String> = None;
    let mut contract: Option<PathBuf> = None;
    let mut workflow: Option<String> = None;
    let mut downstream_command: Vec<String> = Vec::new();
    let mut it = argv.iter().map(|s| s.as_ref().to_owned()).peekable();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--namespace" => namespace = it.next(),
            "--contract" => contract = it.next().map(PathBuf::from),
            "--workflow" => workflow = it.next(),
            "--" => {
                downstream_command.extend(it.by_ref());
                break;
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    if downstream_command.is_empty() {
        return Err("a downstream command is required after `--`".into());
    }
    Ok(LocalProxyArgs {
        namespace: namespace.ok_or("--namespace is required")?,
        contract: contract.ok_or("--contract is required")?,
        workflow,
        downstream_command,
    })
}

/// Split a downstream command into (program, args). Mirrors Python's
/// `_build_server_params`.
pub fn build_server_params(downstream_command: &[impl AsRef<str>]) -> (String, Vec<String>) {
    let mut iter = downstream_command.iter().map(|s| s.as_ref().to_owned());
    let head = iter.next().unwrap_or_default();
    let tail: Vec<String> = iter.collect();
    (head, tail)
}
