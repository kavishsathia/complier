//! Structured agent-facing guidance — mirrors Python's
//! `complier.runtime.remediation.StructuredMessage`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructuredMessage {
    pub summary: String,
    #[serde(default)]
    pub details: Vec<String>,
    #[serde(default)]
    pub allowed_next_actions: Vec<String>,
}

impl StructuredMessage {
    pub fn new(summary: impl Into<String>) -> Self {
        Self {
            summary: summary.into(),
            details: Vec::new(),
            allowed_next_actions: Vec::new(),
        }
    }
}
