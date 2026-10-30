mod cel;
mod codegen;
mod config;
mod fdr;
mod install;
mod daemon;
mod hooks;
mod mcp;
mod oauth;
mod secrets;
mod translate;
mod unit;
mod yaml;

use anyhow::{bail, Context, Result};
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
    /// Write each server's tool metadata into <out>/<name>/: tools.yaml, which units are checked against,
    /// and tools.ts, the tools' input types.
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
    /// Load a translation unit (YAML) and prove its translation with the CEL backend, as `machine up`
    /// does before running it, and print the report. Fails if the unit isn't admitted.
    Check { unit: PathBuf },
    /// Check that complier can run here: Java and the CEL verifier, FDR and its licence, the plugin.
    Doctor,
    /// Have FDR prove a spec's policy and compile it, as `machine up` does, and print the report.
    /// Fails if the policy isn't admitted. Needs your own FDR (fdr/README.md).
    Verify { spec: PathBuf },
    /// Classify one tool call with an admitted unit's translation and print its event, without
    /// calling anything upstream.
    ///
    /// complier translate examples/units/notion.yaml notion-update-page '{"page_id": "p1", "command": "replace_content"}'
    Translate {
        unit: PathBuf,
        tool: String,
        /// Tool arguments as JSON.
        #[arg(default_value = "{}")]
        arguments: String,
    },
    /// Run the complier daemon in the foreground. `machine up` starts it in the background if needed.
    Up,
    /// Start, stop and inspect machines: running instances of a spec.
    Machine {
        #[command(subcommand)]
        command: MachineCommand,
    },
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
    /// Start a machine from a spec; its agents' tool calls are translated by the given units.
    ///
    /// complier machine up loop .complier/loop      # a folder: its one .csp and every .yaml unit
    /// complier machine up demo --spec draft.csp --unit draft.yaml
    Up {
        name: String,
        /// A folder holding the spec (one .csp file) and its units (.yaml files).
        dir: Option<PathBuf>,
        #[arg(long, conflicts_with = "dir", required_unless_present = "dir")]
        spec: Option<PathBuf>,
        /// Translation unit (YAML) for the tools the machine's agents may call (repeatable).
        #[arg(long = "unit", conflicts_with = "dir")]
        units: Vec<PathBuf>,
    },
    /// Stop a machine.
    Down { name: String },
    /// Perform an action as an agent in a role, as its hook would after translating a call.
    Act {
        name: String,
        #[arg(long)]
        role: String,
        event: String,
    },
    /// Give the result of an action attempted with `act`, as the value the policy binds (e.g. done).
    Result { name: String, value: String },
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
    /// Checks each MCP tool call with the daemon, and blocks edits to the config that enforces it.
    PreToolUse,
    /// Sends a finished call's result to the daemon, which binds it if the policy is waiting for it.
    PostToolUse,
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
        Command::Check { unit } => check(&unit).map(|_| ()),
        Command::Verify { spec } => verify(&spec),
        Command::Doctor => doctor(),
        Command::Translate { unit, tool, arguments } => translate(&unit, &tool, &arguments),
        Command::Up => daemon::serve(),
        Command::Machine { command } => machine(command),
        Command::Hook { command: HookCommand::SessionStart } => hooks::session_start(),
        Command::Hook { command: HookCommand::PreToolUse } => hooks::pre_tool_use(),
        Command::Hook { command: HookCommand::PostToolUse } => hooks::post_tool_use(),
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
        std::fs::write(dir.join("tools.ts"), codegen::module(name, &tools))?;
        let path = dir.join("tools.yaml");
        std::fs::write(&path, codegen::metadata(name, &tools))?;
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

// Admits the unit as `machine up` does, printing the report either way.
fn check(unit: &Path) -> Result<(Option<translate::Translator>, Option<cel::Backend>)> {
    let description = unit::load(unit)?;
    let mut cel = None;
    match translate::admit(&description, &mut cel) {
        Ok(Some((translator, report))) => {
            println!("{report}");
            Ok((Some(translator), cel))
        }
        Ok(None) => {
            println!("{} translates nothing; it only passes its hidden tools through: {}", unit.display(), description.hidden.join(", "));
            Ok((None, cel))
        }
        Err(e) => bail!("{} isn't admitted: {e:#}", unit.display()),
    }
}

fn doctor() -> Result<()> {
    let mut ok = true;
    let mut line = |good: bool, what: &str, detail: String| {
        ok &= good;
        println!("{} {what}: {detail}", if good { "✓" } else { "✗" });
    };
    println!("complier {}", env!("CARGO_PKG_VERSION"));
    match install::root() {
        Some(root) => line(true, "installed in", root.display().to_string()),
        None => line(true, "running from a checkout", concat!(env!("CARGO_MANIFEST_DIR"), "/..").to_string()),
    }
    match cel::Backend::spawn() {
        Ok(backend) => line(true, "CEL verifier", backend.version.clone()),
        Err(e) => line(false, "CEL verifier", format!("{e:#}")),
    }
    let spec = std::env::temp_dir().join(format!("complier-doctor-{}.csp", std::process::id()));
    std::fs::write(&spec, "datatype Act = a\ndatatype Value = done\nReturns(_) = {done}\nPolicy = Permit(a, \\ _ @ Policy)\n")?;
    match fdr::compile(&spec) {
        Ok(Ok(compiled)) => line(true, "FDR", format!("proved and compiled a policy ({})", compiled.report.fdr.split(" copyright").next().unwrap_or(""))),
        Ok(Err(report)) => line(false, "FDR", report.problem.unwrap_or_else(|| "the test policy wasn't admitted".into())),
        Err(e) => line(false, "FDR", format!("{e:#}")),
    }
    let _ = std::fs::remove_file(&spec);
    let plugin = match install::root() {
        Some(root) => root.join("plugin"),
        None => PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../plugin")),
    };
    line(plugin.join("hooks/hooks.json").is_file(), "Claude Code plugin", plugin.display().to_string());
    if !ok {
        bail!("complier can't run here yet; see the ✗ above");
    }
    println!("ready");
    Ok(())
}

