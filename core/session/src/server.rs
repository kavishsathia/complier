//! In-process session server — the Rust analogue of Python's
//! `SessionServerClient`. Python exposed this to allow subprocess wrappers
//! (stdio/HTTP proxies) to call into the session over a local HTTP server.
//!
//! In Rust we run the proxies in the same process as the session, so this
//! "client" is just a thin pass-through over `Arc<Mutex<Session>>`. Kept
//! for API parity with the Python test suite.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::Mutex;

use crate::{Decision, Session};

#[derive(Clone)]
pub struct SessionServerClient {
    session: Arc<Mutex<Session>>,
}

impl SessionServerClient {
    pub fn new(session: Arc<Mutex<Session>>) -> Self {
        Self { session }
    }

    pub async fn check_tool_call(
        &self,
        tool_name: &str,
        _args: &[Value],
        kwargs: &HashMap<String, Value>,
        choice: Option<&str>,
    ) -> Decision {
        let mut s = self.session.lock().await;
        s.check_tool_call(tool_name, kwargs, choice)
    }

    pub async fn record_allowed_call(
        &self,
        tool_name: &str,
        _args: &[Value],
        kwargs: HashMap<String, Value>,
    ) {
        self.session
            .lock()
            .await
            .record_allowed_call(tool_name, kwargs);
    }

    pub async fn record_result(&self, tool_name: &str, result: Value) {
        self.session.lock().await.record_result(tool_name, result);
    }

    pub async fn record_blocked_call(&self, tool_name: &str, decision: Decision) {
        self.session
            .lock()
            .await
            .record_blocked_call(tool_name, decision);
    }
}
