// Strict YAML for unit and service files: yaml-rust2's event parser builds a plain tree of scalars,
// sequences and mappings, each node marked with its line and column, and refuses everything that
// isn't plain data: tags, anchors and aliases, duplicate keys, non-scalar keys and more than one
// document. Nothing is constructed from the document; callers read it field by field through the
// accessors below, which name the file, line and column of whatever is wrong.

use anyhow::{anyhow, bail, Result};
use std::collections::BTreeSet;
use std::path::Path;
use yaml_rust2::parser::{Event, MarkedEventReceiver, Parser};
use yaml_rust2::scanner::{Marker, TScalarStyle};

#[derive(Debug)]
pub enum Kind {
    // The scalar's text, and whether it was plain (unquoted, so `10` is a number and `true` a bool).
    Scalar(String, bool),
    Seq(Vec<Node>),
    Map(Vec<(String, Node)>),
}

#[derive(Debug)]
pub struct Node {
    pub kind: Kind,
    // Where the node starts: 1-based line and column.
    pub line: usize,
    pub col: usize,
}

// The file a node came from, for error messages.
#[derive(Clone, Copy)]
pub struct Doc<'a> {
    pub file: &'a str,
}

enum Open {
    Seq(Marker, Vec<Node>),
    // A mapping, its entries, and the key waiting for its value.
    Map(Marker, Vec<(String, Node)>, Option<(String, Marker)>),
}

#[derive(Default)]
struct Builder {
    stack: Vec<Open>,
    root: Option<Node>,
    documents: usize,
    error: Option<(Marker, String)>,
}

fn node(kind: Kind, at: Marker) -> Node {
    Node { kind, line: at.line(), col: at.col() + 1 }
}

impl Builder {
    fn fail(&mut self, at: Marker, message: String) {
        self.error.get_or_insert((at, message));
    }

    fn push(&mut self, value: Node, at: Marker) {
        match self.stack.last_mut() {
            None => self.root = Some(value),
            Some(Open::Seq(_, items)) => items.push(value),
            Some(Open::Map(_, entries, key @ None)) => match value.kind {
                Kind::Scalar(text, plain) if !(plain && is_null(&text)) => {
                    if entries.iter().any(|(k, _)| *k == text) {
                        return self.fail(at, format!("duplicate key {text:?}"));
                    }
                    *key = Some((text, at));
                }
                Kind::Scalar(..) => self.fail(at, "a key can't be empty or null".into()),
                _ => self.fail(at, "keys must be plain names, not sequences or mappings".into()),
            },
            Some(Open::Map(_, entries, key)) => {
                let (k, _) = key.take().unwrap();
                entries.push((k, value));
            }
        }
    }
}

impl MarkedEventReceiver for Builder {
    fn on_event(&mut self, event: Event, at: Marker) {
        if self.error.is_some() {
            return;
        }
        let refuse_extras = |anchor: usize, tag: &Option<yaml_rust2::parser::Tag>| match (anchor, tag) {
            (0, None) => None,
            (_, Some(tag)) => Some(format!("tags aren't allowed ({}{}): this file is plain data", tag.handle, tag.suffix)),
            _ => Some("anchors and aliases aren't allowed: write each value out".to_string()),
        };
        match event {
            Event::DocumentStart => {
                self.documents += 1;
                if self.documents > 1 {
                    self.fail(at, "only one YAML document is allowed per file".into());
                }
            }
            Event::Alias(_) => self.fail(at, "anchors and aliases aren't allowed: write each value out".into()),
            Event::Scalar(text, style, anchor, tag) => match refuse_extras(anchor, &tag) {
                Some(e) => self.fail(at, e),
                None => self.push(node(Kind::Scalar(text, style == TScalarStyle::Plain), at), at),
            },
            Event::SequenceStart(anchor, tag) => match refuse_extras(anchor, &tag) {
                Some(e) => self.fail(at, e),
                None => self.stack.push(Open::Seq(at, vec![])),
            },
            Event::MappingStart(anchor, tag) => match refuse_extras(anchor, &tag) {
                Some(e) => self.fail(at, e),
                None => self.stack.push(Open::Map(at, vec![], None)),
            },
            Event::SequenceEnd | Event::MappingEnd => {
                let value = match self.stack.pop() {
                    Some(Open::Seq(start, items)) => node(Kind::Seq(items), start),
                    Some(Open::Map(start, entries, _)) => node(Kind::Map(entries), start),
                    None => return,
                };
                self.push(value, at);
            }
            Event::StreamStart | Event::StreamEnd | Event::DocumentEnd | Event::Nothing => {}
        }
    }
}

