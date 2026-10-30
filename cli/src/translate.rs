// Output translation: a unit's CEL rules, the proofs that admit them, and the classification of an
// agent's tool calls into CSP events. It is the website's CEL translation units
// (kavishsathia.vercel.app/tools/cel/units, src/lib/cel/units.ts) brought to the runtime: the same
// queries, the same reading of the verifier's statuses and the same classification, with nothing
// decided here; cel-java's runtime decides which rules a call matches and its verifier answers the
// proofs. A unit's `rules` are the website's `units`. What tool calls add:
// - the concrete event is bound from the call: `tool` is the called tool and every other schema
//   field the argument of that name, written as a CEL literal and type-checked against the field's
//   declared type by cel-java (an `optional<T>` field binds optional.none() when absent);
// - the domain is `tool in [tools] && assumption`, so the proofs cover exactly the calls routed here;
// - a rule can carry a value: a CEL expression whose result, as JSON, is the event's value. Values
//   are compiled when the unit is admitted but aren't part of the proof.

use crate::cel::Backend;
use crate::unit::Unit;
use anyhow::{bail, Result};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

// A unit's translation as its YAML file gives it (unit.rs reads and validates the file), in file
// order, with the defaults filled in.
#[derive(Clone, Debug)]
pub struct Translation {
    pub tools: Vec<String>,
    pub schema: Vec<Field>,
    pub assumption: String,
    pub rules: Vec<Rule>,
    pub fallback: Fallback,
    pub timeout_ms: u64,
    pub unroll: u32,
    // How a call's result becomes the value the policy binds: per action, a CEL expression over
    // RESULT_VARS giving the value as the spec writes it (`done`, `minutes.37`), or the default.
    pub results: BTreeMap<String, String>,
    pub result_default: Option<String>,
}

// What a result expression sees: whether the call succeeded, its output (a Bash call's stdout, or
// any other tool's response as JSON), and its error if it failed.
pub const RESULT_VARS: &str = "ok:bool\noutput:string\nerror:string";

#[derive(Clone, Debug)]
pub struct Field {
    pub name: String,
    pub ty: String,
}

#[derive(Clone, Debug)]
pub struct Rule {
    pub name: String,
    pub when: String,
    pub emit: String,
    pub value: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Fallback {
    pub emit: String,
    pub value: Option<String>,
}

// What a translated call becomes: a CSP event and its value, for the machine to check.
#[derive(Clone, Debug, PartialEq)]
pub struct Event {
    pub channel: String,
    pub value: Value,
}

// `channel.value`, without JSON quotes around string values.
pub fn show(event: &Event) -> String {
    match event.value.as_str() {
        Some(value) => format!("{}.{value}", event.channel),
        None => format!("{}.{}", event.channel, event.value),
    }
}

// `other`, or `other_2`, `other_3`... if a rule already emits it.
pub fn default_fallback(rules: &[Rule]) -> String {
    let taken: BTreeSet<&str> = rules.iter().map(|r| r.emit.as_str()).collect();
    if !taken.contains("other") {
        return "other".into();
    }
    (2..).map(|i| format!("other_{i}")).find(|e| !taken.contains(e.as_str())).unwrap()
}

// ---- types and literals --------------------------------------------------------------------

// The field types a tool call's JSON arguments can be bound to. The verifier's own parser
// (VerificationOptions.parseCelType) is authoritative; this only decides how to write a literal.
#[derive(Clone, Debug, PartialEq)]
enum Ty {
    Bool,
    Int,
    Uint,
    Double,
    String,
    Dyn,
    List(Box<Ty>),
    Map(Box<Ty>),
    Optional(Box<Ty>),
}

fn parse_type(text: &str) -> Result<Ty, String> {
    let s = text.trim().to_lowercase();
    let inner = |prefix: &str| s.strip_prefix(prefix).and_then(|r| r.strip_suffix('>')).map(str::trim);
    if let Some(t) = inner("list<") {
        return Ok(Ty::List(Box::new(parse_type(t)?)));
    }
    if let Some(t) = inner("optional<").or_else(|| inner("optional_type<")) {
        return Ok(Ty::Optional(Box::new(parse_type(t)?)));
    }
    if let Some(t) = inner("map<") {
        let mut depth = 0;
        let comma = t.char_indices().find(|&(_, c)| {
            depth += (c == '<') as i32 - (c == '>') as i32;
            c == ',' && depth == 0
        });
        let Some((at, _)) = comma else { return Err(format!("{text}: expected map<key, value>")) };
        if parse_type(&t[..at])? != Ty::String {
            return Err(format!("{text}: JSON object keys are strings, so only map<string, V> can be bound"));
        }
        return Ok(Ty::Map(Box::new(parse_type(&t[at + 1..])?)));
    }
    match s.as_str() {
        "bool" | "boolean" => Ok(Ty::Bool),
        "int" => Ok(Ty::Int),
        "uint" => Ok(Ty::Uint),
        "double" | "float" => Ok(Ty::Double),
        "string" => Ok(Ty::String),
        "dyn" => Ok(Ty::Dyn),
        _ => Err(format!("{text}: not a type a JSON argument can be bound to (bool, int, uint, double, string, dyn, list<T>, map<string, V>, optional<T>)")),
    }
}

// A CEL string literal.
fn quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c as u32 == 0x7f => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn kind(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "a bool",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}

fn double(f: f64) -> String {
    // Debug keeps a decimal point or exponent ("5.0", "1e300"), which CEL needs for a double.
    format!("{f:?}")
}

// The JSON value `v` as a CEL literal of type `ty`; cel-java then type-checks it against the field.
fn literal(ty: &Ty, v: &Value) -> Result<String, String> {
    let wrong = || Err(format!("expected {}, got {}", describe(ty), kind(v)));
    match (ty, v) {
        (Ty::Dyn, v) => Ok(dyn_literal(v)),
        (Ty::Bool, Value::Bool(b)) => Ok(b.to_string()),
        (Ty::Int, Value::Number(n)) => n.as_i64().map(|n| n.to_string()).ok_or_else(|| format!("expected an int, got {n}")),
        (Ty::Uint, Value::Number(n)) => n.as_u64().map(|n| format!("{n}u")).ok_or_else(|| format!("expected a uint, got {n}")),
        (Ty::Double, Value::Number(n)) => n.as_f64().map(double).ok_or_else(|| format!("expected a double, got {n}")),
        (Ty::String, Value::String(s)) => Ok(quote(s)),
        (Ty::List(t), Value::Array(items)) => {
            let items = items.iter().map(|i| literal(t, i)).collect::<Result<Vec<_>, _>>()?;
            Ok(format!("[{}]", items.join(", ")))
        }
        (Ty::Map(t), Value::Object(entries)) => {
            let entries = entries.iter().map(|(k, v)| Ok(format!("{}: {}", quote(k), literal(t, v)?))).collect::<Result<Vec<_>, String>>()?;
            Ok(format!("{{{}}}", entries.join(", ")))
        }
        (Ty::Optional(t), v) => Ok(format!("optional.of({})", literal(t, v)?)),
        _ => wrong(),
    }
}

fn dyn_literal(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => match (n.as_i64(), n.as_u64()) {
            (Some(i), _) => i.to_string(),
            (None, Some(u)) => format!("{u}u"),
            _ => double(n.as_f64().unwrap_or(f64::NAN)),
        },
        Value::String(s) => quote(s),
        Value::Array(items) => format!("[{}]", items.iter().map(dyn_literal).collect::<Vec<_>>().join(", ")),
        Value::Object(entries) => {
            format!("{{{}}}", entries.iter().map(|(k, v)| format!("{}: {}", quote(k), dyn_literal(v))).collect::<Vec<_>>().join(", "))
        }
    }
}

