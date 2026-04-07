# MESS.md

Everything added in this session. Some of it is clean, some of it is not.

## What was built

### 1. MCP Server OAuth Authentication (Studio)

**Problem:** Remote MCP servers like Notion require OAuth. Studio had no way to authenticate.

**What was done:**
- `studio/backend/token_store.py` — File-based token storage at `~/.complier-studio/tokens/`. Implements the MCP SDK's `TokenStorage` protocol.
- `studio/backend/oauth_callback.py` — Local HTTP server on port 9973 that catches OAuth redirect callbacks.
- `studio/backend/oauth_flow.py` — Wires together `OAuthClientProvider` (from the MCP SDK), the callback server, and `webbrowser.open()`. Handles the full OAuth 2.1 + PKCE flow transparently.
- `studio/backend/api.py` — `test_mcp_server` now uses the OAuth flow for remote servers. Added `clear_mcp_tokens` endpoint. `delete_mcp_server` also clears tokens.

**How it works:** When Studio connects to a remote MCP server that returns 401, the MCP SDK's `OAuthClientProvider` (an `httpx.Auth` subclass) automatically discovers the auth server, opens the browser, catches the callback, exchanges for tokens, and retries. Studio stores the tokens and reuses them on subsequent connections.

**Known mess:**
- The callback server uses a fixed port (9973). If something else is on that port, it breaks.
- `test_remote_with_oauth` swallows TaskGroup cleanup errors if tools were successfully fetched. This hides real errors sometimes.
- The `anyio.from_thread.run` / `anyio.run` fallback pattern in `api.py` is ugly but necessary because pywebview calls Python methods from a non-async thread.

### 2. Auth Token Passthrough to Wrapper Proxy (Complier core)

**Problem:** The remote HTTP proxy (`remote_http_proxy.py`) connects to downstream MCP servers but had no way to get auth tokens. It relied on the Agents SDK forwarding `Authorization` headers, which doesn't work.

**What was done:**
- `src/complier/wrappers/remote_mcp.py` — `wrap_remote_mcp` now accepts `auth_token` parameter. Passes it to the proxy via the `/setup` endpoint.
- `src/complier/wrappers/remote_http_proxy.py` — `/setup` endpoint accepts `auth_token`. Proxy stores it per namespace in `registry.auth_tokens`. `_resolve_auth` prefers stored token over request header. Added `_unwrap` for better error messages from ExceptionGroups. `list_tools` and `call_tool` now catch exceptions and return proper `McpError` with unwrapped messages instead of crashing.

### 3. Tool Schema Caching (Studio)

**Problem:** MCP tool info (name, description, inputSchema) wasn't persisted. Every time Settings opened, it re-probed all servers.

**What was done:**
- `MCPServerConfig` now has `tools?: MCPToolInfo[]` and `authenticated?: boolean`.
- `MCPToolInfo` type added: `{ name, description?, inputSchema? }`.
- Settings shows cached tools immediately. Refresh button re-probes and saves.
- Backend returns full tool info (name, description, inputSchema) instead of just names.

**Known mess:**
- Old saved configs have tools as `string[]` instead of `MCPToolInfo[]`. Multiple places have `typeof t === "string"` guards to handle this. Should have done a one-time migration instead.

### 4. Settings Page (Studio)

**Problem:** Settings was a modal that got cramped with many tools.

**What was done:**
- Converted from overlay modal to full-screen page with back button.
- Settings replaces the main editor area (sidebar stays visible).
- Removed old overlay/dialog CSS (kept for potential reuse).

### 5. Tool Popover (Studio)

**Problem:** Clicking a tool node opened a sidebar with just a text input. No way to select from available MCP tools or configure param checks.

**What was done:**
- `studio/frontend/src/components/ToolPopover.tsx` — Popover at click position with custom dropdown grouped by server, param list from inputSchema, and text input per param for check expressions.
- `studio/frontend/src/components/ToolDropdown.tsx` — Custom dropdown with search, grouped by server. Uses `position: fixed` to avoid clipping.
- `ConfigPanel.tsx` — Removed tool step case (handled by popover).
- `Canvas.tsx` — Passes click coordinates from node click.
- `App.tsx` — Renders ToolPopover for tool steps, ConfigPanel for others.

**Known mess:**
- The popover's click-outside handler uses `setTimeout(0)` to avoid catching the originating click. Hacky.
- Multiple places normalize old string tools to `MCPToolInfo` objects with `typeof` guards.

### 6. Tool Namespace in CPL (Studio)

**Problem:** Tool names in CPL had no server namespace prefix.

**What was done:**
- `graph-to-cpl.ts` — `graphToCpl` now accepts `MCPServerConfig[]`, builds a tool-to-namespace map, and outputs `notion.notion-search` in CPL.
- `cpl-ast-to-steps.ts` — Strips namespace prefix when parsing CPL back to steps (`notion.notion-search` becomes `notion-search` in the graph).

