/// `complier choose <arm>` is a placeholder binary the agent calls via Bash.
///
/// The hook in the active harness extension intercepts the matching PreToolUse
/// event, parses the arm out of the command string, and does the daemon RPC
/// itself (it has the session_id; this binary doesn't). So by the time this
/// process runs, the choice is already staged on the daemon.
///
/// All this needs to do is exit 0 with a friendly message so the agent sees
/// a normal tool result.
pub fn run(arm: &str) -> i32 {
    println!("complier choice staged: {arm}");
    0
}
