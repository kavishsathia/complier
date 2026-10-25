# Tool-call hooks across agent harnesses

Complier can support a broad range of agents through a family of small adapters. Each adapter asks Complier whether a tool call is allowed **before the harness executes it**. The harness retains its own service connections and authentication.

```text
agent attempts tool call
  → harness pre-tool hook
  → Complier: translate arguments with CEL, check the CSP contract
  → allow: harness executes its original tool call
    refuse: return feedback and permitted actions; preserve contract state
```

## Where to start

| Integration route | Harnesses |
| --- | --- |
| Native pre-tool decision hooks | Claude Code, Codex CLI, Gemini CLI, Copilot CLI, VS Code agent, Cursor agent, Goose, Kiro |
| Separate hooks for particular tool classes | Windsurf/Cascade |
| Plugin or extension callbacks | OpenCode, Pi, Hermes |
| Native hooks with editor/CLI differences | Cline |
| Application-owned SDK middleware | OpenHands SDK, OpenAI Agents SDK, LangGraph, AutoGen, Google ADK |
| Dispatch/version questions to resolve | Continue CLI, Cursor CLI |
| No general native pre-tool gate identified | Roo Code, Continue IDE, Aider, legacy Amazon Q context hooks |

The [coverage matrix](coverage-matrix.md) gives the exact mechanism and source for each surface. Editor, CLI and cloud versions can have different capabilities.

## Adapter design

- **One Complier protocol, several hook formats.** Harnesses use different input fields, response schemas and exit codes. Translate these at the adapter boundary.
- **Handle outages explicitly.** A refusal response and a hook crash are different paths. Configure blocking on failure where the harness supports it.
- **Keep contract decisions atomic.** Parallel calls and child agents sharing a contract need one authoritative state, not separate copies.
- **Define the event boundary.** If a contract describes successful execution, correlate pre-tool authorization with completion or failure. Authorization alone is not successful execution.
- **Give cloud agents a reachable endpoint.** Their hooks cannot reach a daemon running on a developer's laptop through `localhost`.

## Research documents

1. [Coverage matrix](coverage-matrix.md): mechanisms, supported surfaces and priority.
2. [Harness dossiers](harness-dossiers.md): configuration, schemas, denial and lifecycle behavior.
3. [Portable adapter protocol](portable-protocol.md): proposed common interface to Complier.
4. [Acceptance test plan](acceptance-test-plan.md): practical checks before adopting an adapter.
5. [Sources](sources.md): primary documentation and source references.
6. [Verification notes](verification-notes.md): source-level findings and questions for local tests.

Research date: 25 October 2026. Next step: exercise each adapter against a tool with a visible side effect, then test denial, timeout, daemon outage, parallel calls and session resumption.
