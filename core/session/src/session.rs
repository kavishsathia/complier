use std::collections::{HashMap, HashSet, VecDeque};

use ast::{Check, ParamValue, Policy, ProseGuard, RetryPolicy};
use compiler::Contract;
use runtime::{RuntimeNode, ToolNode};
use serde_json::Value;

use crate::decisions::{Decision, NextActionDescriptor, NextActions, Remediation};
use crate::memory::Memory;
use crate::state::{SessionEvent, SessionState};

/// Evaluates a `[model_check]` prose expression against a candidate value.
/// The `prose` includes the full guard text with check annotations stripped.
pub trait ModelEvaluator: Send + Sync {
    fn evaluate(&self, prose: &str, value: &str) -> EvalResult;
}

/// Evaluates a `{human_check}` prose expression. Typically prompts the user.
pub trait HumanEvaluator: Send + Sync {
    fn evaluate(&self, prose: &str, value: &str) -> EvalResult;
}

#[derive(Debug, Clone)]
pub struct EvalResult {
    pub passed: bool,
    pub reasons: Vec<String>,
}

impl EvalResult {
    pub fn pass() -> Self {
        Self {
            passed: true,
            reasons: vec![],
        }
    }
    pub fn fail(reason: impl Into<String>) -> Self {
        Self {
            passed: false,
            reasons: vec![reason.into()],
        }
    }
}

/// Formats a `NextActions` into the strings surfaced to agents. The default
/// formatter mirrors the Python `default_next_actions_formatter`: one line per
/// descriptor, "tool (params) — requires: guards (pass choice=\"label\")".
pub type NextActionsFormatter = Box<dyn Fn(&NextActions) -> Vec<String> + Send + Sync>;

pub struct Session {
    pub contract: Contract,
    pub state: SessionState,
    pub memory: Memory,
    pub model: Option<Box<dyn ModelEvaluator>>,
    pub human: Option<Box<dyn HumanEvaluator>>,
    pub formatter: NextActionsFormatter,
}

impl Session {
    pub fn new(contract: Contract, workflow: Option<String>) -> Result<Self, String> {
        let mut state = SessionState::default();
        if let Some(ref name) = workflow {
            if !contract.workflows.contains_key(name) {
                let available: Vec<_> = contract.workflows.keys().cloned().collect();
                return Err(format!(
                    "Unknown workflow '{name}'. Available: {}",
                    available.join(", ")
                ));
            }
            state.active_workflow = Some(name.clone());
        }
        Ok(Self {
            contract,
            state,
            memory: Memory::empty(),
            model: None,
            human: None,
            formatter: Box::new(default_next_actions_formatter),
        })
    }

    pub fn with_model(mut self, eval: Box<dyn ModelEvaluator>) -> Self {
        self.model = Some(eval);
        self
    }

    pub fn with_human(mut self, eval: Box<dyn HumanEvaluator>) -> Self {
        self.human = Some(eval);
        self
    }

    pub fn with_memory(mut self, memory: Memory) -> Self {
        self.memory = memory;
        self
    }

    pub fn with_formatter(mut self, formatter: NextActionsFormatter) -> Self {
        self.formatter = formatter;
        self
    }

    /// Describe what the agent can do first.
    pub fn kickoff(&self) -> Result<Vec<String>, String> {
        let wf_name = self
            .get_or_choose_workflow()
            .ok_or("Multiple workflows — specify one.")?;
        let start_id = &self.contract.workflows[wf_name].start_node_id;
        Ok(self.next_actions_after_node(wf_name, start_id, None))
    }

