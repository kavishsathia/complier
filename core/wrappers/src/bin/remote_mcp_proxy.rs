//! `complier-remote-mcp-proxy` — the shared HTTP proxy host. Mirrors Python's
//! `complier.wrappers.remote_http_proxy`.
//!
//! Usage:
//!   complier-remote-mcp-proxy --contract FILE.cpl [--workflow NAME] \
//!       [--host 127.0.0.1] [--port 8766]
//!
//! Register namespaces via `POST /setup`:
//!   { "namespace": "notion", "downstream_url": "https://...", "auth_token": "..." }
//!
//! Agents then hit `/mcp/{namespace}/` with MCP JSON-RPC.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::{Mutex, RwLock};

struct Args {
    contract_path: PathBuf,
    workflow: Option<String>,
    host: String,
    port: u16,
}

fn parse_args() -> Result<Args, String> {
    let mut contract_path: Option<PathBuf> = None;
    let mut workflow: Option<String> = None;
    let mut host = "127.0.0.1".to_string();
    let mut port: u16 = 8766;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--contract" => {
                contract_path = args.next().map(PathBuf::from);
            }
            "--workflow" => {
                workflow = args.next();
            }
            "--host" => {
                host = args.next().ok_or("--host requires a value")?;
            }
            "--port" => {
                port = args
                    .next()
                    .ok_or("--port requires a value")?
                    .parse()
                    .map_err(|e| format!("--port: {e}"))?;
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    Ok(Args {
        contract_path: contract_path.ok_or("--contract is required")?,
        workflow,
        host,
        port,
    })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("complier-remote-mcp-proxy: {e}");
            eprintln!(
                "usage: complier-remote-mcp-proxy --contract FILE.cpl [--workflow NAME] [--host H] [--port P]"
            );
            std::process::exit(2);
        }
    };

    let source = std::fs::read_to_string(&args.contract_path)?;
    let program = parser::parse(&source).map_err(|e| anyhow::anyhow!("parse: {e}"))?;
    let contract = compiler::Contract::from_program(&program)
        .map_err(|e| anyhow::anyhow!("compile: {e}"))?;
    let session = session::Session::new(contract, args.workflow).map_err(anyhow::Error::msg)?;
    let session = Arc::new(Mutex::new(session));

    let registry = Arc::new(RwLock::new(wrappers::remote::RemoteRegistry::new()));
    let addr: SocketAddr = format!("{}:{}", args.host, args.port).parse()?;
    println!("complier-remote-mcp-proxy listening on http://{addr}");
    wrappers::remote::serve(addr, registry, session).await?;
    Ok(())
}
