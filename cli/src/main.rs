mod codegen;
mod config;
mod csp;
mod daemon;
mod hooks;
mod host;
mod mcp;
mod oauth;
mod poller;
mod proxy;
mod secrets;

use anyhow::{bail, Result};
use clap::{Parser, Subcommand};
use config::Server;
use std::io::{IsTerminal, Read};
use std::path::{Path, PathBuf};

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
    /// Generate TypeScript types for each server's tools into <out>/<name>/tools.ts.
    Gen {
        #[arg(required = true)]
        names: Vec<String>,
        #[arg(long, default_value = "packages")]
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
    /// Run the complier daemon in the foreground. `machine up` starts it in the background if needed.
    Up,
    /// Start, stop and inspect machines: running instances of a spec.
    Machine {
        #[command(subcommand)]
        command: MachineCommand,
    },
    /// The MCP server an agent's harness talks to; binds to COMPLIER_MACHINE as COMPLIER_ROLE.
    Proxy,
    /// Claude Code hooks; reads the machine and role from COMPLIER_MACHINE and COMPLIER_ROLE.
    Hook {
        #[command(subcommand)]
        command: HookCommand,
    },
    /// Forget a server and delete its credentials from the keychain.
    Remove { name: String },
}

#[derive(Subcommand)]
enum MachineCommand {
    /// Start a machine from a spec, fed by the input events of the given units.
    Up {
        name: String,
        #[arg(long)]
        spec: PathBuf,
        /// Translation unit whose polls feed this machine (repeatable).
        #[arg(long = "unit")]
        units: Vec<PathBuf>,
    },
    /// Stop a machine.
    Down { name: String },
    /// Perform an action as an agent in a role (stands in for the proxy until it exists).
    Act {
        name: String,
        #[arg(long)]
        role: String,
        event: String,
    },
    /// List running machines.
    Ls,
    /// Print a machine's event log.
    Log {
        name: String,
        /// Keep printing new entries as they arrive.
        #[arg(short, long)]
        follow: bool,
    },
}