// Parses `text`, the contents of `path`, into a tree.
pub fn parse(path: &Path, text: &str) -> Result<Node> {
    let file = path.display();
    let mut builder = Builder::default();
    if let Err(e) = Parser::new_from_str(text).load(&mut builder, true) {
        let at = e.marker();
        bail!("{file}:{}:{}: not valid YAML: {}", at.line(), at.col() + 1, e.info());
    }
    if let Some((at, message)) = builder.error {
        bail!("{file}:{}:{}: {message}", at.line(), at.col() + 1);
    }
    builder.root.ok_or_else(|| anyhow!("{file}: empty file"))
}

// YAML 1.2 core schema: the plain scalars that aren't strings.
fn is_null(s: &str) -> bool {
    matches!(s, "" | "~" | "null" | "Null" | "NULL")
}

fn is_int(s: &str) -> bool {
    let digits = |s: &str, radix: u32| !s.is_empty() && s.chars().all(|c| c.is_digit(radix));
    if let Some(hex) = s.strip_prefix("0x") {
        return digits(hex, 16);
    }
    if let Some(oct) = s.strip_prefix("0o") {
        return digits(oct, 8);
    }
    digits(s.strip_prefix(['-', '+']).unwrap_or(s), 10)
}

fn is_float(s: &str) -> bool {
    let s = s.strip_prefix(['-', '+']).unwrap_or(s);
    if matches!(s, ".inf" | ".Inf" | ".INF" | ".nan" | ".NaN" | ".NAN") {
        return true;
    }
    let (mantissa, exponent) = match s.find(['e', 'E']) {
        Some(i) => (&s[..i], Some(&s[i + 1..])),
        None => (s, None),
    };
    let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let digits = |s: &str| s.chars().all(|c| c.is_ascii_digit());
    let mantissa_ok = digits(whole) && digits(fraction) && !(whole.is_empty() && fraction.is_empty());
    let exponent_ok = exponent.is_none_or(|e| is_int(e) && !e.starts_with("0x") && !e.starts_with("0o"));
    mantissa_ok && exponent_ok
}

fn plain_kind(s: &str) -> Option<&'static str> {
    if is_null(s) {
        Some("null")
    } else if matches!(s, "true" | "True" | "TRUE" | "false" | "False" | "FALSE") {
        Some("a bool")
    } else if is_int(s) {
        Some("an integer")
    } else if is_float(s) {
        Some("a number")
    } else {
        None
    }
}

impl Node {
    fn describe(&self) -> &'static str {
        match &self.kind {
            Kind::Scalar(s, true) => plain_kind(s).unwrap_or("a string"),
            Kind::Scalar(..) => "a string",
            Kind::Seq(_) => "a list",
            Kind::Map(_) => "a mapping",
        }
    }
}

impl<'a> Doc<'a> {
    pub fn error(&self, at: &Node, what: &str, message: impl std::fmt::Display) -> anyhow::Error {
        anyhow!("{}:{}:{}: {what}: {message}", self.file, at.line, at.col)
    }

