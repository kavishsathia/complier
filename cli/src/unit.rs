// Translation units are YAML files, read as data: nothing in them runs except their CEL, which the
// CEL backend proves and evaluates (translate.rs). A unit names its service and says how the
// agent's calls of some of the service's tools become CSP events, and which tools it passes
// through unchecked:
//
//   service: ../packages/notion/service.yaml
//   translate:
//     tools: [notion-create-comment, notion-update-page]
//     schema: { page_id: optional<string>, command: optional<string> }
//     assumption: page_id.hasValue()
//     rules:
//       comment: { when: "tool == 'notion-create-comment'", emit: commented, value: page_id.value() }
//     fallback: { emit: other, value: tool }      # optional; the default event is `other`
//     timeoutMs: 10000                            # optional, per solver query
//     unroll: 5                                   # optional, how far list quantifiers unroll
//   hidden: [notion-fetch]
//
// The service file is the service's reviewed metadata: its name as registered with `complier add`,
// the tools it has reviewed as side-effect free (`readOnly`), and the file `complier gen` wrote
// with every tool the server listed and the hash of its input schema. Every tool a unit names
// must be one of those; a hidden tool must also be read-only, since it goes upstream unchecked;
// and no tool can be both hidden and translated. Paths are relative to the file that holds them.

use crate::translate::{self, Fallback, Field, Rule, Translation};
use crate::yaml::{self, Doc, Node};
use anyhow::{anyhow, bail, Context, Result};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

pub struct Unit {
    pub server: String,
    pub translation: Option<Translation>,
    pub hidden: Vec<String>,
    // Every tool the service's generated metadata lists, and its input schema hash.
    pub hashes: BTreeMap<String, String>,
}

impl Unit {
    // Every tool the unit offers: translated, then hidden.
    pub fn tools(&self) -> impl Iterator<Item = &str> {
        self.translation.iter().flat_map(|t| t.tools.iter()).chain(&self.hidden).map(String::as_str)
    }
}

struct Service {
    name: String,
    hashes: BTreeMap<String, String>,
    read_only: BTreeSet<String>,
}

fn read(path: &Path) -> Result<Node> {
    let text = std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    yaml::parse(path, &text)
}

fn relative(to: &Path, path: &str) -> PathBuf {
    to.parent().unwrap_or(Path::new(".")).join(path)
}

pub fn load(path: &Path) -> Result<Unit> {
    let root = read(path)?;
    let file = path.display().to_string();
    let doc = Doc { file: &file };
    let top = doc.fields(&root, "unit", &["service"], &["translate", "hidden"])?;

    let service_path = relative(path, doc.str(top.req("service"), "service")?);
    let service = load_service(&service_path).with_context(|| format!("{file}: loading its service"))?;
    let known = |n: &Node, tool: &str, what: &str| -> Result<()> {
        match service.hashes.contains_key(tool) {
            true => Ok(()),
            false => Err(doc.error(n, what, format!(
                "{tool} isn't a tool of {} (its generated metadata, from `complier gen {}`, doesn't list it)",
                service.name, service.name
            ))),
        }
    };

    let translation = top.get("translate").map(|n| translation(doc, n, &known)).transpose()?;
    let translated: BTreeSet<&str> = translation.iter().flat_map(|t| t.tools.iter().map(String::as_str)).collect();

    let mut hidden = Vec::new();
    if let Some(n) = top.get("hidden") {
        for (tool, at) in doc.strings(n, "hidden")? {
            known(at, tool, "hidden")?;
            if !service.read_only.contains(tool) {
                return Err(doc.error(at, "hidden", format!(
                    "{tool} goes upstream unchecked if hidden, so its service must list it as read-only, and {} doesn't",
                    service.name
                )));
            }
            if translated.contains(tool) {
                return Err(doc.error(at, "hidden", format!("{tool} is also translated; a hidden tool goes upstream unchecked, so it can't be both")));
            }
            if hidden.iter().any(|h| h == tool) {
                return Err(doc.error(at, "hidden", format!("{tool} is listed twice")));
            }
            hidden.push(tool.to_string());
        }
    }
    if translation.is_none() && hidden.is_empty() {
        bail!("{file}: the unit translates and hides nothing, so it offers no tools");
    }
    Ok(Unit { server: service.name, translation, hidden, hashes: service.hashes })
}

