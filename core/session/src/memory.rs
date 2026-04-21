use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Persistent learned-check state. Keys are names from `#{name}` checks; values
/// are free-form learned text the agent has accumulated across sessions.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Memory {
    #[serde(default)]
    pub checks: HashMap<String, String>,
}

impl Memory {
    pub fn empty() -> Self {
        Self::default()
    }

    pub fn from_source(source: &str) -> Result<Self, String> {
        if source.trim().is_empty() {
            return Ok(Self::empty());
        }
        let value: serde_json::Value =
            serde_json::from_str(source).map_err(|e| format!("Invalid memory JSON: {e}"))?;
        if !value.is_object() {
            return Err("Memory payload must be a JSON object.".into());
        }
        let checks = value
            .get("checks")
            .cloned()
            .unwrap_or(serde_json::Value::Object(Default::default()));
        if !checks.is_object() {
            return Err("Memory 'checks' field must be an object.".into());
        }
        let map: HashMap<String, String> = serde_json::from_value(checks)
            .map_err(|e| format!("Memory 'checks' must be a string→string object: {e}"))?;
        Ok(Self { checks: map })
    }

    pub fn from_file(path: impl AsRef<Path>) -> Result<Self, String> {
        let s = std::fs::read_to_string(path).map_err(|e| format!("read memory: {e}"))?;
        Self::from_source(&s)
    }

    pub fn get_check(&self, name: &str) -> &str {
        self.checks.get(name).map(String::as_str).unwrap_or("")
    }

    pub fn update_check(&mut self, name: impl Into<String>, value: impl Into<String>) {
        self.checks.insert(name.into(), value.into());
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }

    pub fn save(&self, path: impl AsRef<Path>) -> Result<(), String> {
        std::fs::write(path, format!("{}\n", self.to_json()))
            .map_err(|e| format!("write memory: {e}"))
    }
}
