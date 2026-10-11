mod codegen;
mod config;
mod host;
mod mcp;
mod oauth;
mod secrets;

use anyhow::{bail, Result};
use clap::{Parser, Subcommand};
use config::Server;
use std::io::{IsTerminal, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

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
    /// List registered servers.
    Ls,
    /// Generate TypeScript types for each server's tools into <out>/<name>.ts.
    Gen {
        #[arg(required = true)]
        names: Vec<String>,
        #[arg(long, default_value = "gen")]
        out: PathBuf,
    },
    /// Call one tool and print its raw result.
    Call {
        name: String,
        tool: String,
        /// Tool arguments as JSON.
        #[arg(default_value = "{}")]
        arguments: String,
    },
    /// Run a translation unit's polls and print the input events they produce.
    Run { unit: PathBuf },
    /// Forget a server and delete its credentials from the keychain.
    Remove { name: String },
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Add { name, url: Some(url), client_id, .. } => add_http(name, url, client_id),
        Command::Add { name, url: None, env, command, .. } => add_stdio(name, env, command),
        Command::Ls => ls(),
        Command::Gen { names, out } => generate(&names, &out),
        Command::Call { name, tool, arguments } => call(&name, &tool, &arguments),
        Command::Run { unit } => run(&unit),
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

fn ls() -> Result<()> {
    for (name, server) in config::load()? {
        match server {
            Server::Stdio { command, .. } => println!("{name}\tstdio\t{}", command.join(" ")),
            Server::Http { url, .. } => println!("{name}\thttp\t{url}"),
        }
    }
    Ok(())
}

fn generate(names: &[String], out: &PathBuf) -> Result<()> {
    std::fs::create_dir_all(out)?;
    for name in names {
        let mut client = open(name)?;
        client.initialize()?;
        let tools = client.list_tools()?;
        let path = out.join(format!("{name}.ts"));
        std::fs::write(&path, codegen::module(name, &tools))?;
        println!("{name}: {} tools -> {}", tools.len(), path.display());
    }
    Ok(())
}

fn call(name: &str, tool: &str, arguments: &str) -> Result<()> {
    let mut client = open(name)?;
    client.initialize()?;
    let result = client.call_tool(tool, serde_json::from_str(arguments)?)?;
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}

fn run(unit: &Path) -> Result<()> {
    let (mut host, unit) = host::Host::spawn(unit)?;
    for poll in &unit.polls {
        if !unit.hidden.contains(&poll.tool) {
            bail!("{} is polled but not declared with .hide(); polling runs outside CSP", poll.tool);
        }
    }
    let mut client = open(&unit.server)?;
    client.initialize()?;
    println!("polling {} on {}", unit.polls.len(), unit.server);

    // The first result of each poll is the baseline; events come from every result after it.
    let mut prev: Vec<Option<String>> = vec![None; unit.polls.len()];
    let mut due: Vec<Instant> = vec![Instant::now(); unit.polls.len()];
    loop {
        let (i, &when) = due.iter().enumerate().min_by_key(|(_, t)| **t).unwrap();
        std::thread::sleep(when.saturating_duration_since(Instant::now()));
        let poll = &unit.polls[i];
        due[i] = when + Duration::from_millis(poll.every);

        let result = client.call_tool(&poll.tool, poll.args.clone())?;
        if result["isError"] == true {
            eprintln!("{} returned an error; skipping this poll", poll.tool);
            continue;
        }
        let next = text_content(&result);
        if let Some(prev) = &prev[i] {
            for event in host.diff(i, prev, &next)? {
                println!("{}.{}", event.channel, event.value);
            }
        }
        prev[i] = Some(next);
    }
}

// A tool result's text content blocks, joined.
fn text_content(result: &serde_json::Value) -> String {
    result["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|block| block["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

// Connects to a registered server with its keychain credentials, refreshing an expired token.
fn open(name: &str) -> Result<mcp::Client> {
    match config::get(name)? {
        Server::Stdio { command, env } => {
            let env = env
                .iter()
                .map(|var| Ok((var.clone(), secrets::get(name, var)?)))
                .collect::<Result<Vec<_>>>()?;
            mcp::Client::stdio(&command, &env)
        }
        Server::Http { url, resource, client_id, token_endpoint } => {
            let mut tokens: oauth::Tokens = serde_json::from_str(&secrets::get(name, OAUTH)?)?;
            if tokens.expired() {
                let reg = oauth::Registration { resource, client_id, token_endpoint };
                tokens = oauth::refresh(&reqwest::blocking::Client::new(), &reg, tokens)?;
                secrets::set(name, OAUTH, &serde_json::to_string(&tokens)?)?;
            }
            mcp::Client::http(&url, &tokens.access_token)
        }
    }
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