    /// Evaluate whether a tool call is allowed in the current state.
    pub fn check_tool_call(
        &mut self,
        tool_name: &str,
        kwargs: &HashMap<String, Value>,
        choice: Option<&str>,
    ) -> Decision {
        if self.state.terminated {
            return Decision::blocked("The session has been halted.", None);
        }
        if self.contract.workflows.is_empty() {
            return Decision {
                allowed: true,
                reason: None,
                remediation: None,
            };
        }

        let wf_name = match self.get_or_choose_workflow() {
            Some(n) => n.to_string(),
            None => return Decision::blocked("No active workflow.", None),
        };

        let candidates = self.collect_next_tool_nodes(&wf_name, choice);

        let matching: Vec<_> = candidates
            .iter()
            .filter(|n| n.tool_name == tool_name)
            .collect();

        if matching.is_empty() {
            let allowed: Vec<_> = candidates.iter().map(|n| n.tool_name.clone()).collect();
            return Decision::blocked(
                format!("Tool '{tool_name}' is not allowed next."),
                Some(Remediation {
                    message: "Choose one of the next allowed tool actions.".into(),
                    allowed_next_actions: {
                        let mut v: Vec<_> = allowed
                            .into_iter()
                            .collect::<HashSet<_>>()
                            .into_iter()
                            .collect();
                        v.sort();
                        v
                    },
                    missing_requirements: vec![],
                }),
            );
        }

        if matching.len() > 1 {
            return Decision::blocked(
                format!("Tool '{tool_name}' requires a choice."),
                Some(Remediation {
                    message: "Retry with a choice to select the intended branch.".into(),
                    allowed_next_actions: vec![tool_name.to_string()],
                    missing_requirements: vec![],
                }),
            );
        }

        let node_id = matching[0].id.clone();
        let node_params = matching[0].params.clone();
        let node_guards = matching[0].guards.clone();

        // validate params
        let eval = self.params_match(&node_params, kwargs, &node_guards);
        if !eval.passed {
            return self.decision_for_failed_constraint(
                &wf_name,
                &node_id,
                tool_name,
                &eval,
                &node_params,
                choice,
            );
        }

        self.state.active_workflow = Some(wf_name.clone());
        self.state.active_step = Some(node_id.clone());
        self.state.completed_steps.push(node_id.clone());
        let next_actions = self.next_actions_after_node(&wf_name, &node_id, choice);
        Decision::allowed_with(next_actions)
    }

    // ── event recording ──────────────────────────────────────────────────────

    pub fn record_allowed_call(&mut self, tool_name: &str, kwargs: HashMap<String, Value>) {
        self.state.history.push(SessionEvent::ToolCallAllowed {
            tool_name: tool_name.into(),
            kwargs,
        });
    }

    pub fn record_result(&mut self, tool_name: &str, result: Value) {
        self.state.history.push(SessionEvent::ToolResultRecorded {
            tool_name: tool_name.into(),
            result,
        });
    }

    pub fn record_blocked_call(&mut self, tool_name: &str, decision: Decision) {
        self.state.history.push(SessionEvent::ToolCallBlocked {
            tool_name: tool_name.into(),
            decision,
        });
    }

    // ── internal traversal ────────────────────────────────────────────────────

    fn get_or_choose_workflow(&self) -> Option<&str> {
        if let Some(ref name) = self.state.active_workflow {
            return Some(name.as_str());
        }
        if self.contract.workflows.len() == 1 {
            return self.contract.workflows.keys().next().map(|s| s.as_str());
        }
        None
    }

