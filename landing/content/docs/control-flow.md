# Control Flow

The language supports several structured control-flow blocks beyond plain step sequences.

## Branches

`@branch` declares a set of conditional arms.

```cpl
workflow "research"
    | @branch
        -when "technical"
            | detailed_review
        -when "general"
            | overview
        -else
            | summary
```

Each `-when` arm contains its own nested steps. `-else` is optional.

## Loops

`@loop` repeats a block until a condition string is reached.

```cpl
workflow "review"
    | @loop
        | @human "Is this good enough?"
        -until "yes"
```

The compiler represents this with a loop branch and a back-edge.

## Unordered Blocks

`@unordered` declares labeled cases whose internal order does not matter.

```cpl
workflow "prepare"
    | @unordered
        -step "format"
            | format_notes
        -step "verify"
            | verify_sources
```

## Fork And Join

You can declare explicit parallel sub-work with `@fork` and `@join`.

```cpl
workflow "research"
    | @fork refs @call verify_sources
    | @fork refs @call check_citations
    | @join refs
```

## Reading The Graph

In the playground graph:

- branches fan into multiple labeled edges
- unordered cases show separate labeled paths
- joins and merge nodes bring paths back together
- loops render a return edge rather than a second linear lane
