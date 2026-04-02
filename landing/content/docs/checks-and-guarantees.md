# Checks And Guarantees

Checks are the main way to express conditions that a step or param should satisfy.

## Check Forms

Current syntax supports three check kinds:

- `[check]` for model-style checks
- `{check}` for human checks
- `#{check}` for learned checks backed by memory

```cpl
guarantee safe [no_harmful_content]:halt
guarantee approved {approved_for_release}:halt
guarantee house_style #{polite}:3
```

## Boolean Logic

Checks can be combined with boolean operators:

- `&&`
- `||`
- `!`

```cpl
guarantee quality ([relevant] && [concise]):halt
guarantee release_gate ({approved_for_release} && ![unsafe]):halt
```

## Policies

A contract expression can include a failure policy after `:`.

Supported policies are:

- `halt`
- `skip`
- a retry count like `:3`

```cpl
guarantee safe [no_harmful_content]:halt
guarantee optional_check [nice_to_have]:skip
guarantee retryable [relevant]:3
```

If you do not write a policy, the AST defaults to a retry policy with `3` attempts.

## Using Guarantees In Workflows

You can attach guarantees to every executable step in a workflow with `@always`.

```cpl
guarantee safe [no_harmful_content]:halt

workflow "research" @always safe
    | search_web
    | summarize
```

You can also reuse a guarantee inside another expression.

```cpl
guarantee safe [no_harmful_content]:halt

workflow "review"
    | approve gate=(safe && [relevant]):2
```
