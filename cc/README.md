# cc — complier for Claude Code

A local sidecar that gates Claude Code's tool calls through a `.cpl` contract.

- **Sidecar** (`python -m cc serve --session-id ...`): one process per Claude Code session. Owns a `Session` over a `.cpl` contract. Listens on a Unix socket and speaks newline-delimited JSON-RPC.
- **Client** (`python -m cc hook`): runs as Claude Code's `PreToolUse` / `PostToolUse` / `SessionStart` hook. Reads the hook event from stdin, talks to the sidecar, writes the hook response to stdout.

When `PreToolUse` fires, the client asks the sidecar `check_tool_call`. If the contract blocks the call, the client emits `permissionDecision: "deny"` with the remediation. If the contract allows, it emits `permissionDecision: "allow"` and stuffs the HATEOAS next-action hints into `additionalContext`. `PostToolUse` records the tool's result on the session so the graph advances.

## Quick start

1. Drop a `complier.cpl` in your project (or `.claude/complier.cpl`).
2. Add the hooks from `examples/settings.json` to your `.claude/settings.json`.
3. Open Claude Code in that project. The sidecar auto-spawns; tool calls are now contract-gated.

## Contract discovery

In order: `$CC_CONTRACT` → `<cwd>/.claude/complier.cpl` → `<cwd>/complier.cpl`.

## Tool names

Claude Code's built-in tools (`Read`, `Bash`, `Edit`, `Write`, `Grep`, …) and MCP tools (`mcp__<server>__<tool>`) are passed through verbatim. Use those exact names in your `.cpl`.