fn describe(ty: &Ty) -> String {
    match ty {
        Ty::Bool => "a bool".into(),
        Ty::Int => "an int".into(),
        Ty::Uint => "a uint".into(),
        Ty::Double => "a double".into(),
        Ty::String => "a string".into(),
        Ty::Dyn => "any value".into(),
        Ty::List(t) => format!("a list of {}", describe(t)),
        Ty::Map(t) => format!("an object of {}", describe(t)),
        Ty::Optional(t) => describe(t),
    }
}

// ---- configuration -------------------------------------------------------------------------

pub fn is_ident(s: &str) -> bool {
    let mut cs = s.chars();
    cs.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && cs.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

// A fixed CSP event name: dotted identifiers, as in `edited` or `call.read`.
pub fn is_event(s: &str) -> bool {
    let mut parts = s.split('.');
    parts.next().is_some_and(is_ident) && parts.all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
}

// What's wrong with a schema field's name, if anything.
pub fn field_name_problem(name: &str) -> Option<String> {
    if !is_ident(name) {
        Some(format!("field {name:?} must be an identifier (it's the argument's name)"))
    } else if name == "tool" {
        Some("`tool` is the called tool's name and is always declared; don't declare it".into())
    } else {
        None
    }
}

// What's wrong with a schema field's type, if anything.
pub fn type_problem(ty: &str) -> Option<String> {
    match parse_type(ty) {
        Err(e) => Some(e),
        Ok(t) if contains_optional(&t, true) => Some("optional<T> only goes at the top of a field (it says the argument may be absent)".into()),
        Ok(_) => None,
    }
}

// Problems with the translation itself, before any solver is involved: (errors, warnings).
pub fn issues(t: &Translation) -> (Vec<String>, Vec<String>) {
    let (mut errors, mut warnings) = (Vec::new(), Vec::new());
    if t.tools.is_empty() {
        errors.push("translate no tools: list at least one in `tools`".to_string());
    }
    let mut seen = BTreeSet::new();
    for tool in &t.tools {
        if !seen.insert(tool) {
            errors.push(format!("tool {tool} is listed twice"));
        }
    }
    let mut fields = BTreeSet::new();
    for f in &t.schema {
        if let Some(e) = field_name_problem(&f.name) {
            errors.push(format!("schema: {e}"));
        } else if !fields.insert(&f.name) {
            errors.push(format!("schema: field {} declared twice", f.name));
        }
        if let Some(e) = type_problem(&f.ty) {
            errors.push(format!("schema: {}: {e}", f.name));
        }
    }
    if t.rules.is_empty() {
        errors.push("add at least one rule".to_string());
    }
    let mut names = BTreeMap::new();
    let mut emits: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for u in &t.rules {
        if !is_ident(&u.name) {
            errors.push(format!("rule {:?}: name must be an identifier", u.name));
        }
        *names.entry(&u.name).or_insert(0) += 1;
        if !is_event(&u.emit) {
            errors.push(format!("rule {}: CSP event {:?} must be a fixed name like edited or call.read", u.name, u.emit));
        } else {
            emits.entry(&u.emit).or_default().push(&u.name);
        }
        if u.when.trim().is_empty() {
            errors.push(format!("rule {}: empty predicate", u.name));
        }
    }
    for (name, n) in names {
        if n > 1 {
            errors.push(format!("rule name {name} is used {n} times; names must be unique"));
        }
    }
    if !is_event(&t.fallback.emit) {
        errors.push(format!("fallback: CSP event {:?} must be a fixed name like other", t.fallback.emit));
    } else if let Some(rules) = emits.get(t.fallback.emit.as_str()) {
        errors.push(format!("fallback event {} is also emitted by {}; it must be a distinct CSP event", t.fallback.emit, rules.join(", ")));
    }
    for (event, rules) in emits {
        if rules.len() > 1 {
            warnings.push(format!("{} all emit {event}: they're still proven pairwise disjoint, but the spec can't tell them apart", rules.join(", ")));
        }
    }
    if t.timeout_ms == 0 {
        errors.push("timeoutMs must be positive".to_string());
    }
    (errors, warnings)
}

fn contains_optional(ty: &Ty, top: bool) -> bool {
    match ty {
        Ty::Optional(t) => !top || contains_optional(t, false),
        Ty::List(t) | Ty::Map(t) => contains_optional(t, false),
        _ => false,
    }
}

// ---- queries (as units.ts builds them) -----------------------------------------------------

// Conjunction of CEL sources, each kept intact on its own lines (so `//` comments stay comments).
fn conjoin(exprs: &[&str]) -> String {
    exprs.iter().map(|e| format!("(\n{}\n)", if e.trim().is_empty() { "true" } else { e })).collect::<Vec<_>>().join(" && ")
}

// `(P1) || ... || (Pn)`: some rule matches.
fn union(preds: &[&str]) -> String {
    if preds.is_empty() {
        return "false".into();
    }
    preds.iter().map(|p| format!("(\n{p}\n)")).collect::<Vec<_>>().join(" || ")
}

// The generated fallback predicate: no rule matches.
fn fallback_pred(preds: &[&str]) -> String {
    format!("!(\n{}\n)", union(preds))
}

// isAlwaysTrue: every in-domain call is matched by a rule or the fallback. Not a tautology in CEL:
// a predicate that errors in the domain makes the disjunction an error, which the verifier reports
// as a counterexample (and the runtime refuses such a call rather than sending it to the fallback).
fn exhaustive_query(domain: &str, preds: &[&str]) -> String {
    let rules = if preds.is_empty() { String::new() } else { format!("{} || ", union(preds)) };
    format!("!(\n{domain}\n) || {rules}(\n{}\n)", fallback_pred(preds))
}

impl Translation {
    // The domain every proof is under and every call is checked against.
    pub fn domain(&self) -> String {
        let tools = self.tools.iter().map(|t| quote(t)).collect::<Vec<_>>().join(", ");
        conjoin(&[&format!("tool in [{tools}]"), &self.assumption])
    }

    // The verifier's variable declarations: `tool`, then the schema.
    pub fn vars(&self) -> String {
        let mut vars = vec!["tool:string".to_string()];
        vars.extend(self.schema.iter().map(|f| format!("{}:{}", f.name, f.ty)));
        vars.join("\n")
    }

    fn preds(&self) -> Vec<&str> {
        self.rules.iter().map(|u| u.when.as_str()).collect()
    }

    fn verify(&self, cel: &mut Backend, op: &str, expr: &str) -> Result<Value> {
        cel.request(json!({ "op": op, "expr": expr, "vars": self.vars(), "timeoutMs": self.timeout_ms, "unroll": self.unroll }))
    }
}

// ---- verdicts ------------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub enum Verdict {
    Proved,
    Refuted { detail: String, witness: Vec<(String, String)> },
    NotProven { detail: String, witness: Vec<(String, String)> },
    Error(String),
}

