# AGENTS.md

## Purpose

`complier` is a Python package for enforcing contracts over tool-using AI agents.

The core idea is simple:

- Developers already have agents running in existing frameworks.
- They should not need to replace those frameworks.
- They should be able to declare the process the agent is supposed to follow.
- `complier` should sit at the tool boundary and enforce that process.

When an agent attempts a tool call:

- if the call complies with the active contract, the tool runs
- if the call does not comply, the tool call is blocked
- the agent receives a structured remediation message explaining what happened and what it can do next

The product value is not "tool ordering" in isolation. The product value is:

- make your agent comply with the intended process

## What This Repo Is Building

This repo is building the first version of that enforcement layer as a proper Python package.

The current intended architecture is:

- `Contract`: the compiled runtime representation of the authored spec
- `Session`: one live execution against a contract
- `FunctionWrapper`: wraps Python callables so they are enforced through a session
- `MCPWrapper`: wraps MCP tool boundaries so they are enforced through a session

There may be many workflows inside a single contract, so the primary top-level concept is `Contract`, not `Workflow`.

The authored source format is not the long-lived object in the system. The authored spec is parsed and compiled early, and the runtime operates on the compiled contract.

## Product Direction

This project should be treated like a real product, not a temporary prototype.

Important product assumptions:

- `complier` should work with existing agent frameworks rather than replacing them
- the Python package experience matters a lot
- the enforcement layer should feel general, not like a tiny niche feature
- the key abstraction is agent compliance with an intended process
- the system should govern what agents do, not just what they say

The package should be designed so that developers can adopt it with low friction and understand the value quickly.

## Current Repo Shape

The repo has four top-level concerns:

1. **complier** — the state machine (pip-installable as `complier`).
2. **integration** — tool-side wrappers for the harness-integration path. Lives at `src/complier/integration/` (function wrappers in core; MCP behind the optional `[mcp]` extra).
3. **daemon** — multi-session sidecar process. Lives at `daemon/`. Not pip-installable; run via `python -m daemon serve`. The desktop app will own its lifecycle.
4. **extensions** — per-harness adapters that talk to the daemon. Live at `extensions/<name>/`. Not pip-installable. Each is a thin script keyed by `<extension>:<session_id>` against the daemon.

Layout inside the pip-installable library:

- `src/complier/contract/`: contract parsing, compilation, validation, and runtime model
- `src/complier/session/`: live execution state and compliance decisions
- `src/complier/integration/`: function and MCP integrations (tool-side wrappers)
- `src/complier/runtime/`: runtime support types such as events and remediation messages
- `src/complier/errors/`: package-specific exceptions
- `src/complier/verification.py`: abstract `Verifier` base for check resolution

## Contract Syntax

The contract language is a DSL for declaring the process an agent is supposed to comply with.

At the top level, a contract contains:

- guarantees
- workflows

### Guarantees

Guarantees define reusable checks that can be referenced by workflows.

Example:

```text
guarantee safe [no_harmful_content]:halt
```

The current syntax supports checks such as:

- `[check]` for model-style checks
- `{check}` for human checks

Checks may also include failure policies such as:

- `:halt`
- `:skip`
- `:3` for retries

Checks can be composed with boolean logic:

- `&&`
- `||`
- `!`

### Workflows

A contract may define many workflows.

Example:

```text
workflow "research" @always safe
    | @human "What topic?"
    | search_web
    | @llm "Summarize" ([relevant]:3 && [concise]:halt)
```

A workflow consists of:

- a name
- zero or more `@always` guarantees
- zero or more `@ambient` tool allowances
- a series of pipe-prefixed steps

### Ambient tools

