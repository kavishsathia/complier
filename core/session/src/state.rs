use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::decisions::Decision;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event")]
pub enum SessionEvent {
    #[serde(rename = "tool_call_allowed")]
    ToolCallAllowed {
        tool_name: String,
        kwargs: HashMap<String, Value>,
    },
    #[serde(rename = "tool_result_recorded")]
    ToolResultRecorded {
        tool_name: String,
        result: Value,
    },
    #[serde(rename = "tool_call_blocked")]
    ToolCallBlocked {
        tool_name: String,
        decision: Decision,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionState {
    pub active_workflow: Option<String>,
    pub active_step: Option<String>,
    pub terminated: bool,
    pub completed_steps: Vec<String>,
    pub branches: HashMap<String, String>,
    pub retry_counts: HashMap<String, u32>,
    #[serde(default)]
    pub history: Vec<SessionEvent>,
}
