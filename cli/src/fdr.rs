// FDR, through complier-fdr (fdr/src/complier_fdr.cc): it proves a spec's policy and compiles it into
// the automaton a machine walks, so complier never interprets CSP itself. fdr/build-complier-fdr.sh
// builds it against the user's own FDR install and writes backend.json, which says where it is.
// FDR isn't part of complier and needs its own licence; without it no machine starts.

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Deserialize)]
struct Config {
    driver: String,
}

// backend.json as fdr/build-complier-fdr.sh writes it in this checkout, unless COMPLIER_FDR names another.
fn config_path() -> PathBuf {
    match std::env::var_os("COMPLIER_FDR") {
        Some(path) => PathBuf::from(path),
        None => PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../fdr/build/backend.json")),
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct Check {
    pub what: String,
    pub assertion: String,
    pub passed: bool,
    #[serde(default)]
    pub detail: String,
}

#[derive(Deserialize)]
struct ProblemJson {
    stage: String,
    message: String,
}

#[derive(Deserialize)]
struct TransitionJson {
    from: usize,
    event: String,
    to: usize,
}

#[derive(Deserialize)]
struct AutomatonJson {
    root: usize,
    states: Vec<String>,
    transitions: Vec<TransitionJson>,
}

#[derive(Deserialize)]
struct Output {
    fdr: String,
    admitted: bool,
    error: Option<ProblemJson>,
    #[serde(default)]
    roles: Vec<String>,
    #[serde(default)]
    acts: Vec<String>,
    #[serde(default)]
    checks: Vec<Check>,
    automaton: Option<AutomatonJson>,
}

// The compiled policy: normal(Policy) as FDR built it. Each state's outgoing events, by name
// (`attempt.writer.draft`, `allow.writer.draft`, `deny.writer.draft`, `✓`); FDR normalised it, so
// each event leads to exactly one state.
#[derive(Clone, Debug)]
pub struct Automaton {
    pub root: usize,
    // FDR's name for each state, for logs.
    pub labels: Vec<String>,
    pub edges: Vec<BTreeMap<String, usize>>,
}

impl Automaton {
    #[cfg(test)]
    pub fn from_transitions(labels: Vec<String>, root: usize, transitions: &[(usize, &str, usize)]) -> Self {
        let mut edges = vec![BTreeMap::new(); labels.len()];
        for &(from, event, to) in transitions {
            edges[from].insert(event.to_string(), to);
        }
        Self { root, labels, edges }
    }
}

// What FDR said about a spec.
pub struct Report {
    pub fdr: String,
    pub checks: Vec<Check>,
    pub problem: Option<String>,
    pub admitted: bool,
}

impl fmt::Display for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "{}", self.fdr.split(" copyright").next().unwrap_or(&self.fdr))?;
        if let Some(p) = &self.problem {
            writeln!(f, "  error: {p}")?;
        }
        for c in &self.checks {
            write!(f, "  {} {} ({})", if c.passed { "✓" } else { "✗" }, c.what, c.assertion)?;
            if !c.passed && !c.detail.is_empty() {
                write!(f, ": {}", c.detail)?;
            }
            writeln!(f)?;
        }
        write!(f, "{}", if self.admitted { "admitted: FDR proved the policy and compiled it" } else { "NOT admitted" })
    }
}

pub struct Compiled {
    pub roles: Vec<String>,
    pub acts: Vec<String>,
    pub automaton: Automaton,
    pub report: Report,
}

// Has FDR prove and compile the spec. Ok(Err(report)) when FDR ran but didn't admit it; Err when
// FDR couldn't run at all.
pub fn compile(spec: &Path) -> Result<std::result::Result<Compiled, Report>> {
    let path = config_path();
    let text = std::fs::read_to_string(&path).with_context(|| {
        format!(
            "no FDR backend at {} (complier uses your own FDR: install it from https://cocotec.io/fdr/, get its licence, then run fdr/build-complier-fdr.sh, or point COMPLIER_FDR at its backend.json)",
            path.display()
        )
    })?;
    let config: Config = serde_json::from_str(&text).with_context(|| format!("reading {}", path.display()))?;
    let out = Command::new(&config.driver)
        .arg("compile")
        .arg(spec)
        .output()
        .with_context(|| format!("running {}", config.driver))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let Some(line) = stdout.lines().rev().find(|l| l.starts_with('{')) else {
        bail!("{} gave no answer: {}", config.driver, String::from_utf8_lossy(&out.stderr).trim());
    };
    let o: Output = serde_json::from_str(line).map_err(|e| anyhow!("reading complier-fdr's answer: {e}"))?;
    let report = Report {
        fdr: o.fdr,
        checks: o.checks,
        problem: o.error.map(|p| format!("{}: {}", p.stage, p.message)),
        admitted: o.admitted,
    };
    let automaton = match (o.admitted, o.automaton) {
        (true, Some(a)) => a,
        _ => return Ok(Err(report)),
    };
    let mut edges = vec![BTreeMap::new(); automaton.states.len()];
    for t in automaton.transitions {
        if t.from >= edges.len() || t.to >= edges.len() {
            bail!("complier-fdr's automaton has a transition out of range");
        }
        edges[t.from].insert(t.event, t.to);
    }
    Ok(Ok(Compiled {
        roles: o.roles,
        acts: o.acts,
        automaton: Automaton { root: automaton.root, labels: automaton.states, edges },
        report,
    }))
}
