use std::collections::HashMap;

use ast::{ParamValue, ProseGuard};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NextActionDescriptor {
    pub tool_name: String,
    pub params: HashMap<String, ParamValue>,
    pub guards: Vec<ProseGuard>,
    pub choice_label: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NextActions {
    pub actions: Vec<NextActionDescriptor>,
    pub is_branch_possible: bool,
    pub is_unordered_possible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Remediation {
    pub message: String,
    pub allowed_next_actions: Vec<String>,
    pub missing_requirements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Decision {
    pub allowed: bool,
    pub reason: Option<String>,
    pub remediation: Option<Remediation>,
}

impl Decision {
    pub fn allowed_with(next_actions: Vec<String>) -> Self {
        Self {
            allowed: true,
            reason: None,
            remediation: if next_actions.is_empty() {
                None
            } else {
                Some(Remediation {
                    message: "Proceed with one of the next allowed actions.".into(),
                    allowed_next_actions: next_actions,
                    missing_requirements: vec![],
                })
            },
        }
    }

    pub fn blocked(reason: impl Into<String>, remediation: Option<Remediation>) -> Self {
        Self { allowed: false, reason: Some(reason.into()), remediation }
    }
}
