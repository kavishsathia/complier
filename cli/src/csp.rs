//! A small CSP fragment: prefix, external choice, internal choice, named
//! processes, STOP and SKIP, and alphabetized parallel composition of named
//! processes at the top (`MAIN = NOTION || WRITER`). Contracts are monitored
//! against the traces model, where P ⊓ Q and P □ Q have the same traces, so
//! both choices are stepped the same way: the next event reveals which branch
//! was taken. Each component's alphabet is the events it can reach, and an
//! event shared by several components needs all of them to take part.
//! `~e` marks an event as external: something outside the spec submits it, the
//! world or an agent. Every other event is internal and happens on its own once
//! every component sharing it is ready. Marking one occurrence marks the event.

use std::collections::{BTreeSet, HashMap};
use std::fmt;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Term {
    Stop,
    Skip,
    Prefix(String, Box<Term>),
    Choice(Vec<Term>),
    Ref(String),
}

pub struct Contract {
    defs: HashMap<String, Term>,
    pub alphabet: BTreeSet<String>,
    // Events written `~e` somewhere: submitted from outside the spec.
    pub external: BTreeSet<String>,
    pub components: Vec<Component>,
}

pub struct Component {
    pub name: String,
    pub alphabet: BTreeSet<String>,
}

/// Unguarded recursion such as `P = P` would otherwise loop forever.
const MAX_DEPTH: usize = 64;

impl Contract {
    /// Each component's initial state, in the order of `components`.
    pub fn initial_states(&self) -> Vec<Vec<Term>> {
        self.components.iter().map(|c| vec![Term::Ref(c.name.clone())]).collect()
    }

    /// The events some state in `state` can perform next.
    pub fn initials(&self, state: &[Term]) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        for t in state {
            self.initials_of(t, 0, &mut out);
        }
        out
    }

    fn initials_of(&self, t: &Term, depth: usize, out: &mut BTreeSet<String>) {
        if depth > MAX_DEPTH {
            return;
        }
        match t {
            Term::Stop | Term::Skip => {}
            Term::Prefix(e, _) => {
                out.insert(e.clone());
            }
            Term::Choice(ts) => ts.iter().for_each(|t| self.initials_of(t, depth + 1, out)),
            Term::Ref(n) => self.initials_of(&self.defs[n], depth + 1, out),
        }
    }

    /// Whether some state in `state` can terminate successfully (reach SKIP).
    pub fn can_finish(&self, state: &[Term]) -> bool {
        state.iter().any(|t| self.finishes(t, 0))
    }

    fn finishes(&self, t: &Term, depth: usize) -> bool {
        depth <= MAX_DEPTH
            && match t {
                Term::Skip => true,
                Term::Stop | Term::Prefix(..) => false,
                Term::Choice(ts) => ts.iter().any(|t| self.finishes(t, depth + 1)),
                Term::Ref(n) => self.finishes(&self.defs[n], depth + 1),
            }
    }

    /// The states reachable by performing `event`; empty if it is refused.
    pub fn after(&self, state: &[Term], event: &str) -> Vec<Term> {
        let mut out = Vec::new();
        for t in state {
            self.after_of(t, event, 0, &mut out);
        }
        out
    }

    fn after_of(&self, t: &Term, event: &str, depth: usize, out: &mut Vec<Term>) {
        if depth > MAX_DEPTH {
            return;
        }
        match t {
            Term::Stop | Term::Skip => {}
            Term::Prefix(e, next) => {
                if e == event && !out.contains(next) {
                    out.push((**next).clone());
                }
            }
            Term::Choice(ts) => ts.iter().for_each(|t| self.after_of(t, event, depth + 1, out)),
            Term::Ref(n) => self.after_of(&self.defs[n], event, depth + 1, out),
        }
    }
}

pub fn show_state(state: &[Term]) -> String {
    state.iter().map(|t| t.to_string()).collect::<Vec<_>>().join("  |  ")
}

