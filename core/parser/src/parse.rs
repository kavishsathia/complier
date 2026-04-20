use std::collections::VecDeque;

use ast::*;
use regex::Regex;
use thiserror::Error;

use crate::lexer::{Tok, Token, tokenize};

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("unexpected token at line {line}: {msg}")]
    Unexpected { line: usize, msg: String },
    #[error("unexpected end of input: {0}")]
    Eof(String),
}

struct Parser {
    tokens: VecDeque<Token>,
}

pub fn parse(src: &str) -> Result<Program, ParseError> {
    let tokens = tokenize(src);
    let mut p = Parser { tokens: tokens.into() };
    p.parse_program()
}

impl Parser {
    // ── helpers ──────────────────────────────────────────────────────────────

    fn peek(&self) -> Option<&Token> {
        self.tokens.front()
    }

    fn peek_kind(&self) -> Option<&Tok> {
        self.tokens.front().map(|t| &t.kind)
    }

    fn next(&mut self) -> Option<Token> {
        self.tokens.pop_front()
    }

    fn next_line(&self) -> usize {
        self.peek().map(|t| t.line).unwrap_or(0)
    }

    fn expect_ident(&mut self) -> Result<String, ParseError> {
        match self.next() {
            Some(Token { kind: Tok::Ident(s), .. }) => Ok(s),
            Some(t) => Err(ParseError::Unexpected { line: t.line, msg: format!("expected identifier, got {:?}", t.kind) }),
            None => Err(ParseError::Eof("expected identifier".into())),
        }
    }

    fn expect_string(&mut self) -> Result<String, ParseError> {
        match self.next() {
            Some(Token { kind: Tok::StringLit(s), .. }) => Ok(s),
            Some(t) => Err(ParseError::Unexpected { line: t.line, msg: format!("expected string, got {:?}", t.kind) }),
            None => Err(ParseError::Eof("expected string".into())),
        }
    }

    fn expect_prose(&mut self) -> Result<String, ParseError> {
        match self.next() {
            Some(Token { kind: Tok::ProseStringLit(s), .. }) => Ok(s),
            Some(t) => Err(ParseError::Unexpected { line: t.line, msg: format!("expected prose string, got {:?}", t.kind) }),
            None => Err(ParseError::Eof("expected prose string".into())),
        }
    }

    // ── program ──────────────────────────────────────────────────────────────

    fn parse_program(&mut self) -> Result<Program, ParseError> {
        let mut items = Vec::new();
        while self.peek().is_some() {
            items.push(self.parse_item()?);
        }
        Ok(Program { items })
    }

    fn parse_item(&mut self) -> Result<Item, ParseError> {
        match self.peek_kind() {
            Some(Tok::Guarantee) => Ok(Item::Guarantee(self.parse_guarantee()?)),
            Some(Tok::Workflow)  => Ok(Item::Workflow(self.parse_workflow()?)),
            Some(_) => {
                let t = self.next().unwrap();
                Err(ParseError::Unexpected { line: t.line, msg: format!("expected guarantee or workflow, got {:?}", t.kind) })
            }
            None => Err(ParseError::Eof("expected item".into())),
        }
    }

    // ── guarantee ────────────────────────────────────────────────────────────

    fn parse_guarantee(&mut self) -> Result<Guarantee, ParseError> {
        self.next(); // consume `guarantee`
        let name = self.expect_ident()?;
        let expression = self.parse_prose_guard()?;
        Ok(Guarantee { name, expression })
    }

    // ── workflow ─────────────────────────────────────────────────────────────

    fn parse_workflow(&mut self) -> Result<Workflow, ParseError> {
        self.next(); // consume `workflow`
        let name = self.expect_string()?;

        let mut always = Vec::new();
        while matches!(self.peek_kind(), Some(Tok::Always)) {
            self.next(); // consume `@always`
            always.push(self.expect_ident()?);
        }

        // steps are indented (indent > 0 and start with Pipe)
        let steps = self.parse_steps(4)?;
        Ok(Workflow { name, always, steps })
    }

    // ── steps ─────────────────────────────────────────────────────────────────