fn failure(out: &Value) -> String {
    let error = out["error"].as_str().unwrap_or_default();
    match out["kind"].as_str() {
        Some("compile") => error.to_string(),
        _ => out["rootError"].as_str().filter(|r| !r.is_empty()).unwrap_or(error).to_string(),
    }
}

// Reads isSatisfiable(q) back as an answer to "is q empty?". cel-java maps an exact Z3 model to
// VERIFIED, no model in any of its passes to VIOLATED, and anything approximate, cut off by the
// unroll bound or solver-unknown to INCONCLUSIVE; a timeout throws. Only VIOLATED proves emptiness.
fn read_emptiness(out: &Value) -> Verdict {
    if out["ok"] != true {
        return Verdict::Error(failure(out));
    }
    let message = out["message"].as_str().unwrap_or_default().to_string();
    match out["status"].as_str() {
        Some("VIOLATED") => Verdict::Proved,
        Some("VERIFIED") => Verdict::Refuted { witness: parse_witness(&message), detail: message },
        _ => Verdict::NotProven { witness: parse_witness(&message), detail: message },
    }
}

// Reads isAlwaysTrue(q) back as an answer to "does q hold everywhere?": no counterexample at all is
// VERIFIED, an exact one VIOLATED, anything else INCONCLUSIVE; a timeout throws.
fn read_validity(out: &Value) -> Verdict {
    if out["ok"] != true {
        return Verdict::Error(failure(out));
    }
    let message = out["message"].as_str().unwrap_or_default().to_string();
    match out["status"].as_str() {
        Some("VERIFIED") => Verdict::Proved,
        Some("VIOLATED") => Verdict::Refuted { witness: parse_witness(&message), detail: message },
        _ => Verdict::NotProven { witness: parse_witness(&message), detail: message },
    }
}

// The model cel-java prints after "Satisfying input:" (one `  name = value` line per constant),
// with Z3 strings and negative numerals rewritten as CEL literals. Unconstrained fields don't appear.
pub fn parse_witness(message: &str) -> Vec<(String, String)> {
    let markers = ["Satisfying input:", "Counterexample input:", "Potential satisfying input:", "Potential counterexample input:"];
    let Some(at) = markers.iter().filter_map(|m| message.find(m)).min() else { return vec![] };
    message[at..]
        .lines()
        .skip(1)
        .filter_map(|line| {
            let rest = line.strip_prefix("  ")?;
            let (name, value) = rest.split_once(" = ")?;
            is_ident(name).then(|| (name.to_string(), z3_to_cel(value)))
        })
        .collect()
}

fn z3_to_cel(v: &str) -> String {
    if let Some(n) = v.strip_prefix("(- ").and_then(|r| r.strip_suffix(')')) {
        return format!("-{n}");
    }
    if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
        let body = v[1..v.len() - 1].replace("\"\"", "\"");
        // Z3 writes non-ASCII as \u{hex}.
        let mut out = String::new();
        let mut rest = body.as_str();
        while let Some(i) = rest.find("\\u{") {
            out.push_str(&rest[..i]);
            let tail = &rest[i + 3..];
            match tail.find('}').and_then(|j| u32::from_str_radix(&tail[..j], 16).ok().and_then(char::from_u32).map(|c| (c, j))) {
                Some((c, j)) => {
                    out.push(c);
                    rest = &tail[j + 1..];
                }
                None => {
                    out.push_str("\\u{");
                    rest = tail;
                }
            }
        }
        out.push_str(rest);
        return quote(&out);
    }
    v.to_string()
}

fn show_witness(w: &[(String, String)]) -> String {
    if w.is_empty() {
        return "any call (no field constrained)".into();
    }
    w.iter().map(|(k, v)| format!("{k} = {v}")).collect::<Vec<_>>().join(", ")
}

// ---- admission -----------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Role {
    // Must hold for the unit to be admitted.
    Required,
    // Reported only.
    Info,
}

