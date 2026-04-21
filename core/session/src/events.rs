//! Structured runtime events. `RuntimeEvent` is a name/payload shape that
//! mirrors Python's `complier.runtime.events.RuntimeEvent`. This is
//! distinct from `SessionEvent` (the tagged-enum history), kept around
//! for API parity with the Python side.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeEvent {
    pub name: String,
    pub payload: Map<String, Value>,
}

impl RuntimeEvent {
    pub fn new(name: impl Into<String>, payload: Map<String, Value>) -> Self {
        Self {
            name: name.into(),
            payload,
        }
    }
}
