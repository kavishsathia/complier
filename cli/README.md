# complier CLI

Makes Claude Code follow a CSP contract. A hook asks a per-user daemon before
every tool call, and the daemon refuses any tool the contract does not offer
in its current state.

## Install (macOS)

```sh
curl -fsSL https://complier.dev/install | sh
```

## Use

```sh
cd your-repo
complier init     # hooks, a demo contract, and the background daemon
complier status   # each session's state and trace
complier reset    # start this repo's sessions over
complier check .claude/complier/contract.csp
complier uninstall
```

`init` writes:

- `.claude/settings.local.json`: `PreToolUse` and `PostToolUse` hooks that run `complier hook`
- `.claude/complier/contract.csp`: the demo contract, unless one exists
- `~/Library/LaunchAgents/dev.complier.daemon.plist`: keeps the daemon running

## Contracts

Events are Claude Code tool names. Only tools that appear in the contract are
constrained; the rest run as usual.

```
-- comments start with two dashes
MAIN = Explore                       -- MAIN is the start, else the first process
Explore = Read -> Informed           -- prefix: event -> process
       [] Grep -> Explore            -- external choice
Informed = Edit -> Informed |~| STOP -- internal choice, STOP, SKIP
```

`PreToolUse` checks that the tool is offered. `PostToolUse` advances the
contract once the tool has run, so a call that is denied or cancelled leaves
the state unchanged. If the daemon cannot be reached, tools the contract names
are denied.