impl fmt::Display for Term {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Term::Stop => write!(f, "STOP"),
            Term::Skip => write!(f, "SKIP"),
            Term::Ref(n) => write!(f, "{n}"),
            Term::Prefix(e, next) => match **next {
                Term::Choice(_) => write!(f, "{e} -> ({next})"),
                _ => write!(f, "{e} -> {next}"),
            },
            Term::Choice(ts) => {
                let parts: Vec<String> = ts.iter().map(|t| t.to_string()).collect();
                write!(f, "{}", parts.join(" [] "))
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Ident(String),
    Eq,
    Arrow,
    Ext,
    Int,
    Par,
    LParen,
    RParen,
}

fn lex(src: &str) -> Result<Vec<(Tok, usize)>, String> {
    let mut toks = Vec::new();
    for (n, raw) in src.lines().enumerate() {
        let line = n + 1;
        let code = raw.split("--").next().unwrap_or("");
        let chars: Vec<char> = code.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            let rest: String = chars[i..].iter().take(3).collect();
            if c.is_whitespace() {
                i += 1;
            } else if c.is_ascii_alphabetic() || c == '_' || (c == '~' && chars.get(i + 1).is_some_and(|n| n.is_ascii_alphabetic() || *n == '_')) {
                let start = i;
                i += 1;
                while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_' || chars[i] == '.') {
                    i += 1;
                }
                toks.push((Tok::Ident(chars[start..i].iter().collect()), line));
            } else if rest.starts_with("->") {
                toks.push((Tok::Arrow, line));
                i += 2;
            } else if rest.starts_with("[]") {
                toks.push((Tok::Ext, line));
                i += 2;
            } else if rest == "|~|" {
                toks.push((Tok::Int, line));
                i += 3;
            } else if rest.starts_with("||") {
                toks.push((Tok::Par, line));
                i += 2;
            } else {
                let tok = match c {
                    '=' => Tok::Eq,
                    '→' => Tok::Arrow,
                    '□' => Tok::Ext,
                    '⊓' => Tok::Int,
                    '(' => Tok::LParen,
                    ')' => Tok::RParen,
                    _ => return Err(format!("line {line}: unexpected '{c}'")),
                };
                toks.push((tok, line));
                i += 1;
            }
        }
    }
    Ok(toks)
}

struct Parser {
    toks: Vec<(Tok, usize)>,
    i: usize,
    // Events marked `~e` anywhere.
    external: BTreeSet<String>,
}

impl Parser {
    fn peek(&self, k: usize) -> Option<&Tok> {
        self.toks.get(self.i + k).map(|(t, _)| t)
    }

    fn line(&self) -> usize {
        self.toks.get(self.i).or(self.toks.last()).map(|(_, l)| *l).unwrap_or(1)
    }

    fn expect(&mut self, want: Tok, what: &str) -> Result<(), String> {
        if self.peek(0) == Some(&want) {
            self.i += 1;
            Ok(())
        } else {
            Err(format!("line {}: expected {what}", self.line()))
        }
    }

    fn expr(&mut self) -> Result<Term, String> {
        let mut alts = vec![self.term()?];
        while matches!(self.peek(0), Some(Tok::Ext) | Some(Tok::Int)) {
            self.i += 1;
            alts.push(self.term()?);
        }
        Ok(if alts.len() == 1 { alts.pop().unwrap() } else { Term::Choice(alts) })
    }

    fn term(&mut self) -> Result<Term, String> {
        match self.peek(0).cloned() {
            Some(Tok::LParen) => {
                self.i += 1;
                let e = self.expr()?;
                self.expect(Tok::RParen, "')'")?;
                Ok(e)
            }
            Some(Tok::Ident(s)) => {
                self.i += 1;
                if s == "STOP" {
                    return Ok(Term::Stop);
                }
                if s == "SKIP" {
                    return Ok(Term::Skip);
                }
                let external = s.strip_prefix('~').map(String::from);
                if self.peek(0) != Some(&Tok::Arrow) {
                    if external.is_some() {
                        return Err(format!("line {}: {s} must be followed by ->", self.line()));
                    }
                    return Ok(Term::Ref(s));
                }
                self.i += 1;
                let event = match external {
                    Some(event) => {
                        self.external.insert(event.clone());
                        event
                    }
                    None => s,
                };
                Ok(Term::Prefix(event, Box::new(self.term()?)))
            }
            _ => Err(format!("line {}: expected an event, a process name or '('", self.line())),
        }
    }
}