    fn collect_next_tool_nodes(&self, wf_name: &str, choice: Option<&str>) -> Vec<ToolNode> {
        let workflow = &self.contract.workflows[wf_name];
        let frontier: Vec<String> = match &self.state.active_step {
            None => vec![workflow.start_node_id.clone()],
            Some(id) => vec![id.clone()],
        };

        let mut pending: VecDeque<String> = frontier
            .iter()
            .flat_map(|id| workflow.nodes[id].next_ids().to_vec())
            .collect();

        let mut seen: HashSet<String> = HashSet::new();
        let mut candidates: Vec<ToolNode> = Vec::new();

        while let Some(node_id) = pending.pop_front() {
            if !seen.insert(node_id.clone()) {
                continue;
            }
            let node = &workflow.nodes[&node_id];
            match node {
                RuntimeNode::Tool(t) => candidates.push(t.clone()),
                RuntimeNode::Start(_)
                | RuntimeNode::BranchBack(_)
                | RuntimeNode::UnorderedBack(_)
                | RuntimeNode::Join(_) => {
                    pending.extend(node.next_ids().iter().cloned());
                }
                RuntimeNode::Branch(b) => {
                    if let Some(c) = choice {
                        if c == "else" {
                            if let Some(ref id) = b.else_node_id {
                                pending.push_back(id.clone());
                            }
                        } else if let Some(id) = b.arms.get(c) {
                            pending.push_back(id.clone());
                        }
                    } else {
                        pending.extend(b.arms.values().cloned());
                        if let Some(ref id) = b.else_node_id {
                            pending.push_back(id.clone());
                        }
                    }
                }
                RuntimeNode::Unordered(u) => {
                    if let Some(c) = choice {
                        if let Some(id) = u.case_entry_ids.get(c) {
                            pending.push_back(id.clone());
                        }
                    } else {
                        pending.extend(u.case_entry_ids.values().cloned());
                    }
                }
                _ => {
                    pending.extend(node.next_ids().iter().cloned());
                }
            }
        }
        candidates
    }

    fn next_actions_after_node(
        &self,
        wf_name: &str,
        node_id: &str,
        choice: Option<&str>,
    ) -> Vec<String> {
        let workflow = &self.contract.workflows[wf_name];
        let mut pending: VecDeque<(String, Option<String>)> = workflow.nodes[node_id]
            .next_ids()
            .iter()
            .map(|id| (id.clone(), None))
            .collect();

        let mut seen: HashSet<String> = HashSet::new();
        let mut descriptors: Vec<NextActionDescriptor> = Vec::new();
        let mut is_branch_possible = false;
        let mut is_unordered_possible = false;

        while let Some((cur_id, choice_label)) = pending.pop_front() {
            if !seen.insert(cur_id.clone()) {
                continue;
            }
            let node = &workflow.nodes[&cur_id];
            match node {
                RuntimeNode::Tool(t) => {
                    descriptors.push(NextActionDescriptor {
                        tool_name: t.tool_name.clone(),
                        params: t.params.clone(),
                        guards: t.guards.clone(),
                        choice_label: choice_label.clone(),
                    });
                }
                RuntimeNode::End(_) => {}
                RuntimeNode::Start(_)
                | RuntimeNode::BranchBack(_)
                | RuntimeNode::UnorderedBack(_)
                | RuntimeNode::Join(_) => {
                    for nid in node.next_ids() {
                        pending.push_back((nid.clone(), choice_label.clone()));
                    }
                }
                RuntimeNode::Branch(b) => {
                    is_branch_possible = true;
                    if let Some(c) = choice {
                        if c == "else" {
                            if let Some(ref id) = b.else_node_id {
                                pending.push_back((id.clone(), Some("else".into())));
                            }
                        } else if let Some(id) = b.arms.get(c) {
                            pending.push_back((id.clone(), Some(c.to_string())));
                        }
                    } else {
                        for (label, id) in &b.arms {
                            pending.push_back((id.clone(), Some(label.clone())));
                        }
                        if let Some(ref id) = b.else_node_id {
                            pending.push_back((id.clone(), Some("else".into())));
                        }
                    }
                }
                RuntimeNode::Unordered(u) => {
                    is_unordered_possible = true;
                    if let Some(c) = choice {
                        if let Some(id) = u.case_entry_ids.get(c) {
                            pending.push_back((id.clone(), Some(c.to_string())));
                        }
                    } else {
                        for (label, id) in &u.case_entry_ids {
                            pending.push_back((id.clone(), Some(label.clone())));
                        }
                    }
                }
                _ => {
                    for nid in node.next_ids() {
                        pending.push_back((nid.clone(), choice_label.clone()));
                    }
                }
            }
        }

        (self.formatter)(&NextActions {
            actions: descriptors,
            is_branch_possible,
            is_unordered_possible,
        })
    }