fn translation(doc: Doc, n: &Node, known: &dyn Fn(&Node, &str, &str) -> Result<()>) -> Result<Translation> {
    let f = doc.fields(n, "translate", &["tools", "rules"], &["schema", "assumption", "fallback", "timeoutMs", "unroll"])?;

    let mut tools: Vec<String> = Vec::new();
    let list = doc.strings(f.req("tools"), "translate.tools")?;
    if list.is_empty() {
        return Err(doc.error(f.req("tools"), "translate.tools", "list at least one tool"));
    }
    for (tool, at) in list {
        known(at, tool, "translate.tools")?;
        if tools.iter().any(|t| t == tool) {
            return Err(doc.error(at, "translate.tools", format!("{tool} is listed twice")));
        }
        tools.push(tool.to_string());
    }

    let mut schema = Vec::new();
    if let Some(n) = f.get("schema") {
        for (name, ty) in doc.map(n, "translate.schema")? {
            let what = format!("translate.schema.{name}");
            if let Some(e) = translate::field_name_problem(name) {
                return Err(doc.error(ty, &what, e));
            }
            let ty_text = doc.str(ty, &what)?;
            if let Some(e) = translate::type_problem(ty_text) {
                return Err(doc.error(ty, &what, e));
            }
            schema.push(Field { name: name.clone(), ty: ty_text.to_string() });
        }
    }

    let assumption = f.get("assumption").map(|n| doc.str(n, "translate.assumption")).transpose()?.unwrap_or_default().to_string();

    let mut rules = Vec::new();
    let entries = doc.map(f.req("rules"), "translate.rules")?;
    if entries.is_empty() {
        return Err(doc.error(f.req("rules"), "translate.rules", "add at least one rule"));
    }
    for (name, rule) in entries {
        let what = format!("translate.rules.{name}");
        if !translate::is_ident(name) {
            return Err(doc.error(rule, &what, "a rule's name must be an identifier"));
        }
        let r = doc.fields(rule, &what, &["when", "emit"], &["value"])?;
        rules.push(Rule {
            name: name.clone(),
            when: cel(doc, r.req("when"), &format!("{what}.when"))?,
            emit: event(doc, r.req("emit"), &format!("{what}.emit"))?,
            value: r.get("value").map(|v| cel(doc, v, &format!("{what}.value"))).transpose()?,
        });
    }

    let fallback = match f.get("fallback") {
        None => Fallback { emit: translate::default_fallback(&rules), value: None },
        Some(n) => {
            let fb = doc.fields(n, "translate.fallback", &["emit"], &["value"])?;
            let emit = event(doc, fb.req("emit"), "translate.fallback.emit")?;
            if let Some(rule) = rules.iter().find(|r| r.emit == emit) {
                return Err(doc.error(fb.req("emit"), "translate.fallback.emit", format!("rule {} also emits {emit}; the fallback must be a distinct CSP event", rule.name)));
            }
            Fallback { emit, value: fb.get("value").map(|v| cel(doc, v, "translate.fallback.value")).transpose()? }
        }
    };

    let timeout_ms = match f.get("timeoutMs") {
        None => 10_000,
        Some(n) => match doc.uint(n, "translate.timeoutMs")? {
            0 => return Err(doc.error(n, "translate.timeoutMs", "must be positive")),
            t => t,
        },
    };
    let unroll = match f.get("unroll") {
        None => 5,
        Some(n) => u32::try_from(doc.uint(n, "translate.unroll")?).map_err(|_| doc.error(n, "translate.unroll", "too large"))?,
    };

    let t = Translation { tools, schema, assumption, rules, fallback, timeout_ms, unroll };
    // Anything the per-field checks above don't cover (none expected); the proof checks these again.
    let (errors, _) = translate::issues(&t);
    if !errors.is_empty() {
        return Err(anyhow!("{}: translate: {}", doc.file, errors.join("; ")));
    }
    Ok(t)
}

