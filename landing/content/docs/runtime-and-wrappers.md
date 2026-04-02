# Runtime And Wrappers

The authored `.cpl` source is not the runtime object. It is parsed and compiled early into a runtime contract.

## Runtime Pipeline

The current package shape is:

- `Contract`
- `Memory`
- `Session`
- `FunctionWrapper`
- `MCPWrapper`

The intended runtime flow is:

1. load source into a `Contract`
2. create a `Session`
3. wrap tools at the function or MCP boundary
4. check tool calls against the compiled graph

## Python Example

```python
from complier import Contract, wrap_function

contract = Contract.from_file("workflow.cpl")
session = contract.create_session()

safe_search = wrap_function(session, search_web)
safe_summarize = wrap_function(session, summarize)
```

## Why The Graph Matters

The compiler turns a workflow into runtime nodes such as:

- `StartNode`
- `ToolNode`
- `HumanNode`
- `LLMNode`
- `BranchNode`
- `ForkNode`
- `JoinNode`
- `EndNode`

That graph gives the runtime a concrete structure for deciding what can happen next.

## Parameter Constraints

Tool params can be exact literals or contract expressions.

```cpl
workflow "publish"
    | publish_post channel="blog"

workflow "research"
    | search_web query=[relevant]:2
```

The first example requires an exact param value. The second example evaluates a declared check with a retry policy.

## Where To Go Next

Return to the permanent [Docs](doc:docs) tab whenever you want the overview, then open pages as needed in additional tabs.