pub fn parse(src: &str) -> Result<Contract, String> {
    let mut p = Parser { toks: lex(src)?, i: 0, external: BTreeSet::new() };
    let mut defs = HashMap::new();
    let mut order = Vec::new();
    let mut parallel: Option<(String, Vec<String>)> = None;
    while p.peek(0).is_some() {
        let name = match p.peek(0).cloned() {
            Some(Tok::Ident(n)) => n,
            _ => return Err(format!("line {}: expected a process definition", p.line())),
        };
        p.i += 1;
        p.expect(Tok::Eq, "'=' after the process name")?;
        let body = p.expr()?;
        if p.peek(0) == Some(&Tok::Par) {
            let mut names = vec![body];
            while p.peek(0) == Some(&Tok::Par) {
                p.i += 1;
                names.push(p.term()?);
            }
            let names = names
                .into_iter()
                .map(|t| match t {
                    Term::Ref(n) => Ok(n),
                    _ => Err(format!("{name}: || composes process names only")),
                })
                .collect::<Result<Vec<_>, _>>()?;
            if parallel.replace((name.clone(), names)).is_some() {
                return Err("only one process can be a || composition".into());
            }
            order.push(name);
            continue;
        }
        if defs.insert(name.clone(), body).is_some() {
            return Err(format!("process {name} is defined twice"));
        }
        order.push(name);
    }
    if order.is_empty() {
        return Err("the contract defines no processes".into());
    }

    let mut alphabet = BTreeSet::new();
    for body in defs.values() {
        collect(body, &defs, &mut alphabet)?;
    }
    let main = if order.contains(&"MAIN".to_string()) { "MAIN".to_string() } else { order[0].clone() };
    let names = match parallel {
        Some((composite, names)) if composite == main => names,
        Some((composite, _)) => return Err(format!("{composite} is a || composition but not the main process")),
        None => vec![main.clone()],
    };
    let components = names
        .into_iter()
        .map(|name| {
            if !defs.contains_key(&name) {
                return Err(format!("process {name} is used but never defined"));
            }
            let (mut alphabet, mut seen) = (BTreeSet::new(), BTreeSet::new());
            reachable(&Term::Ref(name.clone()), &defs, &mut seen, &mut alphabet);
            Ok(Component { name, alphabet })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Contract { defs, alphabet, external: p.external, components })
}

// The events reachable from `t`, following process references.
fn reachable(t: &Term, defs: &HashMap<String, Term>, seen: &mut BTreeSet<String>, out: &mut BTreeSet<String>) {
    match t {
        Term::Stop | Term::Skip => {}
        Term::Prefix(e, next) => {
            out.insert(e.clone());
            reachable(next, defs, seen, out);
        }
        Term::Choice(ts) => ts.iter().for_each(|t| reachable(t, defs, seen, out)),
        Term::Ref(n) => {
            if seen.insert(n.clone()) {
                reachable(&defs[n], defs, seen, out);
            }
        }
    }
}

fn collect(t: &Term, defs: &HashMap<String, Term>, out: &mut BTreeSet<String>) -> Result<(), String> {
    match t {
        Term::Stop | Term::Skip => Ok(()),
        Term::Prefix(e, next) => {
            out.insert(e.clone());
            collect(next, defs, out)
        }
        Term::Choice(ts) => ts.iter().try_for_each(|t| collect(t, defs, out)),
        Term::Ref(n) if defs.contains_key(n) => Ok(()),
        Term::Ref(n) => Err(format!("process {n} is used but never defined")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const REVIEW: &str = "MAIN = Draft\nDraft = writer.submit -> Review\nReview = reviewer.approve -> SKIP [] reviewer.reject -> Draft";

    #[test]
    fn roles_take_turns() {
        let c = parse(REVIEW).unwrap();
        let s = c.initial_states()[0].clone();
        assert!(!c.initials(&s).contains("reviewer.approve"));
        let s = c.after(&s, "writer.submit");
        assert!(c.initials(&s).contains("reviewer.approve"));
        assert!(!c.initials(&s).contains("writer.submit"));
    }

    #[test]
    fn alphabet_is_the_events_mentioned() {
        let c = parse(REVIEW).unwrap();
        assert!(c.alphabet.contains("reviewer.reject"));
        assert!(!c.alphabet.contains("writer.publish"));
    }

    #[test]
    fn skip_finishes_and_stop_does_not() {
        let c = parse(REVIEW).unwrap();
        let s = c.after(&c.after(&c.initial_states()[0].clone(), "writer.submit"), "reviewer.approve");
        assert!(c.initials(&s).is_empty() && c.can_finish(&s));
        let c = parse("P = a -> STOP").unwrap();
        let s = c.after(&c.initial_states()[0].clone(), "a");
        assert!(c.initials(&s).is_empty() && !c.can_finish(&s));
    }

    const GEARS: &str = "NOTION = ~a -> NOTION\nINBOX = a -> got_a -> INBOX\nWRITER = ~c -> got_a -> WRITER\nMAIN = NOTION || INBOX || WRITER";

    #[test]
    fn components_have_their_own_alphabets() {
        let c = parse(GEARS).unwrap();
        let names: Vec<_> = c.components.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["NOTION", "INBOX", "WRITER"]);
        assert!(!c.components[0].alphabet.contains("c"));
        assert!(c.components[2].alphabet.contains("c"));
    }

    #[test]
    fn one_tilde_marks_an_event_external_everywhere() {
        let c = parse(GEARS).unwrap();
        assert_eq!(c.external, BTreeSet::from(["a".to_string(), "c".to_string()]));
        assert!(c.components[1].alphabet.contains("a")); // unmarked there, still the same event
        assert!(parse("P = ~Q\nQ = a -> Q").is_err());
        assert!(parse("P = a -> P |~| b -> P").unwrap().external.is_empty());
    }

    #[test]
    fn nondeterministic_branches_are_tracked() {
        let c = parse("P = a -> b -> STOP |~| a -> c -> STOP").unwrap();
        let s = c.after(&c.initial_states()[0].clone(), "a");
        assert_eq!(s.len(), 2);
        assert!(c.initials(&s).contains("b") && c.initials(&s).contains("c"));
    }

    #[test]
    fn errors_name_the_problem() {
        assert!(parse("P = a -> Q").err().unwrap().contains("Q"));
        assert!(parse("P = a ->").is_err());
        assert!(parse("P = a -> P\nP = b -> P").err().unwrap().contains("twice"));
    }

    #[test]
    fn unguarded_recursion_terminates() {
        let c = parse("P = P").unwrap();
        assert!(c.initials(&c.initial_states()[0].clone()).is_empty());
    }
}
