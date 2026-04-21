/// Lightweight token stream over contract source text.
///
/// The contract DSL is indentation-sensitive. This lexer emits logical lines
/// paired with their indent depth so the recursive-descent parser can detect
/// block boundaries without maintaining a separate indent stack.

#[derive(Debug, Clone, PartialEq)]
pub enum Tok {
    // keywords
    Guarantee,
    Workflow,
    Always,
    Llm,
    Human,
    Fork,
    Join,
    Branch,
    Loop,
    Unordered,
    When,
    Else,
    Until,
    Step,
    Call,
    Use,
    Inline,
    Halt,
    Skip,
    True,
    False,
    Null,

    // literals
    Ident(String),
    StringLit(String),
    ProseStringLit(String),
    Number(u32),

    // punctuation
    Pipe,
    Colon,
    Eq,
}

#[derive(Debug, Clone)]
pub struct Token {
    pub kind: Tok,
    /// 0-based indent level (number of leading 4-space groups on this logical line)
    pub indent: usize,
    pub line: usize,
}

pub fn tokenize(src: &str) -> Vec<Token> {
    let mut out = Vec::new();
    for (line_idx, raw) in src.lines().enumerate() {
        let line_no = line_idx + 1;
        let stripped = raw.trim_start();
        let leading = raw.len() - stripped.len();
        // raw leading whitespace count (spaces or tabs); parser uses 4-space units
        let indent = leading;

        let mut chars = stripped.chars().peekable();
        let mut col_tokens: Vec<Tok> = Vec::new();

        // skip blank / comment lines
        let trimmed = stripped.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        while let Some(&c) = chars.peek() {
            match c {
                ' ' | '\t' => {
                    chars.next();
                }
                '|' => {
                    chars.next();
                    col_tokens.push(Tok::Pipe);
                }
                ':' => {
                    chars.next();
                    col_tokens.push(Tok::Colon);
                }
                '=' => {
                    chars.next();
                    col_tokens.push(Tok::Eq);
                }
                '"' => {
                    chars.next();
                    let s: String = chars.by_ref().take_while(|&ch| ch != '"').collect();
                    col_tokens.push(Tok::StringLit(s));
                }
                '\'' => {
                    chars.next();
                    let s: String = chars.by_ref().take_while(|&ch| ch != '\'').collect();
                    col_tokens.push(Tok::ProseStringLit(s));
                }
                '@' => {
                    chars.next(); // consume '@'
                    let mut rest = String::new();
                    while let Some(&ch) = chars.peek() {
                        if ch.is_alphanumeric() || ch == '_' {
                            chars.next();
                            rest.push(ch);
                        } else {
                            break;
                        }
                    }
                    col_tokens.push(keyword_or_ident(&format!("@{rest}")));
                }
                '-' => {
                    chars.next();
                    let mut rest = String::new();
                    while let Some(&ch) = chars.peek() {
                        if ch.is_alphanumeric() || ch == '_' {
                            chars.next();
                            rest.push(ch);
                        } else {
                            break;
                        }
                    }
                    col_tokens.push(keyword_or_ident(&format!("-{rest}")));
                }
                c if c.is_ascii_digit() => {
                    let mut n = String::new();
                    while let Some(&ch) = chars.peek() {
                        if ch.is_ascii_digit() {
                            chars.next();
                            n.push(ch);
                        } else {
                            break;
                        }
                    }
                    col_tokens.push(Tok::Number(n.parse().unwrap_or(0)));
                }
                c if c.is_alphanumeric() || c == '_' => {
                    let _ = c;
                    let mut word = String::new();
                    while let Some(&ch) = chars.peek() {
                        if ch.is_alphanumeric() || ch == '_' || ch == '.' || ch == '/' {
                            chars.next();
                            word.push(ch);
                        } else {
                            break;
                        }
                    }
                    col_tokens.push(keyword_or_ident(&word));
                }
                _ => {
                    chars.next();
                }
            }
        }

        for kind in col_tokens {
            out.push(Token {
                kind,
                indent,
                line: line_no,
            });
        }
    }
    out
}

fn keyword_or_ident(s: &str) -> Tok {
    match s {
        "guarantee" => Tok::Guarantee,
        "workflow" => Tok::Workflow,
        "@always" => Tok::Always,
        "@llm" => Tok::Llm,
        "@human" => Tok::Human,
        "@fork" => Tok::Fork,
        "@join" => Tok::Join,
        "@branch" => Tok::Branch,
        "@loop" => Tok::Loop,
        "@unordered" => Tok::Unordered,
        "-when" => Tok::When,
        "-else" => Tok::Else,
        "-until" => Tok::Until,
        "-step" => Tok::Step,
        "@call" => Tok::Call,
        "@use" => Tok::Use,
        "@inline" => Tok::Inline,
        "halt" => Tok::Halt,
        "skip" => Tok::Skip,
        "true" => Tok::True,
        "false" => Tok::False,
        "null" => Tok::Null,
        other => Tok::Ident(other.to_string()),
    }
}
