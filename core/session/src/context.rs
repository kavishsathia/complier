//! Async session activation — the Rust equivalent of Python's
//! `complier.session.context` (a contextvar-based current session).
//!
//! Callers wrap an async block with `activate_session(session, async { ... })`;
//! anything inside that block (including spawned tasks that inherit the scope)
//! can observe the current session via `get_current_session()`.

use std::sync::Arc;

use tokio::sync::Mutex;

use crate::Session;

tokio::task_local! {
    static CURRENT_SESSION: Arc<Mutex<Session>>;
}

/// Run `fut` with `session` installed as the current session. Nesting is
/// supported: the inner scope fully shadows the outer one, and the previous
/// session is automatically restored when the inner scope exits.
pub async fn activate_session<F, T>(session: Arc<Mutex<Session>>, fut: F) -> T
where
    F: std::future::Future<Output = T>,
{
    CURRENT_SESSION.scope(session, fut).await
}

/// Returns the session active for the current task, or `None` if no
/// `activate_session` scope is in effect.
pub fn get_current_session() -> Option<Arc<Mutex<Session>>> {
    CURRENT_SESSION.try_with(|s| s.clone()).ok()
}
