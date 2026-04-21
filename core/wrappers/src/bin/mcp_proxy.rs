//! `complier-mcp-proxy` — stdio MCP proxy that gates every downstream tool
//! call through a complier session.
//!
//! usage:
//!   complier-mcp-proxy --namespace NS --contract FILE.cpl \
//!       [--workflow NAME] -- <downstream command...>
//!
//! The parent agent speaks MCP over stdio to this binary. The binary spawns
//! the downstream MCP server as a child process (also stdio) and forwards
//! `tools/list` / `tools/call`, consulting the parsed contract on every call.

use std::path::PathBuf;
use std::sync::Arc;

use rmcp::{
    transport::{ConfigureCommandExt, TokioChildProcess},
    ServiceExt,
};
use tokio::sync::Mutex;
use wrappers::mcp::{McpGate, McpProxyServer};

#[derive(Debug)]
struct Args {
    namespace: String,
    contract_path: PathBuf,
    workflow: Option<String>,
    downstream_command: Vec<String>,
}

fn parse_args() -> Result<Args, String> {
    let mut namespace: Option<String> = None;
    let mut contract_path: Option<PathBuf> = None;
    let mut workflow: Option<String> = None;
    let mut downstream_command: Vec<String> = Vec::new();
    let mut args = std::env::args().skip(1).peekable();

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--namespace" => namespace = args.next(),
            "--contract" => contract_path = args.next().map(PathBuf::from),
            "--workflow" => workflow = args.next(),
            "--" => {
                downstream_command.extend(args.by_ref());
                break;
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    Ok(Args {
        namespace: namespace.ok_or("--namespace is required")?,
        contract_path: contract_path.ok_or("--contract is required")?,
        workflow,
        downstream_command: {
            if downstream_command.is_empty() {
                return Err("a downstream command is required after `--`".into());
            }
            downstream_command
        },
    })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("complier-mcp-proxy: {e}");
            eprintln!(
                "usage: complier-mcp-proxy --namespace NS --contract FILE.cpl \\\n  [--workflow NAME] -- <downstream command...>"
            );
            std::process::exit(2);
        }
    };

    // Parse + compile the contract.
    let source = std::fs::read_to_string(&args.contract_path)?;
    let program = parser::parse(&source).map_err(|e| anyhow::anyhow!("parse contract: {e}"))?;
    let contract = compiler::Contract::from_program(&program)
        .map_err(|e| anyhow::anyhow!("compile contract: {e}"))?;

    // Build shared session + gate.
    let session = session::Session::new(contract, args.workflow).map_err(anyhow::Error::msg)?;
    let session = Arc::new(Mutex::new(session));
    let gate = McpGate::new(args.namespace.clone(), session.clone());

    // Spawn the downstream MCP server as a child process and connect to it.
    let head = args.downstream_command[0].clone();
    let tail: Vec<String> = args.downstream_command[1..].to_vec();
    let transport = TokioChildProcess::new(tokio::process::Command::new(&head).configure(|cmd| {
        cmd.args(&tail);
    }))?;
    let downstream = ().serve(transport).await?;

    // Serve our proxy to the parent agent on stdio.
    let proxy = McpProxyServer::new(gate, downstream);
    let server = proxy
        .serve((tokio::io::stdin(), tokio::io::stdout()))
        .await?;
    server.waiting().await?;
    Ok(())
}
