use crate::lexer::Token;
use logos::Logos;

#[derive(Debug)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug)]
pub struct ParseError {
    pub message: String,
    pub span: Span,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "parse error at {}..{}: {}", self.span.start, self.span.end, self.message)
    }
}

pub struct Parser {
    tokens: Vec<(Token, Span)>,
    pos: usize,
}

impl Parser {
    pub fn new(input: &str) -> Self {
        let lexer = Token::lexer(input);
        let tokens: Vec<(Token, Span)> = lexer
            .spanned()
            .filter_map(|(result, span)| {
                result.ok().map(|token| (token, Span { start: span.start, end: span.end }))
            })
            .collect();
        Parser { tokens, pos: 0 }
    }

    /// Access the raw token list (for debugging).
    pub fn tokens(&self) -> &[(Token, Span)] {
        &self.tokens
    }

    /// Look at the current token without consuming it.
    pub fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos).map(|(tok, _)| tok)
    }

    /// Look at the current token's span without consuming it.
    pub fn peek_span(&self) -> Option<&Span> {
        self.tokens.get(self.pos).map(|(_, span)| span)
    }

    /// Consume the current token and advance. Returns the token and its span.
    pub fn consume(&mut self) -> Result<(&Token, &Span), ParseError> {
        if self.pos >= self.tokens.len() {
            return Err(self.error_at_end("unexpected end of input"));
        }
        let entry = &self.tokens[self.pos];
        self.pos += 1;
        Ok((&entry.0, &entry.1))
    }

    /// Consume the current token only if it matches the expected token.
    /// Returns the span on success.
    pub fn expect(&mut self, expected: &Token) -> Result<&Span, ParseError> {
        match self.peek() {
            Some(tok) if tok == expected => {
                let (_, span) = self.consume()?;
                Ok(span)
            }
            Some(tok) => Err(ParseError {
                message: format!("expected {expected}, found {tok}"),
                span: Span {
                    start: self.tokens[self.pos].1.start,
                    end: self.tokens[self.pos].1.end,
                },
            }),
            None => Err(self.error_at_end(&format!("expected {expected}, found end of input"))),
        }
    }

    /// Consume the current token if it matches, returning true. Otherwise return false.
    pub fn consume_if(&mut self, expected: &Token) -> bool {
        match self.peek() {
            Some(tok) if tok == expected => {
                self.pos += 1;
                true
            }
            _ => false,
        }
    }

    /// Check if the parser has reached the end of input.
    pub fn is_eof(&self) -> bool {
        self.pos >= self.tokens.len()
    }

    /// Create an error at the current position.
    pub fn error(&self, message: &str) -> ParseError {
        let span = self
            .tokens
            .get(self.pos)
            .map(|(_, s)| Span { start: s.start, end: s.end })
            .unwrap_or_else(|| self.eof_span());
        ParseError { message: message.to_string(), span }
    }

    fn error_at_end(&self, message: &str) -> ParseError {
        ParseError {
            message: message.to_string(),
            span: self.eof_span(),
        }
    }

    fn eof_span(&self) -> Span {
        self.tokens
            .last()
            .map(|(_, s)| Span { start: s.end, end: s.end })
            .unwrap_or(Span { start: 0, end: 0 })
    }
}