#[derive(Subcommand)]
enum HookCommand {
    /// Tells the agent its machine, role and what its spec lets it do.
    SessionStart,
    /// Allows only complier's MCP tools and blocks edits to the config that enforces it.
    PreToolUse,
    /// Delivers what the agent's role can receive, waiting while it waits to receive.
    Stop,
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Add { name, url: Some(url), client_id, .. } => add_http(name, url, client_id),
        Command::Add { name, url: None, env, command, .. } => add_stdio(name, env, command),
        Command::Ls => ls(),
        Command::Gen { names, out } => generate(&names, &out),
        Command::Call { name, tool, arguments } => call(&name, &tool, &arguments),
        Command::Run { unit } => run(&unit),
        Command::Up => daemon::serve(),
        Command::Machine { command } => machine(command),
        Command::Proxy => proxy::serve(),
        Command::Hook { command: HookCommand::SessionStart } => hooks::session_start(),
        Command::Hook { command: HookCommand::PreToolUse } => hooks::pre_tool_use(),
        Command::Hook { command: HookCommand::Stop } => hook_stop(),
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
    for name in names {
        let mut client = open(name)?;
        client.initialize()?;
        let tools = client.list_tools()?;
        let dir = out.join(name);
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("tools.ts");
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
    println!("polling {}", unit.display());
    let stop = std::sync::atomic::AtomicBool::new(false);
    poller::poll(unit, &stop, |event| println!("{}", poller::show(&event)))
}

fn machine(command: MachineCommand) -> Result<()> {
    match command {
        MachineCommand::Up { name, spec, units } => {
            let request = daemon::Request::MachineUp {
                name,
                spec: absolute(&spec)?,
                units: units.iter().map(|u| absolute(u)).collect::<Result<_>>()?,
            };
            println!("machine {} up", daemon::request(&request, true)?.as_str().unwrap_or("?"));
        }
        MachineCommand::Down { name } => {
            daemon::request(&daemon::Request::MachineDown { name: name.clone() }, false)?;
            println!("machine {name} down");
        }
        MachineCommand::Act { name, role, event } => {
            let state = daemon::request(&daemon::Request::Act { machine: name, role, event, value: serde_json::Value::Null }, false)?;
            println!("{}", state.as_str().unwrap_or("?"));
        }
        MachineCommand::Ls => {
            for m in daemon::request(&daemon::Request::MachineLs, false)?.as_array().into_iter().flatten() {
                let field = |k: &str| m[k].as_str().unwrap_or("?").to_string();
                println!("{}\t{}\t{}", field("name"), field("status"), field("state"));
            }
        }
        MachineCommand::Log { name, follow } => log(&name, follow)?,
    }
    Ok(())
}

// Blocks while the agent's role waits to receive something, then makes Claude continue with what
// arrived. Outside a machine (no COMPLIER_MACHINE/COMPLIER_ROLE) or with nothing to wait for,
// it lets Claude stop.
fn hook_stop() -> Result<()> {
    let _ = std::io::copy(&mut std::io::stdin(), &mut std::io::sink()); // the hook's JSON input
    let (Ok(machine), Ok(role)) = (std::env::var("COMPLIER_MACHINE"), std::env::var("COMPLIER_ROLE")) else {
        return Ok(());
    };
    let request = daemon::Request::Stop { machine: machine.clone(), role: role.clone() };
    let delivery = daemon::request(&request, false)?;
    let list = |k: &str| -> Vec<String> {
        delivery[k].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect()
    };
    let delivered = list("delivered");
    if delivered.is_empty() {
        return Ok(());
    }
    let mut reason = format!("complier: you ({role}, in machine {machine}) received: {}.", delivered.join(", "));
    let world = list("world");
    if !world.is_empty() {
        reason += &format!(" What happened in the world since you last stopped: {}.", world.join(", "));
    }
    reason += &match list("next").as_slice() {
        [] => " Your process has nothing more for you to do.".to_string(),
        next => format!(" Your spec now lets you: {}.", next.join(", ")),
    };
    println!("{}", serde_json::json!({ "decision": "block", "reason": reason }));
    Ok(())
}

// The daemon resolves paths from its own working directory, so send it absolute ones.
fn absolute(path: &Path) -> Result<PathBuf> {
    Ok(path.canonicalize().map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))?)
}

fn log(name: &str, follow: bool) -> Result<()> {
    use std::io::{BufRead, Seek};
    let path = daemon::log_path(name)?;
    let file = std::fs::File::open(&path).map_err(|_| anyhow::anyhow!("no log for machine {name}"))?;
    let mut reader = std::io::BufReader::new(file);
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            if !follow {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(300));
            reader.seek(std::io::SeekFrom::Current(0))?;
            continue;
        }
        let entry: serde_json::Value = serde_json::from_str(&line)?;
        let time = chrono::DateTime::from_timestamp_millis(entry["t"].as_i64().unwrap_or(0))
            .map(|t| t.with_timezone(&chrono::Local).format("%H:%M:%S").to_string())
            .unwrap_or_default();
        let text = |k: &str| entry[k].as_str().unwrap_or("").to_string();
        let kind = text("kind");
        let event = match text("role").as_str() {
            "" => text("event"),
            role => format!("{role}: {}", text("event")),
        };
        match kind.as_str() {
            "status" => println!("{time}  status   {:<48} {}", text("status"), text("reason")),
            "deliver" => println!("{time}  deliver  {event:<48} → {}", text("state")),
            _ if text("outcome") == "accepted" => println!("{time}  {kind:<7}  {event:<48} → {}", text("state")),
            _ => println!("{time}  {kind:<7}  {event:<48} {} {}", text("outcome"), text("reason")),
        }
    }
}

// Connects to a registered server with its keychain credentials, refreshing an expired token.
pub(crate) fn open(name: &str) -> Result<mcp::Client> {
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
