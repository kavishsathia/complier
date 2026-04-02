# Docs

`complier` turns an authored `.cpl` contract into a runtime graph that can govern what an agent is allowed to do next.

This docs workspace is grounded in the syntax that the current parser and compiler actually support:

- guarantees
- workflows
- tool steps with named params
- `@llm` and `@human` steps
- `@call`, `@use`, and `@inline`
- `@branch`, `@loop`, and `@unordered`
- `@fork` and `@join`

Start here:

- [Core Syntax](doc:core-syntax)
- [Checks And Guarantees](doc:checks-and-guarantees)
- [Control Flow](doc:control-flow)
- [Runtime And Wrappers](doc:runtime-and-wrappers)

## What A Contract Does

At a high level:

1. authored `.cpl` source is parsed
2. the source becomes an AST
3. the AST is compiled into a runtime workflow graph
4. a session uses that graph to decide whether tool calls can proceed

## Minimal Example

```cpl
guarantee safe [no_harmful_content]:halt

workflow "research" @always safe
    | @human "What topic?"
    | search_web query="agent compliance"
    | summarize style="brief"
```

That example uses a reusable guarantee, a named workflow, a human step, and two tool calls.
