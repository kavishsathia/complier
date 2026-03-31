use crate::ast::*;
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
        write!(
            f,
            "parse error at {}..{}: {}",
            self.span.start, self.span.end, self.message
        )
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
                result.ok().map(|token| {
                    (
                        token,
                        Span {
                            start: span.start,
                            end: span.end,
                        },
                    )
                })
            })
            .collect();
        Parser { tokens, pos: 0 }
    }

    pub fn tokens(&self) -> &[(Token, Span)] {
        &self.tokens
    }

    pub fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos).map(|(tok, _)| tok)
    }

    pub fn peek_span(&self) -> Option<&Span> {
        self.tokens.get(self.pos).map(|(_, span)| span)
    }

    pub fn consume(&mut self) -> Result<(&Token, &Span), ParseError> {
        if self.pos >= self.tokens.len() {
            return Err(self.error_at_end("unexpected end of input"));
        }
        let entry = &self.tokens[self.pos];
        self.pos += 1;
        Ok((&entry.0, &entry.1))
    }

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

    pub fn consume_if(&mut self, expected: &Token) -> bool {
        match self.peek() {
            Some(tok) if tok == expected => {
                self.pos += 1;
                true
            }
            _ => false,
        }
    }

    pub fn is_eof(&self) -> bool {
        self.pos >= self.tokens.len()
    }

    pub fn error(&self, message: &str) -> ParseError {
        let span = self
            .tokens
            .get(self.pos)
            .map(|(_, s)| Span {
                start: s.start,
                end: s.end,
            })
            .unwrap_or_else(|| self.eof_span());
        ParseError {
            message: message.to_string(),
            span,
        }
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
            .map(|(_, s)| Span {
                start: s.end,
                end: s.end,
            })
            .unwrap_or(Span { start: 0, end: 0 })
    }

    // program = (workflow | guarantee)*
    pub fn parse_program(&mut self) -> Result<Program, ParseError> {
        let mut items = Vec::new();
        while !self.is_eof() {
            match self.peek() {
                Some(Token::Workflow) => items.push(Item::Workflow(self.parse_workflow()?)),
                Some(Token::Guarantee) => items.push(Item::Guarantee(self.parse_guarantee()?)),
                _ => return Err(self.error("expected 'workflow' or 'guarantee'")),
            }
        }
        Ok(Program { items })
    }

    // workflow = "workflow" STRING (@always IDENT)* step*
    fn parse_workflow(&mut self) -> Result<Workflow, ParseError> {
        self.expect(&Token::Workflow)?;
        let name = self.expect_string()?;

        let mut always = Vec::new();
        while self.consume_if(&Token::Always) {
            always.push(self.expect_identifier()?);
        }

        let steps = self.parse_steps()?;
        Ok(Workflow {
            name,
            always,
            steps,
        })
    }

    // guarantee = "guarantee" IDENT contract
    fn parse_guarantee(&mut self) -> Result<Guarantee, ParseError> {
        self.expect(&Token::Guarantee)?;
        let name = self.expect_identifier()?;
        let contract = self.parse_contract()?;
        Ok(Guarantee { name, contract })
    }

    // Parses pipe-separated steps. Stops at -when, -until, -end, or EOF.
    fn parse_steps(&mut self) -> Result<Vec<Step>, ParseError> {
        let mut steps = Vec::new();
        while self.consume_if(&Token::Pipe) {
            steps.push(self.parse_step()?);
        }
        Ok(steps)
    }

    fn parse_step(&mut self) -> Result<Step, ParseError> {
        match self.peek() {
            Some(Token::Llm) => {
                let call = self.parse_llm_call()?;
                Ok(Step::Llm(call))
            }
            Some(Token::Human) => {
                let call = self.parse_human_call()?;
                Ok(Step::Human(HumanCall {
                    prompt: call.prompt,
                    contract: call.contract,
                }))
            }
            Some(Token::Branch) => {
                let block = self.parse_branch()?;
                Ok(Step::Branch(block))
            }
            Some(Token::Loop) => {
                let block = self.parse_loop()?;
                Ok(Step::Loop(block))
            }
            Some(Token::Unordered) => {
                let block = self.parse_unordered()?;
                Ok(Step::Unordered(block))
            }
            Some(Token::Fork) => {
                let step = self.parse_fork()?;
                Ok(Step::Fork(step))
            }
            Some(Token::Join) => {
                let step = self.parse_join()?;
                Ok(Step::Join(step))
            }

            Some(Token::Call | Token::Use | Token::Inline) => {
                let call = self.parse_sub_workflow()?;
                Ok(Step::SubWorkflow(call))
            }
            Some(Token::Identifier(_)) => {
                let call = self.parse_tool_call()?;
                Ok(Step::Tool(call))
            }
            _ => Err(self.error("expected a step")),
        }
    }

    // tool_call = IDENT param* contract? failure_policy?
    fn parse_tool_call(&mut self) -> Result<ToolCall, ParseError> {
        let name = self.expect_identifier()?;

        let mut params = Vec::new();
        while self
            .peek()
            .map_or(false, |tok| matches!(tok, Token::Identifier(_)))
        {
            params.push(self.parse_param()?);
        }

        let contract = if self.is_contract_start() {
            Some(self.parse_contract()?)
        } else {
            None
        };

        Ok(ToolCall {
            name,
            params,
            contract,
        })
    }

    // llm_call = "@llm" STRING contract? failure_policy?
    fn parse_llm_call(&mut self) -> Result<LlmCall, ParseError> {
        self.expect(&Token::Llm)?;
        let prompt = self.expect_string()?;

        let contract = if self.is_contract_start() {
            Some(self.parse_contract()?)
        } else {
            None
        };

        Ok(LlmCall { prompt, contract })
    }

    // human_call = "@human" STRING contract?
    fn parse_human_call(&mut self) -> Result<HumanCall, ParseError> {
        self.expect(&Token::Human)?;
        let prompt = self.expect_string()?;

        let contract = if self.is_contract_start() {
            Some(self.parse_contract()?)
        } else {
            None
        };

        Ok(HumanCall { prompt, contract })
    }

    // param = IDENT "=" (STRING | IDENT)
    fn parse_param(&mut self) -> Result<Param, ParseError> {
        let name = self.expect_identifier()?;
        self.expect(&Token::Equals)?;

        let value = match self.peek() {
            Some(Token::StringLiteral(_)) => ParamValue::String(self.expect_string()?),
            _ => ParamValue::Contract(self.parse_contract()?),
        };

        Ok(Param { name, value })
    }

    // branch = "@branch" when_arm+ "-end"
    fn parse_branch(&mut self) -> Result<BranchBlock, ParseError> {
        self.expect(&Token::Branch)?;
        let mut arms = Vec::new();
        let mut else_steps = None;
        loop {
            match self.peek() {
                Some(Token::When) => arms.push(self.parse_when_arm()?),
                Some(Token::Else) => {
                    self.consume()?;
                    else_steps = Some(self.parse_steps()?);
                }
                Some(Token::End) => {
                    self.consume()?;
                    break;
                }
                _ => return Err(self.error("expected -when, -else, or -end")),
            }
        }
        Ok(BranchBlock { arms, else_steps })
    }

    // when_arm = "-when" STRING steps
    fn parse_when_arm(&mut self) -> Result<WhenArm, ParseError> {
        self.expect(&Token::When)?;
        let pattern = self.expect_string()?;
        let steps = self.parse_steps()?;
        Ok(WhenArm { pattern, steps })
    }

    // loop = "@loop" steps "-until" STRING "-end"
    fn parse_loop(&mut self) -> Result<LoopBlock, ParseError> {
        self.expect(&Token::Loop)?;
        let steps = self.parse_steps()?;
        self.expect(&Token::Until)?;
        let until = self.expect_string()?;
        self.expect(&Token::End)?;
        Ok(LoopBlock { steps, until })
    }

    // unordered = "@unordered" ("-step" step)+ "-end"
    fn parse_unordered(&mut self) -> Result<UnorderedBlock, ParseError> {
        self.expect(&Token::Unordered)?;
        let mut steps = Vec::new();
        while !self.consume_if(&Token::End) {
            self.expect(&Token::StepClause)?;
            steps.push(self.parse_step()?);
        }
        Ok(UnorderedBlock { steps })
    }

    // fork = "@fork" IDENT call_type IDENT
    fn parse_fork(&mut self) -> Result<ForkStep, ParseError> {
        self.expect(&Token::Fork)?;
        let id = self.expect_identifier()?;
        let call_type = self.parse_call_type()?;
        let workflow = self.expect_identifier()?;
        Ok(ForkStep {
            id,
            call_type,
            workflow,
        })
    }

    // join = "@join" IDENT
    fn parse_join(&mut self) -> Result<JoinStep, ParseError> {
        self.expect(&Token::Join)?;
        let id = self.expect_identifier()?;
        Ok(JoinStep { id })
    }

    // sub_workflow = call_type IDENT
    fn parse_sub_workflow(&mut self) -> Result<SubWorkflowCall, ParseError> {
        let call_type = self.parse_call_type()?;
        let workflow = self.expect_identifier()?;
        Ok(SubWorkflowCall {
            call_type,
            workflow,
        })
    }

    fn parse_call_type(&mut self) -> Result<CallType, ParseError> {
        match self.peek() {
            Some(Token::Call) => {
                self.consume()?;
                Ok(CallType::Call)
            }
            Some(Token::Use) => {
                self.consume()?;
                Ok(CallType::Use)
            }
            Some(Token::Inline) => {
                self.consume()?;
                Ok(CallType::Inline)
            }
            _ => Err(self.error("expected @call, @use, or @inline")),
        }
    }

    // Pratt parser entry point for contracts.
    fn parse_contract(&mut self) -> Result<Contract, ParseError> {
        self.parse_contract_expr(0)
    }

    // Binding powers: ! (prefix, 5), & (infix, 3), | (infix, 1)
    fn parse_contract_expr(&mut self, min_bp: u8) -> Result<Contract, ParseError> {
        let mut lhs = match self.peek().cloned() {
            Some(Token::Not) => {
                self.consume()?;
                let rhs = self.parse_contract_expr(5)?;
                Contract::Not(Box::new(rhs))
            }
            Some(Token::LParen) => {
                self.consume()?;
                let inner = self.parse_contract_expr(0)?;
                self.expect(&Token::RParen)?;
                inner
            }
            Some(Token::StringLiteral(s)) => {
                self.consume()?;
                Contract::Literal(s[1..s.len() - 1].to_string())
            }
            Some(Token::Wildcard) => {
                self.consume()?;
                Contract::Wildcard
            }
            Some(Token::ModelCheck(s)) => {
                self.consume()?;
                let inner = &s[1..s.len() - 1];
                let (check, policy) = self.parse_check_content(inner)?;
                Contract::ModelCheck(check, policy)
            }
            Some(Token::HumanCheck(s)) => {
                self.consume()?;
                let inner = &s[1..s.len() - 1];
                let (check, policy) = self.parse_check_content(inner)?;
                Contract::HumanCheck(check, policy)
            }
            Some(Token::LearnedCheck(s)) => {
                self.consume()?;
                let inner = &s[2..s.len() - 1];
                let (check, policy) = self.parse_check_content(inner)?;
                Contract::LearnedCheck(check, policy)
            }
            Some(Token::Identifier(name)) => {
                self.consume()?;
                Contract::GuaranteeRef(name)
            }
            _ => return Err(self.error("expected contract expression")),
        };

        loop {
            let (l_bp, r_bp) = match self.peek() {
                Some(Token::Or) => (1, 2),
                Some(Token::And) => (3, 4),
                _ => break,
            };

            if l_bp < min_bp {
                break;
            }

            let op = self.peek().cloned();
            self.consume()?;
            let rhs = self.parse_contract_expr(r_bp)?;

            lhs = match op {
                Some(Token::Or) => Contract::Or(Box::new(lhs), Box::new(rhs)),
                Some(Token::And) => Contract::And(Box::new(lhs), Box::new(rhs)),
                _ => unreachable!(),
            };
        }

        Ok(lhs)
    }

    fn parse_check_content(&self, content: &str) -> Result<(String, Option<FailurePolicy>), ParseError> {
        match content.rsplit_once(':') {
            Some((check, policy_str)) => {
                let policy = match policy_str.trim() {
                    "halt" => Some(FailurePolicy::Halt),
                    "skip" => Some(FailurePolicy::Skip),
                    n => match n.parse::<u32>() {
                        Ok(count) => Some(FailurePolicy::Retry(count)),
                        Err(_) => return Ok((content.to_string(), None)),
                    },
                };
                Ok((check.trim().to_string(), policy))
            }
            None => Ok((content.trim().to_string(), None)),
        }
    }

    fn expect_identifier(&mut self) -> Result<String, ParseError> {
        match self.peek().cloned() {
            Some(Token::Identifier(name)) => {
                self.consume()?;
                Ok(name)
            }
            _ => Err(self.error("expected identifier")),
        }
    }

    fn expect_string(&mut self) -> Result<String, ParseError> {
        match self.peek().cloned() {
            Some(Token::StringLiteral(s)) => {
                self.consume()?;
                Ok(s[1..s.len() - 1].to_string())
            }
            _ => Err(self.error("expected string literal")),
        }
    }

    fn is_contract_start(&self) -> bool {
        matches!(
            self.peek(),
            Some(
                Token::StringLiteral(_)
                    | Token::Wildcard
                    | Token::ModelCheck(_)
                    | Token::HumanCheck(_)
                    | Token::LearnedCheck(_)
                    | Token::Not
                    | Token::LParen
                    | Token::Identifier(_)
            )
        )
    }
}