#[derive(Clone, Debug)]
pub struct Check {
    pub what: String,
    pub role: Role,
    pub verdict: Verdict,
    // What the verdict means here: "disjoint", "overlap", ...
    pub reading: String,
    pub passed: bool,
}

#[derive(Debug)]
pub struct Report {
    pub backend: String,
    pub domain: String,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub checks: Vec<Check>,
    pub admitted: bool,
}

impl fmt::Display for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "CEL backend: {}", self.backend)?;
        writeln!(f, "domain: {}", self.domain.split_whitespace().collect::<Vec<_>>().join(" "))?;
        for e in &self.errors {
            writeln!(f, "  error: {e}")?;
        }
        for w in &self.warnings {
            writeln!(f, "  warning: {w}")?;
        }
        for c in &self.checks {
            let mark = match (c.role, c.passed) {
                (Role::Required, true) => "✓",
                (Role::Required, false) => "✗",
                (Role::Info, _) => "·",
            };
            write!(f, "  {mark} {}: {}", c.what, c.reading)?;
            match &c.verdict {
                Verdict::Refuted { witness, detail } if witness.is_empty() => write!(f, " ({})", first_line(detail))?,
                Verdict::Refuted { witness, .. } => write!(f, ", e.g. {}", show_witness(witness))?,
                Verdict::NotProven { detail, witness } if !witness.is_empty() => {
                    write!(f, " ({}; potential witness {})", first_line(detail), show_witness(witness))?
                }
                Verdict::NotProven { detail, .. } | Verdict::Error(detail) => write!(f, " ({})", first_line(detail))?,
                Verdict::Proved => {}
            }
            writeln!(f)?;
        }
        write!(f, "{}", if self.admitted { "admitted: every pair of rules is disjoint and the rules with the fallback cover the domain" } else { "NOT admitted: the translation isn't proven to partition the domain" })
    }
}

fn first_line(s: &str) -> &str {
    s.lines().find(|l| !l.trim().is_empty()).unwrap_or("no detail")
}

fn reading(v: &Verdict, proved: &str, refuted: &str) -> String {
    match v {
        Verdict::Proved => proved.into(),
        Verdict::Refuted { .. } => refuted.into(),
        Verdict::NotProven { .. } => "not proven".into(),
        Verdict::Error(_) => "error, nothing proven".into(),
    }
}

// Proves a translation with the CEL backend. The unit is admitted only if every source compiles
// (predicates and the assumption to bool), the domain is shown non-empty, every pair of rules is
// proven disjoint, and the rules with the fallback are proven exhaustive and disjoint from it.
// Inconclusive answers, timeouts and errors are never admitted.
pub fn prove(cel: &mut Backend, t: &Translation) -> Result<Report> {
    let (mut errors, warnings) = issues(t);
    let mut report = Report { backend: cel.version.clone(), domain: t.domain(), errors: vec![], warnings, checks: vec![], admitted: false };
    if !errors.is_empty() {
        report.errors = errors;
        return Ok(report);
    }

    let vars = t.vars();
    let domain = t.domain();
    let compile = |cel: &mut Backend, expr: &str| cel.request(json!({ "op": "compile", "expr": expr, "vars": vars }));
    let mut sources = vec![("the assumption".to_string(), domain.clone(), true)];
    for u in &t.rules {
        sources.push((format!("rule {}", u.name), u.when.clone(), true));
        if let Some(v) = &u.value {
            sources.push((format!("rule {}'s value", u.name), v.clone(), false));
        }
    }
    if let Some(v) = &t.fallback.value {
        sources.push(("the fallback's value".to_string(), v.clone(), false));
    }
    let emitted: BTreeSet<&str> = t.rules.iter().map(|r| r.emit.as_str()).chain([t.fallback.emit.as_str()]).collect();
    for action in t.results.keys() {
        if !emitted.contains(action.as_str()) {
            errors.push(format!("results.{action}: no rule of this unit emits {action}"));
        }
    }
    if t.result_default.is_none() {
        for action in &emitted {
            if !t.results.contains_key(*action) {
                errors.push(format!("{action} has no result expression and there's no `default`, so its calls' results couldn't be bound"));
            }
        }
    }
    let mut result_sources: Vec<(String, &String)> = t.results.iter().map(|(a, e)| (format!("results.{a}"), e)).collect();
    if let Some(d) = &t.result_default {
        result_sources.push(("results.default".to_string(), d));
    }
    for (what, src) in result_sources {
        let out = cel.request(json!({ "op": "compile", "expr": src, "vars": RESULT_VARS }))?;
        if out["ok"] != true {
            errors.push(format!("{what}: {}", failure(&out)));
        } else if !is_string_type(out["type"].as_str().unwrap_or_default()) {
            errors.push(format!("{what} has type {}, not string (it's the value the policy binds)", out["type"].as_str().unwrap_or("?")));
        }
    }
    for (what, src, boolean) in &sources {
        let out = compile(cel, src)?;
        if out["ok"] != true {
            errors.push(format!("{what}: {}", failure(&out)));
        } else if *boolean && !is_bool_type(out["type"].as_str().unwrap_or_default()) {
            errors.push(format!("{what} has type {}, not bool", out["type"].as_str().unwrap_or("?")));
        }
    }
    if !errors.is_empty() {
        report.errors = errors;
        return Ok(report);
    }

    let add = |report: &mut Report, what: String, role: Role, verdict: Verdict, passed: bool, reading: String| {
        report.checks.push(Check { what, role, verdict, reading, passed });
    };

    let v = read_emptiness(&t.verify(cel, "sat", &domain)?);
    let nonempty = matches!(v, Verdict::Refuted { .. });
    let r = reading(&v, "empty: the assumption is unsatisfiable, so any proof would be vacuous", "non-empty");
    add(&mut report, "domain".into(), Role::Required, v, nonempty, r);
    if !nonempty {
        return Ok(report);
    }

    let preds = t.preds();
    for u in &t.rules {
        let v = read_emptiness(&t.verify(cel, "sat", &conjoin(&[&domain, &u.when]))?);
        let r = reading(&v, "never matches in the domain (vacuous)", "matches");
        if matches!(v, Verdict::Proved) {
            report.warnings.push(format!("rule {} never matches in the domain", u.name));
        }
        add(&mut report, format!("rule {} → {}", u.name, u.emit), Role::Info, v, true, r);
    }
    for i in 0..t.rules.len() {
        for j in i + 1..t.rules.len() {
            let (a, b) = (&t.rules[i], &t.rules[j]);
            let v = read_emptiness(&t.verify(cel, "sat", &conjoin(&[&domain, &a.when, &b.when]))?);
            let passed = matches!(v, Verdict::Proved);
            let r = reading(&v, "disjoint", "OVERLAP: both match the same call");
            add(&mut report, format!("{} ⊥ {}", a.name, b.name), Role::Required, v, passed, r);
        }
    }
    let fallback = &t.fallback.emit;
    let v = read_emptiness(&t.verify(cel, "sat", &conjoin(&[&domain, &fallback_pred(&preds)]))?);
    let r = reading(&v, "never fires: the rules cover the domain", "fires");
    add(&mut report, format!("fallback → {fallback}"), Role::Info, v, true, r);

    let v = read_validity(&t.verify(cel, "valid", &exhaustive_query(&domain, &preds))?);
    let passed = matches!(v, Verdict::Proved);
    let r = reading(&v, "every in-domain call is matched by a rule or the fallback", "NOT exhaustive: a call in the domain where a predicate errors");
    add(&mut report, "exhaustive".into(), Role::Required, v, passed, r);

    let v = read_emptiness(&t.verify(cel, "sat", &conjoin(&[&domain, &fallback_pred(&preds), &union(&preds)]))?);
    let passed = matches!(v, Verdict::Proved);
    let r = reading(&v, "disjoint from every rule", "OVERLAP with a rule");
    add(&mut report, format!("fallback {fallback} ⊥ rules"), Role::Required, v, passed, r);

    report.admitted = report.errors.is_empty() && report.checks.iter().all(|c| c.role == Role::Info || c.passed);
    Ok(report)
}

