use logos::Logos;

#[derive(Logos, Debug, PartialEq, Clone)]
#[logos(skip r"[ \t\n\r]+")]
pub enum Token {
    // Keywords
    #[token("workflow")]
    Workflow,

    #[token("guarantee")]
    Guarantee,

    // Directives
    #[token("@always")]
    Always,

    #[token("@branch")]
    Branch,

    #[token("@loop")]
    Loop,

    #[token("-until")]
    Until,

    #[token("@call")]
    Call,

    #[token("@use")]
    Use,

    #[token("@inline")]
    Inline,

    #[token("@fork")]
    Fork,

    #[token("@unordered")]
    Unordered,

    #[token("@join")]
    Join,

    #[token("@llm")]
    Llm,

    #[token("@human")]
    Human,

    // Operators
    #[token("|")]
    Pipe,

    #[token("=")]
    Equals,

    #[token("&&")]
    And,

    #[token("||")]
    Or,

    #[token("!")]
    Not,

    #[token("(")]
    LParen,

    #[token(")")]
    RParen,

    // Control flow
    #[token("-when")]
    When,

    #[token("-else")]
    Else,

    #[token("-end")]
    End,

    #[token("-step")]
    StepClause,

    // Literals and identifiers
    #[regex(r#""[^"]*""#, |lex| lex.slice().to_owned())]
    StringLiteral(String),

    #[regex(r"\[([^\]]*)\]", |lex| lex.slice().to_owned())]
    ModelCheck(String),

    #[regex(r"\{([^\}]*)\}", |lex| lex.slice().to_owned())]
    HumanCheck(String),

    #[regex(r"#\{([^\}]*)\}", |lex| lex.slice().to_owned(), priority = 3)]
    LearnedCheck(String),

    #[token("*")]
    Wildcard,

    #[regex(r"[a-zA-Z_][a-zA-Z0-9_]*", |lex| lex.slice().to_owned())]
    Identifier(String),

}

impl std::fmt::Display for Token {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Token::Workflow => write!(f, "WORKFLOW"),
            Token::Guarantee => write!(f, "GUARANTEE"),
            Token::Always => write!(f, "@always"),
            Token::Branch => write!(f, "@branch"),
            Token::Loop => write!(f, "@loop"),
            Token::Until => write!(f, "-until"),
            Token::Call => write!(f, "@call"),
            Token::Use => write!(f, "@use"),
            Token::Inline => write!(f, "@inline"),
            Token::Fork => write!(f, "@fork"),
            Token::Unordered => write!(f, "@unordered"),
            Token::Join => write!(f, "@join"),
            Token::Llm => write!(f, "@llm"),
            Token::Human => write!(f, "@human"),
            Token::Pipe => write!(f, "|"),
            Token::Equals => write!(f, "="),
            Token::And => write!(f, "&&"),
            Token::Or => write!(f, "||"),
            Token::Not => write!(f, "!"),
            Token::LParen => write!(f, "("),
            Token::RParen => write!(f, ")"),
            Token::When => write!(f, "-when"),
            Token::Else => write!(f, "-else"),
            Token::End => write!(f, "-end"),
            Token::StepClause => write!(f, "-step"),
            Token::StringLiteral(s) => write!(f, "STRING({s})"),
            Token::ModelCheck(s) => write!(f, "MODEL_CHECK({s})"),
            Token::HumanCheck(s) => write!(f, "HUMAN_CHECK({s})"),
            Token::LearnedCheck(s) => write!(f, "LEARNED_CHECK({s})"),
            Token::Wildcard => write!(f, "*"),
            Token::Identifier(s) => write!(f, "IDENT({s})"),
        }
    }
}
