/// `complier human` is the agent's signal that it's about to ask the human.
///
/// Same pattern as `complier choose`: the hook in the active harness extension
/// intercepts the matching PreToolUse, calls daemon.human() to advance state
/// past the pending @human step, and injects strong wording in additionalContext
/// telling the agent to stop and ask the question in chat. By the time this
/// binary runs, the work is already done.
///
/// Exits 0 with a friendly message so the agent sees a normal tool result.
pub fn run() -> i32 {
    println!("complier human: prompt queued — ask the user in your next message");
    0
}