// cel-java's compile reports the AST's result type; for bool that's `SimpleType{kind=BOOL, name=bool}`.
fn is_bool_type(t: &str) -> bool {
    t == "bool" || t.contains("kind=BOOL,") || t.contains("kind=BOOL}")
}

fn is_string_type(t: &str) -> bool {
    t == "string" || t.contains("kind=STRING,") || t.contains("kind=STRING}")
}

// ---- classification ------------------------------------------------------------------------

#[derive(Debug, PartialEq)]
pub enum Classification {
    InputError(Vec<(String, String)>),
    AssumptionError(String),
    RuleError(Vec<(String, String)>),
    // The assumption is false: the translation, and every proof, is about the domain only.
    OutsideDomain,
    // The runtime's value of the generated fallback disagreed with the rules'; shouldn't happen.
    FallbackError(String),
    Fallback,
    Mapped(usize),
    Ambiguous(Vec<usize>),
}

// A translation ready to classify calls. Only `admit` makes one for the runtime.
pub struct Translator {
    pub translation: Translation,
    vars: String,
    exprs: Vec<String>,
    values: Vec<Option<String>>,
    types: Vec<Ty>,
}

impl Translator {
    fn new(t: Translation) -> Result<Self> {
        let types = t.schema.iter().map(|f| parse_type(&f.ty).map_err(anyhow::Error::msg)).collect::<Result<_>>()?;
        let preds = t.preds();
        let mut exprs = vec![t.domain()];
        exprs.extend(preds.iter().map(|p| p.to_string()));
        exprs.push(fallback_pred(&preds));
        let mut values: Vec<Option<String>> = t.rules.iter().map(|u| u.value.clone()).collect();
        values.push(t.fallback.value.clone());
        Ok(Self { vars: t.vars(), exprs, values, types, translation: t })
    }

    // Proves the translation and returns it ready to use, or the report of why it isn't admitted.
    pub fn admit(cel: &mut Backend, t: Translation) -> Result<(Self, Report)> {
        let report = prove(cel, &t)?;
        if !report.admitted {
            bail!("{report}");
        }
        Ok((Self::new(t)?, report))
    }

    // The concrete event a call is: `tool` and each schema field, as CEL literals.
    fn bind(&self, tool: &str, args: &Value) -> std::result::Result<Vec<(String, String)>, Vec<(String, String)>> {
        let empty = serde_json::Map::new();
        let args = match args {
            Value::Null => &empty,
            Value::Object(args) => args,
            other => return Err(vec![("arguments".into(), format!("expected an object, got {}", kind(other)))]),
        };
        let mut bindings = vec![("tool".to_string(), quote(tool))];
        let mut errors = vec![];
        for (field, ty) in self.translation.schema.iter().zip(&self.types) {
            let bound = match (args.get(&field.name), ty) {
                (None, Ty::Optional(_)) => Ok("optional.none()".to_string()),
                (None, _) => Err("missing argument".to_string()),
                (Some(v), ty) => literal(ty, v),
            };
            match bound {
                Ok(literal) => bindings.push((field.name.clone(), literal)),
                Err(e) => errors.push((field.name.clone(), e)),
            }
        }
        if errors.is_empty() { Ok(bindings) } else { Err(errors) }
    }

    fn evaluate(&self, cel: &mut Backend, tool: &str, args: &Value) -> Result<(Classification, Value)> {
        let bindings = match self.bind(tool, args) {
            Ok(b) => b,
            Err(errors) => return Ok((Classification::InputError(errors), Value::Null)),
        };
        let bindings: Vec<[&str; 2]> = bindings.iter().map(|(k, v)| [k.as_str(), v.as_str()]).collect();
        let out = cel.request(json!({ "op": "evaluate", "vars": self.vars, "bindings": bindings, "exprs": self.exprs, "values": self.values }))?;
        if out["ok"] != true {
            bail!("the CEL backend couldn't evaluate the call: {}", failure(&out));
        }
        Ok((self.classify(&out), out["values"].clone()))
    }