fn verify(spec: &Path) -> Result<()> {
    match fdr::compile(spec)? {
        Ok(compiled) => {
            println!("{}", compiled.report);
            println!("actions: {}; {} states", compiled.acts.join(", "), compiled.automaton.edges.len());
            Ok(())
        }
        Err(report) => bail!("{} isn't admitted:\n{report}", spec.display()),
    }
}

fn translate(unit: &Path, tool: &str, arguments: &str) -> Result<()> {
    let (Some(translator), Some(mut cel)) = check(unit)? else { bail!("{} translates no tools", unit.display()) };
    match translator.translate(&mut cel, tool, &serde_json::from_str(arguments)?)? {
        Ok(event) => println!("{tool} -> {}", translate::show(&event)),
        Err(reason) => bail!("{tool} call refused: {reason}"),
    }
    Ok(())
}

fn machine(command: MachineCommand) -> Result<()> {
    match command {
        MachineCommand::Up { name, dir, spec, units } => {
            let (spec, units) = match (dir, spec) {
                (Some(dir), _) => workflow_dir(&dir)?,
                (None, Some(spec)) => (spec, units),
                (None, None) => bail!("give a folder, or --spec"),
            };
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
            let out = daemon::request(&daemon::Request::Act { machine: name, role, event: event.clone(), value: serde_json::Value::Null }, false)?;
            let state = out["state"].as_str().unwrap_or("?");
            match out["verdict"].as_str() {
                Some("allowed") => println!("{event} allowed; the policy is now at {state}"),
                _ => bail!("{event} {}: {}", out["verdict"].as_str().unwrap_or("?"), out["reason"].as_str().unwrap_or("")),
            }
        }
        MachineCommand::Result { name, value } => {
            let request = daemon::Request::Result { machine: name, role: String::new(), tool_use_id: String::new(), ok: true, output: String::new(), error: String::new(), value: Some(value) };
            let out = daemon::request(&request, false)?;
            println!("{} returned {}; the policy is now at {}", out["action"].as_str().unwrap_or("?"), out["value"].as_str().unwrap_or("?"), out["state"].as_str().unwrap_or("?"));
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

// Waits while the agent has nothing it may do yet; then, while the policy is still running and lets
// the agent do something, makes Claude continue instead of stopping. Outside a machine (no
// COMPLIER_MACHINE/COMPLIER_ROLE), or once the policy has finished, it lets Claude stop.
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
    if let Some(status) = delivery["ended"].as_str() {
        let reason = format!(
            "complier: machine {machine} is {status} ({}), so nothing more will happen for you and complier will refuse your actions. Tell the user; a person has to restart the machine.",
            delivery["reason"].as_str().unwrap_or("no reason given"),
        );
        println!("{}", serde_json::json!({ "decision": "block", "reason": reason }));
        return Ok(());
    }
    // The policy says when the work is done: while it is still running and lets the agent do
    // something, the agent may not stop, and is told to continue.
    let next = list("next");
    if next.is_empty() {
        return Ok(());
    }
    let reason = format!(
        "complier: machine {machine}'s policy hasn't finished, so you're not done yet. It now lets you: {}. Continue with the workflow.",
        next.join(", ")
    );
    let _ = role;
    println!("{}", serde_json::json!({ "decision": "block", "reason": reason }));
    Ok(())
}

// A workflow folder: exactly one spec (.csp) and any number of units (.yaml), in name order.
fn workflow_dir(dir: &Path) -> Result<(PathBuf, Vec<PathBuf>)> {
    let mut specs = Vec::new();
    let mut units = Vec::new();
    for entry in std::fs::read_dir(dir).with_context(|| format!("reading {}", dir.display()))? {
        let path = entry?.path();
        match path.extension().and_then(|e| e.to_str()) {
            Some("csp") => specs.push(path),
            Some("yaml") | Some("yml") => units.push(path),
            _ => {}
        }
    }
    units.sort();
    match specs.as_slice() {
        [spec] => Ok((spec.clone(), units)),
        [] => bail!("{} has no spec (.csp file)", dir.display()),
        _ => bail!("{} has more than one spec (.csp file); give one with --spec", dir.display()),
    }
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
            "admission" => println!("{time}  admitted {}", text("unit")),
            "result" => println!("{time}  result   {:<48} → {}", text("event"), text("state")),
            "policy" => println!("{time}  policy   {} ({} states, compiled by FDR)", text("spec"), entry["states"]),
            "warning" => println!("{time}  warning  {}", text("warning")),
            "status" => println!("{time}  status   {:<48} {}", text("status"), text("reason")),
            _ if text("outcome") == "allowed" => println!("{time}  {kind:<7}  {event:<48} allowed → {}", text("state")),
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