    fn params_match(
        &self,
        params: &HashMap<String, ParamValue>,
        kwargs: &HashMap<String, Value>,
        _guards: &[ProseGuard],
    ) -> EvalResult {
        for (name, constraint) in params {
            let Some(value) = kwargs.get(name) else {
                return EvalResult::fail(format!("Missing required param '{name}'."));
            };
            let value_str = value_as_str(value);

            match constraint {
                ParamValue::Guard(guard) => {
                    let res = self.evaluate_guard(guard, &value_str);
                    if !res.passed {
                        return res;
                    }
                }
                ParamValue::String(expected) => {
                    if expected != &value_str {
                        return EvalResult::fail(format!(
                            "Expected '{expected}', got '{value_str}'."
                        ));
                    }
                }
                ParamValue::Int(expected) => {
                    if value.as_i64() != Some(*expected) {
                        return EvalResult::fail(format!(
                            "Expected integer {expected}, got {value}."
                        ));
                    }
                }
                ParamValue::Bool(expected) => {
                    if value.as_bool() != Some(*expected) {
                        return EvalResult::fail(format!("Expected bool {expected}, got {value}."));
                    }
                }
                ParamValue::Null => {
                    if !value.is_null() {
                        return EvalResult::fail(format!("Expected null, got {value}."));
                    }
                }
            }
        }
        EvalResult::pass()
    }

    /// Walk a `ProseGuard`'s checks. Each check must pass independently;
    /// the first failure short-circuits.
    fn evaluate_guard(&self, guard: &ProseGuard, value: &str) -> EvalResult {
        let prose = strip_annotations(&guard.prose);
        for check in &guard.checks {
            match check {
                Check::Model(_) => {
                    if let Some(m) = &self.model {
                        let res = m.evaluate(&prose, value);
                        if !res.passed {
                            return res;
                        }
                    } else {
                        return EvalResult::fail(format!(
                            "No model evaluator configured for guard '{}'.",
                            prose
                        ));
                    }
                }
                Check::Human(_) => {
                    if let Some(h) = &self.human {
                        let res = h.evaluate(&prose, value);
                        if !res.passed {
                            return res;
                        }
                    } else {
                        return EvalResult::fail(format!(
                            "No human evaluator configured for guard '{}'.",
                            prose
                        ));
                    }
                }
                Check::Learned(l) => {
                    // Python dispatches learned checks to BOTH human and model
                    // (human collects feedback; model evaluates against learned
                    // memory). Both must be configured.
                    if self.human.is_none() {
                        return EvalResult::fail(
                            "Human integration is required for learned checks.".to_string(),
                        );
                    }
                    if self.model.is_none() {
                        return EvalResult::fail(
                            "Model integration is required for learned checks.".to_string(),
                        );
                    }
                    let h = self.human.as_ref().unwrap();
                    let m = self.model.as_ref().unwrap();
                    let h_res = h.evaluate(&prose, value);
                    if !h_res.passed {
                        return h_res;
                    }
                    let learned = self.memory.get_check(&l.name);
                    // Model evaluates the value against the learned memory.
                    let m_res = m.evaluate(&format!("{prose}\nlearned: {learned}"), value);
                    if !m_res.passed {
                        return m_res;
                    }
                }
            }
        }
        // If no specific checks were declared, fall back to whatever model we have
        // (mirrors the Python default for bare `[prose]`).
        if guard.checks.is_empty() {
            if let Some(m) = &self.model {
                return m.evaluate(&prose, value);
            }
        }
        EvalResult::pass()
    }

