// Runs a translation unit's polls: calls each polled tool on its schedule and hands every input
// event its diff produces to `on_event`. Returns when `stop` is set, or with the first error.

use crate::host::{self, Event, Host};
use anyhow::{bail, Result};
use serde_json::Value;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

// How often a sleeping poller checks whether it should stop.
const TICK: Duration = Duration::from_millis(200);

pub fn poll(unit: &Path, stop: &AtomicBool, mut on_event: impl FnMut(Event)) -> Result<()> {
    let (mut host, unit) = Host::spawn(unit)?;
    check(&unit)?;
    let mut client = crate::open(&unit.server)?;
    client.initialize()?;

    // The first result of each poll is the baseline; events come from every result after it.
    let mut prev: Vec<Option<String>> = vec![None; unit.polls.len()];
    let mut due: Vec<Instant> = vec![Instant::now(); unit.polls.len()];
    while !stop.load(Ordering::Relaxed) {
        let (i, &when) = due.iter().enumerate().min_by_key(|(_, t)| **t).unwrap();
        if Instant::now() < when {
            std::thread::sleep(TICK.min(when - Instant::now()));
            continue;
        }
        let poll = &unit.polls[i];
        due[i] = when + Duration::from_millis(poll.every);

        let result = client.call_tool(&poll.tool, poll.args.clone())?;
        if result["isError"] == true {
            bail!("{} returned an error: {}", poll.tool, text_content(&result));
        }
        let next = text_content(&result);
        if let Some(prev) = &prev[i] {
            host.diff(i, prev, &next)?.into_iter().for_each(&mut on_event);
        }
        prev[i] = Some(next);
    }
    Ok(())
}

// Polled tools run outside CSP on complier's credentials, so each must be reviewed as read-only.
pub fn check(unit: &host::Description) -> Result<()> {
    for poll in &unit.polls {
        if !unit.read_only.contains(&poll.tool) {
            bail!("{} is polled but its service doesn't list it as read-only; polling runs outside CSP", poll.tool);
        }
    }
    Ok(())
}

// A tool result's text content blocks, joined.
fn text_content(result: &Value) -> String {
    result["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|block| block["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

// `channel.value`, without JSON quotes around string values.
pub fn show(event: &Event) -> String {
    match event.value.as_str() {
        Some(value) => format!("{}.{value}", event.channel),
        None => format!("{}.{}", event.channel, event.value),
    }
}