    // Turns the runtime's results into a translation, as units.ts does. No first match wins: several
    // matches is ambiguous (never the fallback), a rule that didn't evaluate to a bool makes the call
    // an error, and a call outside the domain isn't translated at all. Only an in-domain call every
    // rule evaluates to false goes to the fallback, and the runtime's own value of the fallback
    // predicate must agree.
    fn classify(&self, out: &Value) -> Classification {
        let input: Vec<(String, String)> = out["inputErrors"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|e| (e["field"].as_str().unwrap_or("?").to_string(), e["error"].as_str().unwrap_or("?").to_string()))
            .collect();
        if !input.is_empty() {
            return Classification::InputError(input);
        }
        let results = out["results"].as_array().cloned().unwrap_or_default();
        let result = |i: usize| -> std::result::Result<bool, String> {
            let r = results.get(i).ok_or("no result")?;
            match (r["ok"].as_bool(), r["value"].as_bool()) {
                (Some(true), Some(v)) => Ok(v),
                _ => Err(format!("{}: {}", r["kind"].as_str().unwrap_or("error"), r["error"].as_str().unwrap_or("?"))),
            }
        };
        let in_domain = match result(0) {
            Ok(v) => v,
            Err(e) => return Classification::AssumptionError(e),
        };
        let rules = &self.translation.rules;
        let mut errors = vec![];
        let mut matches = vec![];
        for (i, u) in rules.iter().enumerate() {
            match result(i + 1) {
                Ok(true) => matches.push(i),
                Ok(false) => {}
                Err(e) => errors.push((u.name.clone(), e)),
            }
        }
        if !errors.is_empty() {
            return Classification::RuleError(errors);
        }
        if !in_domain {
            return Classification::OutsideDomain;
        }
        match result(rules.len() + 1) {
            Ok(fb) if fb == matches.is_empty() => {}
            Ok(fb) => return Classification::FallbackError(format!("fallback evaluated to {fb}")),
            Err(e) => return Classification::FallbackError(e),
        }
        match matches.as_slice() {
            [] => Classification::Fallback,
            [one] => Classification::Mapped(*one),
            _ => Classification::Ambiguous(matches),
        }
    }

    // The value a call of `action` returned, as the policy binds it, from the call's result. Err from
    // the outer Result means the backend failed; the inner Err, that the expression did.
    pub fn result(&self, cel: &mut Backend, action: &str, ok: bool, output: &str, error: &str) -> Result<std::result::Result<String, String>> {
        let Some(expr) = self.translation.results.get(action).or(self.translation.result_default.as_ref()) else {
            return Ok(Err(format!("no result expression for {action}")));
        };
        let bindings = json!([["ok", ok.to_string()], ["output", quote(output)], ["error", quote(error)]]);
        let out = cel.request(json!({ "op": "evaluate", "vars": RESULT_VARS, "bindings": bindings, "exprs": [], "values": [expr] }))?;
        if out["ok"] != true {
            bail!("the CEL backend couldn't evaluate the result: {}", failure(&out));
        }
        let v = &out["values"][0];
        Ok(match (v["ok"].as_bool(), v["value"].as_str()) {
            (Some(true), Some(s)) => Ok(s.to_string()),
            (Some(true), _) => Err(format!("the result expression gave {}, not a string", v["value"])),
            _ => Err(format!("{}: {}", v["kind"].as_str().unwrap_or("error"), v["error"].as_str().unwrap_or("?"))),
        })
    }

    // Translates an agent's call of `tool` into its event, or the reason it can't be. Err from the
    // outer Result means the backend failed, so nothing can be translated.
    pub fn translate(&self, cel: &mut Backend, tool: &str, args: &Value) -> Result<std::result::Result<Event, String>> {
        if !self.translation.tools.iter().any(|t| t == tool) {
            return Ok(Err(format!("{tool} isn't translated by this unit")));
        }
        let (class, values) = self.evaluate(cel, tool, args)?;
        let rules = &self.translation.rules;
        let list = |errors: &[(String, String)]| errors.iter().map(|(k, e)| format!("{k}: {e}")).collect::<Vec<_>>().join("; ");
        let (emit, i) = match class {
            Classification::Mapped(i) => (&rules[i].emit, i),
            Classification::Fallback => (&self.translation.fallback.emit, rules.len()),
            Classification::InputError(e) => return Ok(Err(format!("bad arguments ({})", list(&e)))),
            Classification::AssumptionError(e) => return Ok(Err(format!("the domain assumption failed: {e}"))),
            Classification::RuleError(e) => return Ok(Err(format!("a rule failed ({})", list(&e)))),
            Classification::OutsideDomain => return Ok(Err("the call is outside the unit's domain (its assumption is false)".into())),
            Classification::FallbackError(e) => return Ok(Err(format!("the fallback disagreed with the rules: {e}"))),
            Classification::Ambiguous(m) => {
                let names = m.iter().map(|&i| rules[i].name.as_str()).collect::<Vec<_>>().join(", ");
                return Ok(Err(format!("ambiguous: rules {names} all match, and complier won't pick one")));
            }
        };
        let value = match &values[i] {
            Value::Null => Value::Null, // no value expression
            v if v["ok"] == true => v["value"].clone(),
            v => {
                let what = rules.get(i).map_or("the fallback's value".to_string(), |u| format!("rule {}'s value", u.name));
                return Ok(Err(format!("{what} failed: {}: {}", v["kind"].as_str().unwrap_or("error"), v["error"].as_str().unwrap_or("?"))));
            }
        };
        Ok(Ok(Event { channel: emit.clone(), value }))
    }
}