    pub fn str(&self, n: &'a Node, what: &str) -> Result<&'a str> {
        match &n.kind {
            Kind::Scalar(s, true) if plain_kind(s).is_some() => {
                Err(self.error(n, what, format!("expected a string, got {} (quote it if you meant the text {s:?})", n.describe())))
            }
            Kind::Scalar(s, _) => Ok(s),
            _ => Err(self.error(n, what, format!("expected a string, got {}", n.describe()))),
        }
    }

    pub fn uint(&self, n: &Node, what: &str) -> Result<u64> {
        match &n.kind {
            Kind::Scalar(s, true) if s.chars().all(|c| c.is_ascii_digit()) && !s.is_empty() => {
                s.parse().map_err(|_| self.error(n, what, format!("{s} is too large")))
            }
            _ => Err(self.error(n, what, format!("expected a non-negative integer, got {}", n.describe()))),
        }
    }

    pub fn seq(&self, n: &'a Node, what: &str) -> Result<&'a [Node]> {
        match &n.kind {
            Kind::Seq(items) => Ok(items),
            _ => Err(self.error(n, what, format!("expected a list, got {}", n.describe()))),
        }
    }

    pub fn strings(&self, n: &'a Node, what: &str) -> Result<Vec<(&'a str, &'a Node)>> {
        self.seq(n, what)?.iter().map(|item| Ok((self.str(item, what)?, item))).collect()
    }

    pub fn map(&self, n: &'a Node, what: &str) -> Result<&'a [(String, Node)]> {
        match &n.kind {
            Kind::Map(entries) => Ok(entries),
            _ => Err(self.error(n, what, format!("expected a mapping, got {}", n.describe()))),
        }
    }

    // A mapping with a fixed set of fields: unknown ones and missing required ones are errors.
    pub fn fields(&self, n: &'a Node, what: &str, required: &[&str], optional: &[&str]) -> Result<Fields<'a>> {
        let entries = self.map(n, what)?;
        for (key, value) in entries {
            if !required.contains(&key.as_str()) && !optional.contains(&key.as_str()) {
                let known: Vec<&str> = required.iter().chain(optional).copied().collect();
                return Err(self.error(value, what, format!("unknown field {key:?} (expected one of: {})", known.join(", "))));
            }
        }
        let present: BTreeSet<&str> = entries.iter().map(|(k, _)| k.as_str()).collect();
        if let Some(missing) = required.iter().find(|r| !present.contains(*r)) {
            return Err(self.error(n, what, format!("missing field {missing:?}")));
        }
        Ok(Fields { entries })
    }
}

pub struct Fields<'a> {
    entries: &'a [(String, Node)],
}

impl<'a> Fields<'a> {
    pub fn get(&self, key: &str) -> Option<&'a Node> {
        self.entries.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn req(&self, key: &str) -> &'a Node {
        self.get(key).expect("required fields are checked by Doc::fields")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_str(text: &str) -> Result<Node> {
        parse(Path::new("t.yaml"), text)
    }

    fn err(text: &str) -> String {
        format!("{:#}", parse_str(text).unwrap_err())
    }

    #[test]
    fn plain_data_parses_with_positions() {
        let root = parse_str("a: 1\nb:\n  - x\n  - 'y'\n").unwrap();
        let Kind::Map(entries) = &root.kind else { panic!() };
        assert_eq!(entries[0].0, "a");
        let Kind::Seq(items) = &entries[1].1.kind else { panic!() };
        assert_eq!((items[1].line, items[1].col), (4, 5));
        assert!(matches!(&items[1].kind, Kind::Scalar(s, false) if s == "y"));
    }

    #[test]
    fn anything_but_plain_data_is_refused() {
        assert!(err("a: 1\na: 2\n").contains("t.yaml:2:1: duplicate key \"a\""), "{}", err("a: 1\na: 2\n"));
        assert!(err("a: !!str 1\n").contains("tags aren't allowed (tag:yaml.org,2002:str)"));
        assert!(err("a: !Thing {x: 1}\n").contains("tags"));
        assert!(err("a: &x 1\nb: *x\n").contains("anchors and aliases"));
        assert!(err("? [a, b]\n: 1\n").contains("keys must be plain names"));
        assert!(err("a: 1\n---\nb: 2\n").contains("only one YAML document"));
        assert!(err("a: [1\n").contains("not valid YAML"));
        assert!(err("~: 1\n").contains("can't be empty or null"));
        assert!(err("").contains("empty file"));
    }

    #[test]
    fn plain_scalars_are_typed_by_the_core_schema() {
        let doc = Doc { file: "t.yaml" };
        let root = parse_str("s: hello\nq: '10'\nn: 10\nb: true\nf: 1.5e3\nz: ~\nh: 62f8054dc5fa42e2\ne: 1e5\n").unwrap();
        let f = doc.fields(&root, "root", &[], &["s", "q", "n", "b", "f", "z", "h", "e"]).unwrap();
        assert_eq!(doc.str(f.req("s"), "s").unwrap(), "hello");
        assert_eq!(doc.str(f.req("q"), "q").unwrap(), "10");
        assert_eq!(doc.str(f.req("h"), "h").unwrap(), "62f8054dc5fa42e2");
        for (k, kind) in [("n", "an integer"), ("b", "a bool"), ("f", "a number"), ("z", "null"), ("e", "a number")] {
            let e = doc.str(f.req(k), k).unwrap_err().to_string();
            assert!(e.contains(&format!("got {kind}")), "{e}");
        }
        assert_eq!(doc.uint(f.req("n"), "n").unwrap(), 10);
        assert!(doc.uint(f.req("q"), "q").is_err());
        let e = doc.fields(&root, "root", &["s"], &[]).err().unwrap().to_string();
        assert!(e.contains("t.yaml:2:4: root: unknown field \"q\""), "{e}");
        let e = doc.fields(&root, "root", &["missing"], &["s", "q", "n", "b", "f", "z", "h", "e"]).err().unwrap().to_string();
        assert!(e.contains("missing field \"missing\""), "{e}");
    }
}
