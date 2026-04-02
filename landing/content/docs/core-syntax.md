# Core Syntax

The top-level authored format contains `guarantee` declarations and `workflow` declarations.

## Guarantees

A guarantee gives a reusable name to a contract expression.

```cpl
guarantee safe [no_harmful_content]:halt
guarantee concise [concise]:3
```

## Workflows

A workflow has a name, optional `@always` guarantees, and a sequence of pipe-prefixed steps.

```cpl
workflow "research" @always safe
    | search_web query="agent compliance"
    | summarize style="brief"
```

## Tool Steps

Plain identifiers are treated as tool calls.

```cpl
workflow "publish"
    | draft_post
    | publish_post channel="blog"
```

Named params use `name=value`.

Supported literal values in the current parser are:

- strings
- integers
- `true`
- `false`
- `null`
- contract expressions with policies

## Non-Tool Steps

The DSL also supports explicit LLM and human steps.

```cpl
workflow "research"
    | @human "What topic?"
    | @llm "Classify the request"
    | search_web
```

## Workflow Reuse

The parser supports three workflow reference forms:

```cpl
workflow "main"
    | @call gather_sources
    | @use approval_flow
    | @inline cleanup_steps
```

Use the next pages for checks, branching, loops, and runtime behavior.
