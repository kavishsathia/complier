// Saved workflows: a spec and its units, proven and kept under ~/.complier/workflows/<name>/ on this
// computer, so a workflow found in one Claude Code or Codex session can be applied again in later ones.
//
// Applying a workflow starts its machine and binds one session to it: the session's id is recorded
// in ~/.complier/sessions/<id>.json, and complier's hooks, which get the session id with every call,
// then enforce the machine exactly as they do for COMPLIER_MACHINE and COMPLIER_ROLE. Saving a file
// enforces nothing; only an applied workflow constrains a session, and only through the hooks, so a
// Codex session is bound only once Codex is known to run them there.

use crate::daemon;
use crate::harness::{self, Harness};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

// workflow.toml, next to the saved spec and units.
#[derive(Serialize, Deserialize)]
pub struct About {
    pub description: String,
    // The request that made the workflow look repeatable, for finding out where workflows get used.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub noticed: String,
    pub created: String,
}

// A session bound to an applied workflow's machine.
#[derive(Serialize, Deserialize)]
pub struct Binding {
    pub workflow: String,
    pub machine: String,
    pub role: String,
    #[serde(default)]
    pub harness: Harness,
}

pub fn dir() -> Result<PathBuf> {
    Ok(daemon::dir()?.join("workflows"))
}

fn sessions() -> Result<PathBuf> {
    Ok(daemon::dir()?.join("sessions"))
}

// The machine an applied workflow runs as.
pub fn machine_name(workflow: &str) -> String {
    format!("workflow-{workflow}")
}

