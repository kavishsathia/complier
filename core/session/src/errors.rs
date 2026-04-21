//! Error types raised when enforcement blocks a tool call.

use crate::Decision;

/// Raised when a tool call is blocked by contract enforcement.
#[derive(Debug, Clone)]
pub struct BlockedToolCall {
    pub tool_name: String,
    pub decision: Decision,
}

impl BlockedToolCall {
    pub fn new(tool_name: impl Into<String>, decision: Decision) -> Self {
        Self {
            tool_name: tool_name.into(),
            decision,
        }
    }
}

impl std::fmt::Display for BlockedToolCall {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Tool '{}' was blocked by the active contract.",
            self.tool_name
        )
    }
}

impl std::error::Error for BlockedToolCall {}
