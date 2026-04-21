use serde::{Deserialize, Serialize};
use session::{Decision, Remediation};

/// Structured response returned to the agent when a tool call is blocked.
/// Mirrors the Python `BlockedToolResponse` so agent logs stay consistent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockedToolResponse {
    pub tool_name: String,
    pub reason: Option<String>,
    pub remediation: Option<Remediation>,
}

impl BlockedToolResponse {
    pub fn from_decision(tool_name: impl Into<String>, decision: &Decision) -> Self {
        Self {
            tool_name: tool_name.into(),
            reason: decision.reason.clone(),
            remediation: decision.remediation.clone(),
        }
    }

    /// Human-readable one-liner suitable for embedding in tool output.
    pub fn summary(&self) -> String {
        let mut parts = vec![format!("[blocked: {}]", self.tool_name)];
        if let Some(r) = &self.reason {
            parts.push(r.clone());
        }
        if let Some(rem) = &self.remediation {
            if !rem.allowed_next_actions.is_empty() {
                parts.push(format!(
                    "Next allowed actions: {}",
                    rem.allowed_next_actions.join(", ")
                ));
            }
        }
        parts.join(" — ")
    }
}