    fn decision_for_failed_constraint(
        &mut self,
        wf_name: &str,
        node_id: &str,
        tool_name: &str,
        eval: &EvalResult,
        node_params: &HashMap<String, ParamValue>,
        choice: Option<&str>,
    ) -> Decision {
        // Derive policy from whichever param-level guard is present, else default.
        let policy = node_params
            .values()
            .find_map(|v| {
                if let ParamValue::Guard(g) = v {
                    Some(g.policy.clone())
                } else {
                    None
                }
            })
            .unwrap_or(Policy::Retry(RetryPolicy { attempts: 3 }));

        match policy {
            Policy::Skip => {
                self.advance_past_node(wf_name, node_id);
                Decision::blocked(
                    format!("Tool '{tool_name}' was skipped."),
                    Some(Remediation {
                        message: "Step skipped. Continue with next action.".into(),
                        allowed_next_actions: self
                            .next_actions_after_node(wf_name, node_id, choice),
                        missing_requirements: eval.reasons.clone(),
                    }),
                )
            }
            Policy::Halt => {
                self.state.terminated = true;
                Decision::blocked(
                    format!("Tool '{tool_name}' failed a halt policy."),
                    Some(Remediation {
                        message: "Session halted.".into(),
                        allowed_next_actions: vec![],
                        missing_requirements: eval.reasons.clone(),
                    }),
                )
            }
            Policy::Retry(r) => {
                let key = format!("{wf_name}:{node_id}:{tool_name}");
                let attempt = self.state.retry_counts.entry(key).or_insert(0);
                *attempt += 1;
                let remaining = r.attempts.saturating_sub(*attempt);
                if remaining == 0 {
                    self.state.terminated = true;
                    Decision::blocked(
                        format!("Tool '{tool_name}' exhausted retries."),
                        Some(Remediation {
                            message: "No retries remain. Session halted.".into(),
                            allowed_next_actions: vec![],
                            missing_requirements: eval.reasons.clone(),
                        }),
                    )
                } else {
                    Decision::blocked(
                        format!("Tool '{tool_name}' failed a retryable constraint."),
                        Some(Remediation {
                            message: format!("Retry this action. {remaining} retries remain."),
                            allowed_next_actions: vec![tool_name.to_string()],
                            missing_requirements: eval.reasons.clone(),
                        }),
                    )
                }
            }
        }
    }

    fn advance_past_node(&mut self, wf_name: &str, node_id: &str) {
        self.state.active_workflow = Some(wf_name.to_string());
        self.state.active_step = Some(node_id.to_string());
        self.state.completed_steps.push(node_id.to_string());
    }
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn value_as_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn strip_annotations(prose: &str) -> String {
    let re = regex::Regex::new(r"#?\{[^}]+\}|\[[^\]]+\]").unwrap();
    re.replace_all(prose, |caps: &regex::Captures| {
        let m = caps.get(0).unwrap().as_str();
        m.trim_start_matches('#')
            .trim_matches(|c| c == '{' || c == '}' || c == '[' || c == ']')
            .to_string()
    })
    .to_string()
}

pub fn default_next_actions_formatter(next: &NextActions) -> Vec<String> {
    next.actions
        .iter()
        .map(|desc| {
            let mut parts: Vec<String> = Vec::new();

            let param_strs: Vec<String> = desc
                .params
                .iter()
                .map(|(name, val)| match val {
                    ParamValue::Guard(g) => format!("{name}: {}", strip_annotations(&g.prose)),
                    other => format!("{name}={other:?}"),
                })
                .collect();
            if !param_strs.is_empty() {
                parts.push(format!("({})", param_strs.join(", ")));
            }

            let guard_strs: Vec<String> = desc
                .guards
                .iter()
                .filter(|g| !g.prose.is_empty())
                .map(|g| strip_annotations(&g.prose))
                .collect();
            if !guard_strs.is_empty() {
                parts.push(format!("— requires: {}", guard_strs.join("; ")));
            }

            if let Some(ref label) = desc.choice_label {
                parts.push(format!("(pass choice=\"{label}\")"));
            }

            format!("{} {}", desc.tool_name, parts.join("  "))
                .trim()
                .to_string()
        })
        .collect()
}