### 7. CPL AST Serialization Fix (Studio)

**Problem:** Python parser returns param check expressions as nested AST objects. Frontend got `[object Object]` when converting back to graph.

**What was done:**
- `studio/backend/api.py` — `parse_cpl` encoder now includes `_type` field on dataclasses.
- `studio/frontend/src/lib/cpl-ast-to-steps.ts` — `exprToString` reconstructs check expression strings from typed AST objects (`ModelCheck`, `HumanCheck`, `LearnedCheck`, `RetryPolicy`, `HaltPolicy`, `SkipPolicy`, `AndExpression`, `OrExpression`, `ContractExpressionWithPolicy`).

### 8. Next Actions on Allowed Calls (Complier core)

**Problem:** The session only returned next allowed actions when a tool was blocked. The agent had no guidance on what to do next after a successful call.

**What was done:**
- `src/complier/session/session.py` — `check_tool_call` now returns `Remediation` with `allowed_next_actions` on allowed decisions too. `_next_actions_after_node` includes branch condition labels and choice hints (e.g. `notion-create-pages (when: there is programming related stuff, pass choice="there is programming related stuff")`).
- `src/complier/wrappers/local_stdio_proxy.py` — Appends "Next allowed actions: ..." to tool results.
- `src/complier/wrappers/remote_http_proxy.py` — Same.
- `src/complier/wrappers/function.py` — Same for function-wrapped tools (string results only).

### 9. Workflow Runner + Logs Panel (Studio)

**Problem:** Studio could design and validate workflows but not execute them.

**What was done:**
- `studio/backend/runner.py` — `WorkflowRunner` class. Creates contract session, wraps MCP servers, creates Agents SDK agent, runs `Runner.run()` in background thread. Reads `session.state.history` for logs. Loads OAuth tokens for remote servers.
- `studio/backend/api.py` — `run_workflow`, `get_run_logs`, `stop_run` API methods.
- `studio/frontend/src/components/LogsPanel.tsx` — Right sidebar with prompt input, Start/Stop buttons, live log display polled every 500ms. Entries color-coded by type (allowed/blocked/result).
- `studio/frontend/src/App.tsx` — Logs button in toolbar toggles panel. Run validates CPL then opens panel. Canvas and panel in flex row.

**Known mess:**
- Model is hardcoded to `gpt-5.4-mini` in `LogsPanel.tsx`. Should be configurable.
- `OPENAI_API_KEY` is loaded from `demo/.env` in the runner. Should be in Studio's own config.
- The runner loads dotenv on every run.
- Error handling uses `traceback.format_exception` dumped as the error string. Works but ugly.
- `_enter_all` is a hand-rolled async context manager for entering multiple MCP servers. Should probably use `contextlib.AsyncExitStack`.
- Only one run at a time (`self._active_runner` on the API class).

### 10. Misc Fixes

- `AGENTS.md` — Fixed check syntax from `[check:policy]` to `[check]:policy`.
- `studio/frontend/src/App.tsx` — `handleNew` only auto-saves if workflow has steps. New workflow name is just the timestamp, no "Untitled" prefix.
- `ToolStep.params` type changed from `Record<string, ParamConfig>` back to `Record<string, string>`. The `ParamConfig` experiment was reverted. `TagInput.tsx` was deleted.

## Files touched

### Complier core (src/complier/)
- `wrappers/remote_mcp.py` — `auth_token` param
- `wrappers/remote_http_proxy.py` — Token storage, `_resolve_auth`, `_unwrap`, error handling
- `wrappers/local_stdio_proxy.py` — Next actions hint on results
- `wrappers/function.py` — Next actions hint on results
- `session/session.py` — Next actions on allowed decisions, branch labels in hints

### Studio backend (studio/backend/)
- `api.py` — OAuth flow, run workflow, get logs, stop run, clear tokens
- `token_store.py` — New
- `oauth_callback.py` — New
- `oauth_flow.py` — New
- `runner.py` — New
- `mcp_store.py` — Unchanged

### Studio frontend (studio/frontend/src/)
- `App.tsx` — Logs panel, popover, settings page
- `types.ts` — MCPToolInfo, MCPServerConfig changes
- `lib/bridge.ts` — Run/logs/stop, clear tokens, tool info types
- `lib/graph-to-cpl.ts` — Namespace prefix, param output
- `lib/cpl-ast-to-steps.ts` — AST-to-string reconstruction, namespace stripping
- `components/Settings.tsx` — Full page, refresh, auth status, disconnect
- `components/LogsPanel.tsx` — New
- `components/ToolPopover.tsx` — New
- `components/ToolDropdown.tsx` — New
- `components/ConfigPanel.tsx` — Removed tool case
- `components/canvas/Canvas.tsx` — Click position passthrough
- `theme/dark.css` — Everything
