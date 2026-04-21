//! Contract-enforcement wrappers for complier.
//!
//! The core primitive is [`FunctionWrapper`]: an in-process guard that runs a
//! session check before dispatching to a callable. The MCP proxy (see the
//! `complier-mcp-proxy` binary) applies the same guard to a downstream MCP
//! server over stdio.

mod blocked;
mod function;
pub mod local;
pub mod mcp;
mod naming;
pub mod remote;

pub use blocked::BlockedToolResponse;
pub use function::{wrap_function, FunctionWrapper, WrapOutcome};
pub use naming::{normalize_tool_name, public_tool_name};