// Proves a unit's translation before any of it runs, if it has one (unit.rs has already checked
// its tools against the service's metadata). Starts the CEL backend in `cel` the first time a
// translation needs it.
pub fn admit(unit: &Unit, cel: &mut Option<Backend>) -> Result<Option<(Translator, Report)>> {
    let Some(t) = &unit.translation else { return Ok(None) };
    if cel.is_none() {
        *cel = Some(Backend::spawn()?);
    }
    Translator::admit(cel.as_mut().unwrap(), t.clone()).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn backend() -> Backend {
        Backend::spawn().expect("these tests run the real CEL backend: build it with cel/build.sh")
    }

    fn translation(schema: &[(&str, &str)], assumption: &str, rules: &[(&str, &str, &str)], fallback: &str) -> Translation {
        Translation {
            tools: vec!["agent".into()],
            schema: schema.iter().map(|(n, t)| Field { name: n.to_string(), ty: t.to_string() }).collect(),
            assumption: assumption.into(),
            rules: rules.iter().map(|(n, w, e)| Rule { name: n.to_string(), when: w.to_string(), emit: e.to_string(), value: None }).collect(),
            fallback: Fallback { emit: fallback.into(), value: None },
            timeout_ms: 10_000,
            unroll: 5,
            results: BTreeMap::new(),
            result_default: Some("ok ? 'done' : 'failed'".into()),
        }
    }

    // The website's "agent tool calls" example, with the tool name as an argument (`op`).
    const AGENT: &[(&str, &str)] = &[("op", "string"), ("resource", "string"), ("amount", "int")];
    const AGENT_ASSUMPTION: &str = "op in ['read_file', 'write_file', 'http_get', 'transfer'] && amount >= 0";

    fn check<'a>(r: &'a Report, what: &str) -> &'a Check {
        r.checks.iter().find(|c| c.what == what).unwrap_or_else(|| panic!("no check {what} in\n{r}"))
    }

    fn call(t: &Translator, cel: &mut Backend, args: Value) -> std::result::Result<Event, String> {
        t.translate(cel, "agent", &args).unwrap()
    }

    #[test]
    fn disjoint_rules_are_admitted_and_classify_at_their_boundaries() {
        let mut cel = backend();
        let t = translation(AGENT, AGENT_ASSUMPTION, &[
            ("read_local", "op == 'read_file' && !resource.startsWith('/etc/')", "fs.read"),
            ("read_system", "op == 'read_file' && resource.startsWith('/etc/')", "fs.read_system"),
            ("write", "op == 'write_file'", "fs.write"),
            ("fetch", "op == 'http_get' && resource.startsWith('https://')", "net.get"),
            ("pay_small", "op == 'transfer' && amount <= 100", "pay.small"),
            ("pay_large", "op == 'transfer' && amount > 100", "pay.large"),
        ], "other");
        let (t, report) = Translator::admit(&mut cel, t).unwrap_or_else(|e| panic!("{e:#}"));
        assert!(report.admitted, "{report}");
        assert!(report.backend.contains("verifier-0.14.0.jar") && report.backend.contains("Z3 4.14.1"), "{}", report.backend);
        assert_eq!(report.checks.iter().filter(|c| c.what.contains(" ⊥ ") && c.what != "fallback other ⊥ rules").count(), 15);
        assert!(matches!(check(&report, "exhaustive").verdict, Verdict::Proved));
        // http_get of a non-https URL is in the domain but no rule's: the solver finds such a call.
        assert!(matches!(check(&report, "fallback → other").verdict, Verdict::Refuted { .. }));

        let ev = |op: &str, resource: &str, amount: i64| json!({ "op": op, "resource": resource, "amount": amount });
        let channel = |r: std::result::Result<Event, String>| r.map(|e| e.channel);
        assert_eq!(channel(call(&t, &mut cel, ev("transfer", "acct:42", 100))), Ok("pay.small".into()));
        assert_eq!(channel(call(&t, &mut cel, ev("transfer", "acct:42", 101))), Ok("pay.large".into()));
        assert_eq!(channel(call(&t, &mut cel, ev("read_file", "/etc/passwd", 0))), Ok("fs.read_system".into()));
        assert_eq!(channel(call(&t, &mut cel, ev("http_get", "http://example.com", 0))), Ok("other".into()));
        // Outside the domain, and badly typed input, are refused, not sent to the fallback.
        let refused = call(&t, &mut cel, ev("transfer", "acct:42", -5)).unwrap_err();
        assert!(refused.contains("outside"), "{refused}");
        let refused = call(&t, &mut cel, ev("delete", "acct:42", 0)).unwrap_err();
        assert!(refused.contains("outside"), "{refused}");
        let refused = call(&t, &mut cel, json!({ "op": "read_file", "resource": "/tmp", "amount": "many" })).unwrap_err();
        assert!(refused.contains("amount: expected an int, got a string"), "{refused}");
        let refused = call(&t, &mut cel, json!({ "op": "read_file", "amount": 0 })).unwrap_err();
        assert!(refused.contains("resource: missing argument"), "{refused}");
        let refused = t.translate(&mut cel, "unlisted", &ev("read_file", "/tmp", 0)).unwrap().unwrap_err();
        assert!(refused.contains("isn't translated"), "{refused}");
    }

    #[test]
    fn overlapping_rules_are_rejected_with_a_witness_and_ambiguous_calls_refused() {
        let mut cel = backend();
        let t = translation(AGENT, AGENT_ASSUMPTION, &[
            ("read_any", "op == 'read_file'", "fs.read"),
            ("read_secret", "op == 'read_file' && resource.contains('secret')", "fs.read_secret"),
            ("pay_small", "op == 'transfer' && amount <= 100", "pay.small"),
            ("pay_large", "op == 'transfer' && amount >= 100", "pay.large"),
        ], "other");
        let report = prove(&mut cel, &t).unwrap();
        assert!(!report.admitted, "{report}");
        let pay = check(&report, "pay_small ⊥ pay_large");
        assert!(!pay.passed);
        let Verdict::Refuted { witness, .. } = &pay.verdict else { panic!("{report}") };
        assert!(witness.contains(&("amount".into(), "100".into())), "{witness:?}");
        assert!(!check(&report, "read_any ⊥ read_secret").passed);
        assert!(check(&report, "read_any ⊥ pay_small").passed);
        assert!(report.to_string().contains("OVERLAP"), "{report}");
        // Admission refuses it, with the witness in the reason.
        let refused = Translator::admit(&mut cel, t.clone()).err().unwrap().to_string();
        assert!(refused.contains("amount = 100"), "{refused}");

        // Even an unadmitted translation never resolves an overlap by order.
        let unchecked = Translator::new(t).unwrap();
        let refused = call(&unchecked, &mut cel, json!({ "op": "transfer", "resource": "acct:42", "amount": 100 })).unwrap_err();
        assert!(refused.contains("ambiguous: rules pay_small, pay_large"), "{refused}");
    }

    #[test]
    fn a_predicate_that_can_error_isnt_exhaustive_and_its_error_isnt_the_fallback() {
        let mut cel = backend();
        let t = translation(AGENT, AGENT_ASSUMPTION, &[
            ("read", "op == 'read_file'", "fs.read"),
            ("pay_small", "op == 'transfer' && amount >= 1 && amount <= 100", "pay.small"),
            ("pay_large", "op == 'transfer' && 1000 / amount < 10", "pay.large"),
        ], "unclassified");
        let report = prove(&mut cel, &t).unwrap();
        assert!(!report.admitted, "{report}");
        let exhaustive = check(&report, "exhaustive");
        let Verdict::Refuted { witness, .. } = &exhaustive.verdict else { panic!("{report}") };
        assert!(witness.contains(&("amount".into(), "0".into())), "{witness:?}");
        let unchecked = Translator::new(t).unwrap();
        let refused = call(&unchecked, &mut cel, json!({ "op": "transfer", "resource": "a", "amount": 0 })).unwrap_err();
        assert!(refused.contains("pay_large") && refused.contains("by zero"), "{refused}");
        let fallback = call(&unchecked, &mut cel, json!({ "op": "http_get", "resource": "a", "amount": 0 })).unwrap();
        assert_eq!(fallback.channel, "unclassified");
    }

    #[test]
    fn an_empty_domain_is_vacuous_not_a_pass() {
        let mut cel = backend();
        let t = translation(AGENT, "amount < 0 && amount > 0", &[("pay", "op == 'transfer'", "pay")], "other");
        let report = prove(&mut cel, &t).unwrap();
        assert!(!report.admitted, "{report}");
        assert!(matches!(check(&report, "domain").verdict, Verdict::Proved));
        assert!(report.to_string().contains("vacuous"), "{report}");
        assert_eq!(report.checks.len(), 1); // nothing else is asked
    }

    #[test]
    fn inconclusive_and_timed_out_proofs_are_not_admitted() {
        let mut cel = backend();
        // List quantifiers beyond the unroll bound come back INCONCLUSIVE.
        let t = translation(&[("op", "string"), ("tags", "list<string>")], "", &[
            ("pii", "op == 'export' && tags.exists(t, t == 'pii')", "export.pii"),
            ("plain", "op == 'export' && tags.all(t, t != 'pii')", "export.plain"),
        ], "other");
        let report = prove(&mut cel, &t).unwrap();
        assert!(!report.admitted, "{report}");
        assert!(report.checks.iter().any(|c| c.role == Role::Required && matches!(c.verdict, Verdict::NotProven { .. })), "{report}");

        let mut t = translation(AGENT, AGENT_ASSUMPTION, &[("a", "op == 'transfer' && amount * amount * amount == 1000 * resource.size()", "a"), ("b", "op == 'read_file'", "b")], "other");
        t.timeout_ms = 1;
        let report = prove(&mut cel, &t).unwrap();
        assert!(!report.admitted, "{report}");
        assert!(report.checks.iter().any(|c| matches!(c.verdict, Verdict::Error(_) | Verdict::NotProven { .. })), "{report}");
    }

    #[test]
    fn ill_typed_and_badly_configured_translations_are_rejected_before_any_proof() {
        let mut cel = backend();
        let t = translation(AGENT, "", &[("a", "amount + 1", "a"), ("b", "missing == 1", "b")], "other");
        let report = prove(&mut cel, &t).unwrap();
        assert!(!report.admitted && report.checks.is_empty(), "{report}");
        assert!(report.errors.iter().any(|e| e.contains("rule a has type") && e.contains("not bool")), "{report}");
        assert!(report.errors.iter().any(|e| e.contains("rule b") && e.contains("undeclared reference to 'missing'")), "{report}");

        let t = translation(&[("tool", "string"), ("x", "bytes"), ("y", "list<optional<int>>")], "", &[("a", "x == 1", "a"), ("a", "", "b.")], "a");
        let (errors, _) = issues(&t);
        for needle in ["`tool` is the called tool", "x: bytes", "optional<T> only", "names must be unique", "empty predicate", "\"b.\" must be a fixed name", "fallback event a is also emitted by a"] {
            assert!(errors.iter().any(|e| e.contains(needle)), "{needle} not in {errors:#?}");
        }
    }

    #[test]
    fn a_missing_backend_is_an_error() {
        assert!(Backend::start("/nonexistent/java", "").is_err());
        let java = serde_json::from_str::<Value>(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../cel/build/backend.json")).unwrap()).unwrap();
        let err = Backend::start(java["java"].as_str().unwrap(), "/nonexistent").err().unwrap();
        assert!(format!("{err:#}").contains("didn't start"), "{err:#}");
    }

    #[test]
    fn values_and_literals() {
        let s = |ty: &str, v: Value| literal(&parse_type(ty).unwrap(), &v);
        assert_eq!(s("string", json!("a\"b\\c\nd\u{1}é")), Ok("\"a\\\"b\\\\c\\nd\\u0001é\"".into()));
        assert_eq!(s("int", json!(-5)), Ok("-5".into()));
        assert!(s("int", json!(5.5)).is_err());
        assert_eq!(s("uint", json!(5)), Ok("5u".into()));
        assert!(s("uint", json!(-5)).is_err());
        assert_eq!(s("double", json!(5)), Ok("5.0".into()));
        assert_eq!(s("list<string>", json!(["a", "b"])), Ok("[\"a\", \"b\"]".into()));
        assert_eq!(s("map<string, int>", json!({ "k": 1 })), Ok("{\"k\": 1}".into()));
        assert_eq!(s("dyn", json!({ "k": [1, "x", null, 1.5] })), Ok("{\"k\": [1, \"x\", null, 1.5]}".into()));
        assert!(s("string", Value::Null).is_err());
        assert!(parse_type("map<int, string>").is_err());
        assert_eq!(parse_witness("Condition is satisfiable. Satisfying input:\n  amount = (- 5)\n  op = \"a\"\"b\\u{e9}\""), vec![
            ("amount".to_string(), "-5".to_string()),
            ("op".to_string(), "\"a\\\"bé\"".to_string()),
        ]);
    }
}