`@ambient` declares tools the agent is allowed to call at any position in the workflow without advancing the graph. Useful for meta-tools that harnesses use as substrate (Claude Code's `ToolSearch`, `LS`, `Skill`; deferred-tool loaders; etc.). Example:

```text
workflow "fix-bug" @ambient ToolSearch LS
    | Read
    | Grep
    | Edit
    | Bash
```

Ambient calls are allowed regardless of current position, do not change `active_step`, and do not satisfy any procedural step. Guards on the workflow's procedural nodes do not run for ambient calls. Multiple tools can be listed after a single `@ambient`, and `@ambient` clauses may be repeated.

### Step Types

The DSL currently includes these major step forms:

- tool calls such as `search_web`
- tool calls with parameters such as `email to="user"`
- `@llm "Prompt"`
- `@human "Prompt"`
- `@call workflow_name`
- `@use workflow_name`
- `@inline workflow_name`
- `@branch`
- `@loop`
- `@unordered`
- `@fork id @call workflow_name`
- `@join id`

### Branches

Branches allow a workflow to choose between different paths.

Example:

```text
| @branch
    -when "technical"
        | @llm "Write detailed analysis"
    -when "general"
        | @llm "Write brief summary"
    -else
        | @llm "Write overview"
-end
```

### Loops

Loops repeat until a condition is satisfied.

Example:

```text
| @loop
    | @human "Is this good enough?"
    -until "yes"
-end
```

### Unordered Blocks

Unordered blocks represent a set of steps whose internal order does not matter.

Example:

```text
| @unordered
    -step format_citations
    -step generate_bibliography
-end
```

### Fork and Join

Fork and join allow parallel sub-work to be declared explicitly.

Example:

```text
| @fork refs @call check_references
| @fork refs @call verify_sources
| @join refs
```

### Parameters

Tool calls may include named parameters with three constraint forms:

1. **Literal** — exact-equality match.

   ```text
   draft_post channel="blog" audience="developers"
   ```

2. **Prose with checks** — fuzzy semantic constraint evaluated by a model/human verifier. Use when the check is genuinely semantic (`[safe]`, `[concise]`, `{approved}`).

   ```text
   summarize style='must be [concise] and [relevant]'
   ```

3. **CEL expression** — deterministic boolean predicate over the call's kwargs. Use for mechanical checks (string prefix, regex, set membership). Built in; no API key. Backtick-delimited:

   ```text
   Bash command=`command.startsWith("grep ")`
   Read file_path=`file_path.matches("^src/.*\\.py$")`
   send_email to=`to in ["team@x.com", "ops@x.com"]`
   ```

   CEL expressions see all sibling kwargs as variables; reference any kwarg by name. Standard CEL ops: `startsWith`, `endsWith`, `matches` (regex), `size`, `in`, `&&`, `||`, `!`. The expression text appears in the next-actions hint so the agent can self-correct without a verifier round-trip.

   Prefer CEL over prose for anything mechanical. Reserve prose-with-checks for truly fuzzy semantic predicates.

### Runtime Meaning

The contract is not meant to replace an agent framework.

Instead:

1. the authored contract is parsed and compiled into a runtime contract object
2. a session tracks where the agent is within that contract
3. wrapped tools consult the session before executing
4. compliant calls proceed
5. non-compliant calls are blocked and the agent receives structured remediation

This means the DSL defines intended process, while the Python runtime enforces compliance at execution time.

## Working Style

Keep the codebase disciplined and easy to maintain.

Preferences:

- no function should exceed 200 lines
- no file should exceed 800 lines
- avoid arrowheads in documentation, comments, diagrams, and similar developer-facing material

If a function is trending too large, split it.

If a file is trending too large, break it into focused modules.

If you need to explain flow, prefer plain language, numbered steps, or short bullets rather than arrow notation.

## Implementation Guidance

- Keep runtime enforcement logic separate from integration wrappers as much as possible
- integration wrappers should stay thin and delegate decision-making to session-level logic
- preserve a clear boundary between authored source, compiled contract, and runtime execution
- do not reintroduce the old Rust prototype as the main implementation path
- prefer simple, explicit Python APIs over clever abstractions

## Non-Goals For Now

- do not build a full replacement agent runtime
- do not over-rotate into a DSL-first experience at the expense of Python usability
- do not optimize for theoretical generality before the core package ergonomics are strong

## Notes For Future Agents

- treat the current stubs as intentional scaffolding
- preserve the names `Contract`, `Session`, `FunctionWrapper`, and `MCPWrapper` unless there is a strong reason to change them
- if packaging or structure changes are needed, keep the repo as a proper Python package
- when in doubt, optimize for clarity, adoption, and maintainability
