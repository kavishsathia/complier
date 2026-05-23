# cc — complier for Claude Code

A thin Claude Code hook adapter that gates tool calls through a `.cpl` contract.

cc is an **extension**: it doesn't own a session itself. It forwards Claude Code's hook events to the complier daemon, which owns the per-session state.

- **Daemon** (`python -m daemon serve`): one process, many sessions. Owns each `Session` over its `.cpl` contract. Listens on `~/.complier/daemon.sock`.
- **Hook** (`python -m cc hook`): Claude Code's `PreToolUse` / `PostToolUse` / `SessionStart` runner. Reads the hook event from stdin, talks to the daemon, writes the hook response to stdout.

On `PreToolUse`, the hook asks the daemon `check_tool_call`. If the contract blocks the call, the hook emits `permissionDecision: "deny"` with the remediation. If allowed, it emits `permissionDecision: "allow"` and stuffs the HATEOAS next-action hints into `additionalContext`. `PostToolUse` records the tool's result on the session so the graph advances.

## Quick start

1. Drop a `complier.cpl` in your project (or `.claude/complier.cpl`).
2. Add the hooks from `examples/settings.json` to your `.claude/settings.json`.
3. Open Claude Code in that project. The daemon auto-spawns on the first hook; tool calls are now contract-gated.

## Contract discovery

In order: `$CC_CONTRACT` → `<cwd>/.claude/complier.cpl` → `<cwd>/complier.cpl`.

## Session naming

Sessions are keyed in the daemon as `cc:<claude_session_id>`. This namespaces cc's sessions away from sessions other extensions might attach to the same daemon.

## Tool names

Claude Code's built-in tools (`Read`, `Bash`, `Edit`, `Write`, `Grep`, …) and MCP tools (`mcp__<server>__<tool>`) are passed through verbatim. Use those exact names in your `.cpl`.

## Distribution

This is currently a dev-only extension; you run it from the repo. The example `settings.json` assumes `python -m cc hook` resolves to this package. Until the desktop app's installer is built, drop a wrapper into your PATH that sets `PYTHONPATH` to include this repo's `extensions/` directory, or run via the repo root with `PYTHONPATH=/path/to/complier/extensions`.
