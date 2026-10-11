mod config;
mod mcp;
mod secrets;

use anyhow::Result;
use clap::{Parser, Subcommand};
use std::io::{IsTerminal, Read};

#[derive(Parser)]
#[command(name = "complier", version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Register a stdio MCP server; prompts for each --env secret and stores it in the OS keychain.
    Add {
        name: String,
        /// Env var the server reads its credential from (repeatable).
        #[arg(long = "env")]
        env: Vec<String>,
        /// Command that starts the server.
        #[arg(last = true, required = true)]
        command: Vec<String>,
    },
    /// Spawn a registered server with its keychain secrets and list its tools.
    Connect { name: String },
    /// Forget a server and delete its secrets from the keychain.
    Remove { name: String },
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Add { name, env, command } => add(name, env, command),
        Command::Connect { name } => connect(&name),
        Command::Remove { name } => remove(&name),
    }
}

fn add(name: String, env: Vec<String>, command: Vec<String>) -> Result<()> {
    for var in &env {
        secrets::set(&name, var, &read_secret(var)?)?;
    }
    let mut servers = config::load()?;
    servers.insert(name.clone(), config::Server { command, env });
    config::save(&servers)?;
    println!("added {name}");
    Ok(())
}

fn connect(name: &str) -> Result<()> {
    let server = config::get(name)?;
    let env = server
        .env
        .iter()
        .map(|var| Ok((var.clone(), secrets::get(name, var)?)))
        .collect::<Result<Vec<_>>>()?;

    let mut client = mcp::Client::spawn(&server.command, &env)?;
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
    let server = config::get(name)?;
    for var in &server.env {
        secrets::delete(name, var)?;
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