    /// Parse a sequence of steps at the given minimum indent level.
    fn parse_steps(&mut self, min_indent: usize) -> Result<Vec<Step>, ParseError> {
        let mut steps = Vec::new();
        while let Some(t) = self.peek() {
            if t.indent < min_indent {
                break;
            }
            if !matches!(t.kind, Tok::Pipe) {
                break;
            }
            steps.push(self.parse_step(min_indent)?);
        }
        Ok(steps)
    }

    fn parse_step(&mut self, base_indent: usize) -> Result<Step, ParseError> {
        // consume the leading `|`
        self.next();

        match self.peek_kind() {
            Some(Tok::Llm)       => { self.next(); Ok(Step::Llm(LlmStep { prompt: self.expect_string()? })) }
            Some(Tok::Human)     => { self.next(); Ok(Step::Human(HumanStep { prompt: self.expect_string()? })) }
            Some(Tok::Fork)      => self.parse_fork_step(),
            Some(Tok::Join)      => self.parse_join_step(),
            Some(Tok::Call) | Some(Tok::Use) | Some(Tok::Inline) => self.parse_subworkflow_step(),
            Some(Tok::Branch)    => self.parse_branch_step(base_indent),
            Some(Tok::Loop)      => self.parse_loop_step(base_indent),
            Some(Tok::Unordered) => self.parse_unordered_step(base_indent),
            Some(Tok::Ident(_))  => self.parse_tool_step(),
            _ => {
                let line = self.next_line();
                Err(ParseError::Unexpected { line, msg: "expected step keyword or tool name".into() })
            }
        }
    }

    fn parse_tool_step(&mut self) -> Result<Step, ParseError> {
        let name = self.expect_ident()?;
        let mut params = Vec::new();

        // params are on the same line (same indent level), each `ident =`
        while let Some(Token { kind: Tok::Ident(_), indent, .. }) = self.peek() {
            let _ = indent;
            let param_name = self.expect_ident()?;
            // expect `=`
            match self.peek_kind() {
                Some(Tok::Eq) => { self.next(); }
                _ => {
                    // not a param — push ident back as ident? We can't un-consume easily.
                    // Instead treat it as a bare ident param with null value (unlikely in practice)
                    params.push(Param { name: param_name, value: ParamValue::Null });
                    continue;
                }
            }
            let value = self.parse_param_value()?;
            params.push(Param { name: param_name, value });
        }

        Ok(Step::Tool(ToolStep { name, params }))
    }

    fn parse_subworkflow_step(&mut self) -> Result<Step, ParseError> {
        let call_type = match self.next().map(|t| t.kind) {
            Some(Tok::Call)   => "@call".to_string(),
            Some(Tok::Use)    => "@use".to_string(),
            Some(Tok::Inline) => "@inline".to_string(),
            _ => unreachable!(),
        };
        let workflow_name = self.expect_ident()?;
        Ok(Step::Subworkflow(SubworkflowStep { call_type, workflow_name }))
    }

    fn parse_fork_step(&mut self) -> Result<Step, ParseError> {
        self.next(); // consume @fork
        let fork_id = self.expect_ident()?;
        let Step::Subworkflow(target) = self.parse_subworkflow_step()? else {
            unreachable!()
        };
        Ok(Step::Fork(ForkStep { fork_id, target }))
    }

    fn parse_join_step(&mut self) -> Result<Step, ParseError> {
        self.next(); // consume @join
        let fork_id = self.expect_ident()?;
        Ok(Step::Join(JoinStep { fork_id }))
    }

    fn parse_branch_step(&mut self, base_indent: usize) -> Result<Step, ParseError> {
        self.next(); // consume @branch
        let arm_indent = base_indent + 4;
        let body_indent = base_indent + 8;

        let mut when_arms = Vec::new();
        let mut else_arm: Option<ElseArm> = None;

        while let Some(t) = self.peek() {
            if t.indent < arm_indent {
                break;
            }
            match &t.kind {
                Tok::When => {
                    self.next();
                    let condition = self.expect_string()?;
                    let steps = self.parse_steps(body_indent)?;
                    when_arms.push(WhenArm { condition, steps });
                }
                Tok::Else => {
                    self.next();
                    let steps = self.parse_steps(body_indent)?;
                    else_arm = Some(ElseArm { steps });
                }
                _ => break,
            }
        }

        Ok(Step::Branch(BranchStep { when_arms, else_arm }))
    }

