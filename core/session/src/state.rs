use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionState {
    pub active_workflow: Option<String>,
    pub active_step: Option<String>,
    pub terminated: bool,
    pub completed_steps: Vec<String>,
    pub branches: HashMap<String, String>,
    pub retry_counts: HashMap<String, u32>,
}