// A CEL expression: a non-empty string, compiled and checked later by the CEL backend.
fn cel(doc: Doc, n: &Node, what: &str) -> Result<String> {
    let s = doc.str(n, what)?;
    if s.trim().is_empty() {
        return Err(doc.error(n, what, "empty CEL expression"));
    }
    Ok(s.to_string())
}

fn event(doc: Doc, n: &Node, what: &str) -> Result<String> {
    let s = doc.str(n, what)?;
    if !translate::is_event(s) {
        return Err(doc.error(n, what, format!("CSP event {s:?} must be a fixed name like edited or call.read")));
    }
    Ok(s.to_string())
}

fn load_service(path: &Path) -> Result<Service> {
    let root = read(path)?;
    let file = path.display().to_string();
    let doc = Doc { file: &file };
    let f = doc.fields(&root, "service", &["name", "tools", "readOnly"], &[])?;
    let name = doc.str(f.req("name"), "name")?.to_string();

    let tools_path = relative(path, doc.str(f.req("tools"), "tools")?);
    let generated = read(&tools_path)?;
    let tools_file = tools_path.display().to_string();
    let generated_doc = Doc { file: &tools_file };
    let g = generated_doc.fields(&generated, "generated tools", &["server", "tools"], &[])?;
    let server = generated_doc.str(g.req("server"), "server")?;
    if server != name {
        return Err(generated_doc.error(g.req("server"), "server", format!("generated for {server}, but {file} is the service {name}")));
    }
    let mut hashes = BTreeMap::new();
    for (tool, hash) in generated_doc.map(g.req("tools"), "tools")? {
        hashes.insert(tool.clone(), generated_doc.str(hash, &format!("tools.{tool}"))?.to_string());
    }

    let mut read_only = BTreeSet::new();
    for (tool, at) in doc.strings(f.req("readOnly"), "readOnly")? {
        if !hashes.contains_key(tool) {
            return Err(doc.error(at, "readOnly", format!("{tool} isn't in {}", tools_path.display())));
        }
        read_only.insert(tool.to_string());
    }
    Ok(Service { name, hashes, read_only })
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");

    // Writes `text` as a unit next to the fixtures' fake service and loads it.
    fn unit(name: &str, text: &str) -> Result<Unit> {
        let dir = std::env::temp_dir().join(format!("complier-unit-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("unit.yaml");
        std::fs::write(&path, text.replace("SERVICE", &format!("{FIXTURES}/fake/service.yaml"))).unwrap();
        let result = load(&path);
        let _ = std::fs::remove_dir_all(&dir);
        result
    }

    fn err(name: &str, text: &str) -> String {
        match unit(name, text) {
            Ok(_) => panic!("{name} loaded"),
            Err(e) => format!("{e:#}"),
        }
    }

    #[test]
    fn the_fixture_unit_loads_in_file_order_with_defaults() {
        let u = load(&Path::new(FIXTURES).join("fake.yaml")).unwrap();
        assert_eq!(u.server, "fake");
        assert_eq!(u.hidden, ["peek"]);
        let t = u.translation.unwrap();
        assert_eq!(t.tools, ["write-item", "wipe", "stale"]);
        assert_eq!(t.rules.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["append", "replace"]);
        assert_eq!(t.rules[0].value.as_deref(), Some("id.value()"));
        assert_eq!((t.fallback.emit.as_str(), t.fallback.value.as_deref()), ("other", Some("tool")));
        assert_eq!((t.timeout_ms, t.unroll), (10_000, 5));
        assert_eq!(t.schema.iter().map(|f| (f.name.as_str(), f.ty.as_str())).collect::<Vec<_>>(), [("id", "optional<string>"), ("mode", "optional<string>")]);

        let u = unit("defaults", "service: SERVICE\ntranslate:\n  tools: [wipe]\n  rules:\n    a: { when: 'true', emit: other }\n").unwrap();
        assert_eq!(u.translation.unwrap().fallback.emit, "other_2");
    }

    #[test]
    fn units_are_checked_against_their_service() {
        let rule = "  rules:\n    a: { when: 'true', emit: a }\n";
        let e = err("unknown-tool", &format!("service: SERVICE\ntranslate:\n  tools: [wipe, nope]\n{rule}"));
        assert!(e.contains("unit.yaml:3:17: translate.tools: nope isn't a tool of fake"), "{e}");
        let e = err("hidden-write", "service: SERVICE\nhidden: [peek, wipe]\n");
        assert!(e.contains("wipe goes upstream unchecked if hidden") && e.contains("read-only"), "{e}");
        let e = err("both", &format!("service: SERVICE\ntranslate:\n  tools: [peek]\n{rule}hidden: [peek]\n"));
        assert!(e.contains("peek is also translated"), "{e}");
        let e = err("nothing", "service: SERVICE\n");
        assert!(e.contains("translates and hides nothing"), "{e}");
        let e = err("no-service", "service: nowhere.yaml\nhidden: [peek]\n");
        assert!(e.contains("loading its service") && e.contains("nowhere.yaml"), "{e}");
    }

    #[test]
    fn bad_units_say_where() {
        let head = "service: SERVICE\ntranslate:\n  tools: [wipe]\n";
        for (name, body, needle) in [
            ("unknown", "  rules:\n    a: { when: 'true', emit: a, then: b }\n", "translate.rules.a: unknown field \"then\""),
            ("units-key", "  units:\n    a: { when: 'true', emit: a }\n", "unknown field \"units\""),
            ("no-emit", "  rules:\n    a: { when: 'true' }\n", "5:8: translate.rules.a: missing field \"emit\""),
            ("bool-when", "  rules:\n    a: { when: true, emit: a }\n", "translate.rules.a.when: expected a string, got a bool"),
            ("bad-event", "  rules:\n    a: { when: 'true', emit: 'a b' }\n", "CSP event \"a b\" must be a fixed name"),
            ("bad-name", "  rules:\n    a-b: { when: 'true', emit: a }\n", "a rule's name must be an identifier"),
            ("empty-when", "  rules:\n    a: { when: ' ', emit: a }\n", "empty CEL expression"),
            ("dup-rule", "  rules:\n    a: { when: 'true', emit: a }\n    a: { when: 'false', emit: b }\n", "duplicate key \"a\""),
            ("bad-type", "  schema: { x: bytes }\n  rules:\n    a: { when: 'true', emit: a }\n", "translate.schema.x: bytes: not a type"),
            ("tool-field", "  schema: { tool: string }\n  rules:\n    a: { when: 'true', emit: a }\n", "`tool` is the called tool"),
            ("nested-opt", "  schema: { x: list<optional<int>> }\n  rules:\n    a: { when: 'true', emit: a }\n", "optional<T> only goes at the top"),
            ("clash", "  rules:\n    a: { when: 'true', emit: other }\n  fallback: { emit: other }\n", "rule a also emits other"),
            ("timeout", "  rules:\n    a: { when: 'true', emit: a }\n  timeoutMs: '10'\n", "translate.timeoutMs: expected a non-negative integer, got a string"),
            ("zero", "  rules:\n    a: { when: 'true', emit: a }\n  timeoutMs: 0\n", "must be positive"),
            ("tag", "  rules: !!map\n    a: { when: 'true', emit: a }\n", "tags aren't allowed"),
            ("no-rules", "  rules: {}\n", "add at least one rule"),
        ] {
            let e = err(name, &format!("{head}{body}"));
            assert!(e.contains(needle), "{name}: {needle} not in {e}");
            assert!(e.contains("unit.yaml:"), "{name}: no location in {e}");
        }
    }
}