    fn parse_loop_step(&mut self, base_indent: usize) -> Result<Step, ParseError> {
        self.next(); // consume @loop
        let body_indent = base_indent + 4;

        let mut steps = Vec::new();
        let mut until = String::new();

        while let Some(t) = self.peek() {
            if t.indent < body_indent {
                break;
            }
            if matches!(t.kind, Tok::Until) {
                self.next();
                until = self.expect_string()?;
                break;
            }
            if matches!(t.kind, Tok::Pipe) {
                steps.extend(self.parse_steps(body_indent)?);
            } else {
                break;
            }
        }

        Ok(Step::Loop(LoopStep { steps, until }))
    }

    fn parse_unordered_step(&mut self, base_indent: usize) -> Result<Step, ParseError> {
        self.next(); // consume @unordered
        let case_indent = base_indent + 4;
        let body_indent = base_indent + 8;

        let mut cases = Vec::new();

        while let Some(t) = self.peek() {
            if t.indent < case_indent {
                break;
            }
            if matches!(t.kind, Tok::Step) {
                self.next();
                let label = self.expect_string()?;
                let steps = self.parse_steps(body_indent)?;
                cases.push(UnorderedCase { label, steps });
            } else {
                break;
            }
        }

        Ok(Step::Unordered(UnorderedStep { cases }))
    }

    // ── params / values ───────────────────────────────────────────────────────

    fn parse_param_value(&mut self) -> Result<ParamValue, ParseError> {
        match self.peek_kind() {
            Some(Tok::ProseStringLit(_)) => Ok(ParamValue::Guard(Box::new(self.parse_prose_guard()?))),
            Some(Tok::StringLit(_))      => Ok(ParamValue::String(self.expect_string()?)),
            Some(Tok::Number(_))         => {
                if let Some(Token { kind: Tok::Number(n), .. }) = self.next() {
                    Ok(ParamValue::Int(n as i64))
                } else { unreachable!() }
            }
            Some(Tok::True)  => { self.next(); Ok(ParamValue::Bool(true)) }
            Some(Tok::False) => { self.next(); Ok(ParamValue::Bool(false)) }
            Some(Tok::Null)  => { self.next(); Ok(ParamValue::Null) }
            _ => {
                let line = self.next_line();
                Err(ParseError::Unexpected { line, msg: "expected param value".into() })
            }
        }
    }

    // ── prose guard ───────────────────────────────────────────────────────────

    fn parse_prose_guard(&mut self) -> Result<ProseGuard, ParseError> {
        let prose = self.expect_prose()?;
        let checks = extract_checks(&prose);

        let policy = if matches!(self.peek_kind(), Some(Tok::Colon)) {
            self.next(); // consume `:`
            self.parse_policy()?
        } else {
            Policy::default()
        };

        Ok(ProseGuard { prose, checks, policy })
    }

    fn parse_policy(&mut self) -> Result<Policy, ParseError> {
        match self.peek_kind() {
            Some(Tok::Halt)     => { self.next(); Ok(Policy::Halt) }
            Some(Tok::Skip)     => { self.next(); Ok(Policy::Skip) }
            Some(Tok::Number(_)) => {
                if let Some(Token { kind: Tok::Number(n), .. }) = self.next() {
                    Ok(Policy::Retry(RetryPolicy { attempts: n }))
                } else { unreachable!() }
            }
            _ => {
                let line = self.next_line();
                Err(ParseError::Unexpected { line, msg: "expected policy (halt, skip, or number)".into() })
            }
        }
    }
}

// ── check extraction ──────────────────────────────────────────────────────────

fn extract_checks(prose: &str) -> Vec<Check> {
    let re = Regex::new(r"#\{([^}]+)\}|\{([^}]+)\}|\[([^\]]+)\]").unwrap();
    let mut checks = Vec::new();
    for cap in re.captures_iter(prose) {
        if let Some(m) = cap.get(1) {
            checks.push(Check::Learned(LearnedCheck { name: m.as_str().to_string() }));
        } else if let Some(m) = cap.get(2) {
            checks.push(Check::Human(HumanCheck { name: m.as_str().to_string() }));
        } else if let Some(m) = cap.get(3) {
            checks.push(Check::Model(ModelCheck { name: m.as_str().to_string() }));
        }
    }
    checks
}
