use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use serde_json::Value;
use session::{Decision, Session};
use tokio::sync::Mutex;

use crate::blocked::BlockedToolResponse;

/// Outcome of a wrapped call. Either the callable ran and produced `T`, or the
/// session blocked it before dispatch.
#[derive(Debug)]
pub enum WrapOutcome<T> {
    Allowed(T),
    Blocked(BlockedToolResponse),
}

impl<T> WrapOutcome<T> {
    pub fn into_result(self) -> Result<T, BlockedToolResponse> {
        match self {
            WrapOutcome::Allowed(v) => Ok(v),
            WrapOutcome::Blocked(b) => Err(b),
        }
    }
}

/// Convenience helper mirroring Python's top-level `wrap_function(session, func)`.
/// Returns a `FunctionWrapper` bound to the session; call `.call_sync(...)` etc.
/// on the returned wrapper to actually execute gated calls.
pub fn wrap_function(session: Arc<Mutex<Session>>, _func_name: &str) -> FunctionWrapper {
    FunctionWrapper::new(session)
}

/// A session-bound gate for tool calls. Holds a shared handle to the
/// `Session` so multiple wrappers can share state.
#[derive(Clone)]
pub struct FunctionWrapper {
    session: Arc<Mutex<Session>>,
}

impl FunctionWrapper {
    pub fn new(session: Arc<Mutex<Session>>) -> Self {
        Self { session }
    }

    pub fn session(&self) -> Arc<Mutex<Session>> {
        self.session.clone()
    }

    /// Synchronous gated call. Acquires the session lock, evaluates the tool
    /// call, and dispatches to `f` if allowed. The closure receives the
    /// decision so the caller can decide whether to include next-action hints.
    pub async fn call_sync<T, F>(
        &self,
        tool_name: &str,
        kwargs: HashMap<String, Value>,
        choice: Option<&str>,
        f: F,
    ) -> WrapOutcome<T>
    where
        F: FnOnce(&Decision) -> T,
    {
        let decision = {
            let mut sess = self.session.lock().await;
            let d = sess.check_tool_call(tool_name, &kwargs, choice);
            if !d.allowed {
                sess.record_blocked_call(tool_name, d.clone());
                return WrapOutcome::Blocked(BlockedToolResponse::from_decision(tool_name, &d));
            }
            sess.record_allowed_call(tool_name, kwargs.clone());
            d
        };

        let result = f(&decision);

        // We can't json-serialize an arbitrary T — callers that want the
        // result recorded should use `call_sync_json`.
        WrapOutcome::Allowed(result)
    }

    /// Like `call_sync`, but records the JSON-serializable result on the session.
    pub async fn call_sync_json<T, F>(
        &self,
        tool_name: &str,
        kwargs: HashMap<String, Value>,
        choice: Option<&str>,
        f: F,
    ) -> WrapOutcome<T>
    where
        T: serde::Serialize,
        F: FnOnce(&Decision) -> T,
    {
        let decision = {
            let mut sess = self.session.lock().await;
            let d = sess.check_tool_call(tool_name, &kwargs, choice);
            if !d.allowed {
                sess.record_blocked_call(tool_name, d.clone());
                return WrapOutcome::Blocked(BlockedToolResponse::from_decision(tool_name, &d));
            }
            sess.record_allowed_call(tool_name, kwargs.clone());
            d
        };

        let result = f(&decision);
        let json = serde_json::to_value(&result)
            .unwrap_or_else(|e| Value::String(format!("<serialize error: {e}>")));
        self.session.lock().await.record_result(tool_name, json);
        WrapOutcome::Allowed(result)
    }

    /// Async gated call. Mirrors `call_sync` for async callables.
    pub async fn call_async<T, Fut, F>(
        &self,
        tool_name: &str,
        kwargs: HashMap<String, Value>,
        choice: Option<&str>,
        f: F,
    ) -> WrapOutcome<T>
    where
        F: FnOnce(Decision) -> Fut,
        Fut: Future<Output = T>,
    {
        let decision = {
            let mut sess = self.session.lock().await;
            let d = sess.check_tool_call(tool_name, &kwargs, choice);
            if !d.allowed {
                sess.record_blocked_call(tool_name, d.clone());
                return WrapOutcome::Blocked(BlockedToolResponse::from_decision(tool_name, &d));
            }
            sess.record_allowed_call(tool_name, kwargs.clone());
            d
        };

        let result = f(decision).await;
        WrapOutcome::Allowed(result)
    }

    /// Async gated call that records a JSON-serializable result.
    pub async fn call_async_json<T, Fut, F>(
        &self,
        tool_name: &str,
        kwargs: HashMap<String, Value>,
        choice: Option<&str>,
        f: F,
    ) -> WrapOutcome<T>
    where
        T: serde::Serialize,
        F: FnOnce(Decision) -> Fut,
        Fut: Future<Output = T>,
    {
        let decision = {
            let mut sess = self.session.lock().await;
            let d = sess.check_tool_call(tool_name, &kwargs, choice);
            if !d.allowed {
                sess.record_blocked_call(tool_name, d.clone());
                return WrapOutcome::Blocked(BlockedToolResponse::from_decision(tool_name, &d));
            }
            sess.record_allowed_call(tool_name, kwargs.clone());
            d
        };

        let result = f(decision).await;
        let json = serde_json::to_value(&result)
            .unwrap_or_else(|e| Value::String(format!("<serialize error: {e}>")));
        self.session.lock().await.record_result(tool_name, json);
        WrapOutcome::Allowed(result)
    }
}
