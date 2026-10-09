//! A small CSP fragment: prefix, external choice, internal choice, named
//! processes, STOP and SKIP. Contracts are monitored against the traces
//! model, where P ⊓ Q and P □ Q have the same traces, so both choices are
//! stepped the same way: the agent's next event reveals which branch it took.

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
    pub main: String,
    pub alphabet: BTreeSet<String>,
}

/// Unguarded recursion such as `P = P` would otherwise loop forever.
const MAX_DEPTH: usize = 64;

impl Contract {
    pub fn initial(&self) -> Vec<Term> {
        vec![Term::Ref(self.main.clone())]
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
            } else if c.is_ascii_alphabetic() || c == '_' {
                let start = i;
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
                if self.peek(0) == Some(&Tok::Arrow) {
                    self.i += 1;
                    return Ok(Term::Prefix(s, Box::new(self.term()?)));
                }
                Ok(Term::Ref(s))
            }
            _ => Err(format!("line {}: expected an event, a process name or '('", self.line())),
        }
    }
}

pub fn parse(src: &str) -> Result<Contract, String> {
    let mut p = Parser { toks: lex(src)?, i: 0 };
    let mut defs = HashMap::new();
    let mut order = Vec::new();
    while p.peek(0).is_some() {
        let name = match p.peek(0).cloned() {
            Some(Tok::Ident(n)) => n,
            _ => return Err(format!("line {}: expected a process definition", p.line())),
        };
        p.i += 1;
        p.expect(Tok::Eq, "'=' after the process name")?;
        let body = p.expr()?;
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
    let main = if defs.contains_key("MAIN") { "MAIN".to_string() } else { order[0].clone() };
    Ok(Contract { defs, main, alphabet })
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

    const DEMO: &str = include_str!("demo.csp");

    #[test]
    fn demo_requires_read_before_edit() {
        let c = parse(DEMO).unwrap();
        let s = c.initial();
        assert!(!c.initials(&s).contains("Edit"));
        let s = c.after(&s, "Read");
        assert!(c.initials(&s).contains("Edit"));
        let s = c.after(&s, "Edit");
        assert!(c.initials(&s).contains("Write"));
    }

    #[test]
    fn alphabet_excludes_unmentioned_tools() {
        let c = parse(DEMO).unwrap();
        assert!(c.alphabet.contains("Edit"));
        assert!(!c.alphabet.contains("Bash"));
    }

    #[test]
    fn nondeterministic_branches_are_tracked() {
        let c = parse("P = a -> b -> STOP |~| a -> c -> STOP").unwrap();
        let s = c.after(&c.initial(), "a");
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
        assert!(c.initials(&c.initial()).is_empty());
    }
}