pub fn valid_id(name: &str) -> bool {
    !name.is_empty() && name.len() <= 128 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn valid(what: &str, name: &str) -> Result<()> {
    if !valid_id(name) {
        bail!("{what} {name:?} must be letters, digits, - and _ only");
    }
    Ok(())
}

fn folder(name: &str) -> Result<PathBuf> {
    valid("workflow name", name)?;
    let path = dir()?.join(name);
    if !path.join("workflow.toml").is_file() {
        bail!("no saved workflow named {name} (see `complier workflow ls`)");
    }
    Ok(path)
}

fn about(path: &Path) -> Result<About> {
    let text = std::fs::read_to_string(path.join("workflow.toml"))?;
    Ok(toml::from_str(&text)?)
}

// Proves a workflow folder's spec (FDR) and units (CEL), as `machine up` would, then copies them into
// the store. Nothing unproven is saved, and an existing workflow is only replaced with --replace.
pub fn save(name: &str, source: &Path, description: &str, noticed: &str, replace: bool) -> Result<()> {
    valid("workflow name", name)?;
    if description.trim().is_empty() {
        bail!("give the workflow a --description: what it makes the agent do");
    }
    let (spec, units) = crate::workflow_dir(source)?;
    for unit in &units {
        let text = std::fs::read_to_string(unit)?;
        if let Some(service) = text.lines().find_map(|l| l.strip_prefix("service:")) {
            let service = service.trim().trim_matches(|c| c == '"' || c == '\'');
            if service.contains('/') || service.ends_with(".yaml") {
                bail!("{}: a saved workflow's units must name a service complier ships (e.g. claude-code, notion), not a path ({service})", unit.display());
            }
        }
        crate::check(unit).with_context(|| format!("{} can't be saved", unit.display()))?;
    }
    crate::verify(&spec).with_context(|| format!("{} can't be saved", spec.display()))?;

    let target = dir()?.join(name);
    if target.exists() {
        if !replace {
            bail!("a workflow named {name} is already saved; pass --replace to overwrite it");
        }
        std::fs::remove_dir_all(&target)?;
    }
    std::fs::create_dir_all(&target)?;
    for file in std::iter::once(&spec).chain(&units) {
        std::fs::copy(file, target.join(file.file_name().unwrap()))?;
    }
    let about = About {
        description: description.trim().to_string(),
        noticed: noticed.trim().to_string(),
        created: chrono::Local::now().format("%Y-%m-%d %H:%M").to_string(),
    };
    std::fs::write(target.join("workflow.toml"), toml::to_string(&about)?)?;
    println!("saved workflow {name} in {}", target.display());
    println!("It isn't applied to anything yet. Apply it to a Claude Code or Codex session with: complier workflow apply {name}");
    Ok(())
}

// Saved workflows, by name.
pub fn list() -> Result<Vec<(String, About)>> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir()?) else { return Ok(out) };
    for entry in entries {
        let path = entry?.path();
        if let (Some(name), Ok(about)) = (path.file_name().and_then(|n| n.to_str()), about(&path)) {
            out.push((name.to_string(), about));
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

pub fn ls() -> Result<()> {
    let bound = bindings()?;
    for (name, about) in list()? {
        let applied = bound.iter().filter(|(_, b)| b.workflow == name).count();
        let state = if applied > 0 { format!("applied to {applied} session(s)") } else { "saved".into() };
        println!("{name}\t{state}\t{}", about.description);
    }
    Ok(())
}

pub fn show(name: &str) -> Result<()> {
    let path = folder(name)?;
    let about = about(&path)?;
    println!("workflow {name}: {}", about.description);
    if !about.noticed.is_empty() {
        println!("noticed from: {}", about.noticed);
    }
    println!("saved {} in {}", about.created, path.display());
    let mut files: Vec<PathBuf> = std::fs::read_dir(&path)?.filter_map(|e| e.ok().map(|e| e.path())).collect();
    files.sort();
    for file in files.iter().filter(|f| f.file_name().is_some_and(|n| n != "workflow.toml")) {
        println!("\n--- {} ---\n{}", file.file_name().unwrap().to_string_lossy(), std::fs::read_to_string(file)?.trim_end());
    }
    Ok(())
}

// The session to bind and its harness: --session, else the one the harness tells the commands it
// runs (CLAUDE_CODE_SESSION_ID, CODEX_SESSION_ID). The harness is --harness, else the one the
// session's hooks recorded, else the one whose variable gave the session, else Claude Code.
fn session_id(given: Option<String>, harness: Option<Harness>) -> Result<(String, Harness)> {
    let from_env = |h: Harness| std::env::var(h.session_env()).ok().filter(|s| !s.is_empty()).map(|s| (s, h));
    let (id, env_harness) = match given.filter(|s| !s.is_empty()) {
        Some(id) => (id, None),
        None => match harness.map(from_env).unwrap_or_else(|| match (from_env(Harness::Claude), from_env(Harness::Codex)) {
            // One harness started from inside the other inherits the outer one's variable too, so
            // which session this is can't be told: say it.
            (Some(_), Some(_)) => None,
            (claude, codex) => claude.or(codex),
        }) {
            Some((id, h)) => (id, Some(h)),
            None if harness.is_none() && from_env(Harness::Claude).is_some() && from_env(Harness::Codex).is_some() => bail!(
                "both {} and {} are set (one harness was started from inside the other), so which session to bind can't be told: pass --harness claude or --harness codex",
                Harness::Claude.session_env(),
                Harness::Codex.session_env()
            ),
            None => (
                std::env::var("COMPLIER_SESSION").ok().filter(|s| !s.is_empty()).context(
                    "no session to apply the workflow to: run this from inside Claude Code or Codex, or pass --session <id>",
                )?,
                None,
            ),
        },
    };
    valid("session id", &id)?;
    let harness = harness.or_else(|| harness::live(&id)).or(env_harness).unwrap_or_default();
    Ok((id, harness))
}

// A harness whose hooks run only once trusted (Codex) enforces nothing in a session they don't run
// in, so the workflow is applied only where they demonstrably do: they ran when this session
// started, and Codex says it runs every one of them here now.
fn hooks_run(session: &str, harness: Harness) -> Result<()> {
    if !harness.hooks_need_trust() {
        return Ok(());
    }
    if harness::live(session) != Some(harness) {
        bail!(
            "complier's {} hooks didn't run when session {session} started, so a workflow applied to it would enforce nothing. Install and trust them (complier doctor says how), start a new {} session, and apply it there.",
            harness.name(),
            harness.name()
        );
    }
    let here = std::env::current_dir()?;
    let hooks = harness::codex_hooks(&here)?;
    if !hooks.ready() {
        bail!("not applying: {}", hooks.explain(&here));
    }
    Ok(())
}

// Starts the workflow's machine and binds the session to it. From then on the session's tool calls
// are checked against the workflow by complier's hooks.
pub fn apply(name: &str, role: &str, session: Option<String>, harness: Option<Harness>) -> Result<()> {
    let path = folder(name)?;
    let (session, harness) = session_id(session, harness)?;
    let binding_path = sessions()?.join(format!("{session}.json"));
    if let Ok(existing) = read_binding(&binding_path) {
        bail!("this session already follows workflow {}; release it first (complier workflow release {})", existing.workflow, existing.workflow);
    }
    hooks_run(&session, harness)?;
    let (spec, units) = crate::workflow_dir(&path)?;
    let machine = machine_name(name);
    if bindings()?.iter().any(|(_, b)| b.machine == machine) {
        bail!("workflow {name} is applied to another session; release it first (complier workflow release {name})");
    }
    // A machine left over from an earlier, released run of the workflow is replaced.
    let _ = daemon::request(&daemon::Request::MachineDown { name: machine.clone() }, false);
    let request = daemon::Request::MachineUp { name: machine.clone(), spec, units: units.clone() };
    daemon::request(&request, true).with_context(|| format!("starting workflow {name}"))?;
    std::fs::create_dir_all(sessions()?)?;
    let binding = Binding { workflow: name.to_string(), machine: machine.clone(), role: role.to_string(), harness };
    std::fs::write(&binding_path, serde_json::to_string_pretty(&binding)?)?;

    let info = daemon::request(&daemon::Request::MachineInfo { machine: machine.clone(), role: role.to_string() }, false)?;
    let next: Vec<&str> = info["next"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    let services: Vec<String> = units
        .iter()
        .filter_map(|u| std::fs::read_to_string(u).ok())
        .filter_map(|t| t.lines().find_map(|l| l.trim().strip_prefix("service:").map(|s| s.trim().trim_matches(|c| c == '"' || c == '\'').to_string())))
        .collect();
    let builtin = harness.builtin_service();
    let others: Vec<&String> = services.iter().filter(|s| *s != builtin && Harness::of_builtin_service(s).is_some()).collect();
    println!("workflow {name} applied to {} session {session} as machine {machine}", harness.name());
    let checked = if services.iter().any(|s| s == builtin) {
        format!(", and the built-in tools its {builtin} unit names (others are blocked)")
    } else if !others.is_empty() {
        format!(
            "; its units cover only {}'s built-in tools, not {}'s, so this session's built-in tools are all blocked (a {builtin} unit would name the ones it may use)",
            others.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "),
            harness.name()
        )
    } else {
        format!(" (built-in tools aren't, since no unit covers {builtin})")
    };
    println!("checked from now on: every MCP tool call{checked}");
    println!("allowed now: {}", if next.is_empty() { "nothing yet".into() } else { next.join(", ") });
    println!("The session is held to the workflow until its policy finishes. To stop early, run this in your own terminal: complier workflow release {name}");
    Ok(())
}

// Ends an applied workflow: its machine stops and every session bound to it is let go.
pub fn release(name: &str) -> Result<()> {
    valid("workflow name", name)?;
    let machine = machine_name(name);
    let mut released = 0;
    for (path, binding) in bindings()? {
        if binding.machine == machine {
            std::fs::remove_file(path)?;
            released += 1;
        }
    }
    let stopped = daemon::request(&daemon::Request::MachineDown { name: machine.clone() }, false).is_ok();
    if released == 0 && !stopped {
        bail!("workflow {name} isn't applied anywhere");
    }
    println!("released workflow {name}: {released} session(s) let go{}", if stopped { ", machine stopped" } else { "" });
    Ok(())
}

pub fn remove(name: &str) -> Result<()> {
    let path = folder(name)?;
    if bindings()?.iter().any(|(_, b)| b.workflow == name) {
        bail!("workflow {name} is applied; release it first (complier workflow release {name})");
    }
    std::fs::remove_dir_all(&path)?;
    println!("removed workflow {name}");
    Ok(())
}

fn read_binding(path: &Path) -> Result<Binding> {
    Ok(serde_json::from_str(&std::fs::read_to_string(path)?)?)
}

fn bindings() -> Result<Vec<(PathBuf, Binding)>> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(sessions()?) else { return Ok(out) };
    for entry in entries {
        let path = entry?.path();
        if let Ok(binding) = read_binding(&path) {
            out.push((path, binding));
        }
    }
    Ok(out)
}

// The workflow a hook's session is bound to, if any.
pub fn bound(session: &str) -> Option<(PathBuf, Binding)> {
    valid("session id", session).ok()?;
    let path = sessions().ok()?.join(format!("{session}.json"));
    let binding = read_binding(&path).ok()?;
    Some((path, binding))
}

// A finished workflow lets its session go: the policy terminated, so it constrains nothing further.
pub fn finish(path: &Path, binding: &Binding) {
    let _ = std::fs::remove_file(path);
    let _ = daemon::request(&daemon::Request::MachineDown { name: binding.machine.clone() }, false);
}
