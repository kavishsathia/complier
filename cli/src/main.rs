mod config;
mod mcp;
mod oauth;
mod secrets;

use anyhow::{bail, Result};
use clap::{Parser, Subcommand};
use config::Server;
use std::io::{IsTerminal, Read};

// Keychain account under which an HTTP server's OAuth tokens are stored.
const OAUTH: &str = "oauth";

#[derive(Parser)]
#[command(name = "complier", version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Register an MCP server and store its credentials in the OS keychain.
    ///
    /// HTTP:  complier add notion --url https://mcp.notion.com/mcp
    /// stdio: complier add github --env GITHUB_PERSONAL_ACCESS_TOKEN -- npx -y @modelcontextprotocol/server-github
    Add {
        name: String,
        /// URL of a remote (Streamable HTTP) server; authorizes through OAuth.
        #[arg(long, conflicts_with_all = ["env", "command"])]
        url: Option<String>,
        /// OAuth client ID, for servers that don't support dynamic client registration.
        #[arg(long, requires = "url")]
        client_id: Option<String>,
        /// Env var a stdio server reads its credential from (repeatable); prompted for.
        #[arg(long = "env")]
        env: Vec<String>,
        /// Command that starts a stdio server.
        #[arg(last = true)]
        command: Vec<String>,
    },
    /// Connect to a registered server with its keychain credentials and list its tools.
    Connect { name: String },
    /// Forget a server and delete its credentials from the keychain.
    Remove { name: String },
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Add { name, url: Some(url), client_id, .. } => add_http(name, url, client_id),
        Command::Add { name, url: None, env, command, .. } => add_stdio(name, env, command),
        Command::Connect { name } => connect(&name),
        Command::Remove { name } => remove(&name),
    }
}

fn add_http(name: String, url: String, client_id: Option<String>) -> Result<()> {
    let http = reqwest::blocking::Client::new();
    let (reg, tokens) = oauth::login(&http, &url, client_id)?;
    secrets::set(&name, OAUTH, &serde_json::to_string(&tokens)?)?;
    let server = Server::Http {
        url,
        resource: reg.resource,
        client_id: reg.client_id,
        token_endpoint: reg.token_endpoint,
    };
    save(name, server)
}

fn add_stdio(name: String, env: Vec<String>, command: Vec<String>) -> Result<()> {
    if command.is_empty() {
        bail!("pass either --url <url> or -- <command>");
    }
    for var in &env {
        secrets::set(&name, var, &read_secret(var)?)?;
    }
    save(name, Server::Stdio { command, env })
}

fn save(name: String, server: Server) -> Result<()> {
    let mut servers = config::load()?;
    servers.insert(name.clone(), server);
    config::save(&servers)?;
    println!("added {name}");
    Ok(())
}

fn connect(name: &str) -> Result<()> {
    let mut client = match config::get(name)? {
        Server::Stdio { command, env } => {
            let env = env
                .iter()
                .map(|var| Ok((var.clone(), secrets::get(name, var)?)))
                .collect::<Result<Vec<_>>>()?;
            mcp::Client::stdio(&command, &env)?
        }
        Server::Http { url, resource, client_id, token_endpoint } => {
            let mut tokens: oauth::Tokens = serde_json::from_str(&secrets::get(name, OAUTH)?)?;
            if tokens.expired() {
                let reg = oauth::Registration { resource, client_id, token_endpoint };
                tokens = oauth::refresh(&reqwest::blocking::Client::new(), &reg, tokens)?;
                secrets::set(name, OAUTH, &serde_json::to_string(&tokens)?)?;
                println!("refreshed access token");
            }
            mcp::Client::http(&url, &tokens.access_token)?
        }
    };

    let info = client.initialize()?;
    println!(
        "connected to {} (protocol {})",
        info["serverInfo"]["name"].as_str().unwrap_or("?"),
        info["protocolVersion"].as_str().unwrap_or("?"),
    );
    for tool in client.list_tools()? {
        println!("  {}", tool["name"].as_str().unwrap_or("?"));
    }
    Ok(())
}

fn remove(name: &str) -> Result<()> {
    match config::get(name)? {
        Server::Stdio { env, .. } => {
            for var in &env {
                secrets::delete(name, var)?;
            }
        }
        Server::Http { .. } => secrets::delete(name, OAUTH)?,
    }
    let mut servers = config::load()?;
    servers.remove(name);
    config::save(&servers)?;
    println!("removed {name}");
    Ok(())
}

// Prompts with hidden input on a terminal; otherwise reads the secret from stdin
// so it can be piped in (`gh auth token | complier add ...`).
fn read_secret(var: &str) -> Result<String> {
    if std::io::stdin().is_terminal() {
        return Ok(rpassword::prompt_password(format!("{var}: "))?);
    }
    let mut secret = String::new();
    std::io::stdin().read_to_string(&mut secret)?;
    Ok(secret.trim().to_string())
}
