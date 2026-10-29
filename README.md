<p align="center">
  <img src=".github/controllable-chaos.png" width="200" alt="Controllable Chaos, complier's mascot: a purple axolotl with mint gills and tail, smiling calmly">
</p>


<h1 align="center">complier</h1>

<p align="center"><b>Give your agents rules, not just instructions.</b></p>

A prompt asks an agent to publish only after a review. complier makes it so. You write which tool
calls count as which steps (a **translation unit**, in CEL) and the order those steps may happen in
(a **contract**, in CSP). Your agent's harness asks complier before it runs each MCP tool call,
and complier refuses the ones that are out of turn, telling the agent why.

Live demo and walkthrough: [complier.dev](https://www.complier.dev)

## How it works

```
  agent (Claude Code + the complier plugin)
    │  tool call, e.g. mcp__notion__notion-update-page {page_id: "p1", command: "replace_content"}
    ▼
  pre-tool-use hook ──── asks the daemon ────►  translation unit (CEL rules) ──►  event: overwritten.p1
    │                                                                               │
    │                                              is the event allowed by the contract (CSP) now?
    │                                                 no  ──►  denied before it runs, with the reason
    ▼  yes
  the harness runs the call on its own MCP server (e.g. Notion), with its own sign-in
```

- **Translation units are proven before they load.** Google's CEL verifier (with Z3) checks that no
  call matches two rules and every call matches a rule or the fallback. A unit that isn't proven
  is refused. See [`cel/README.md`](cel/README.md).
- **Contracts are CSP policies, proven and compiled by FDR.** A spec defines `Role`, `Act` and a
  `Policy` over `attempt`, `allow` and `deny : Role.Act`, built from `Permit`, `Deny` and
  `PermitIf`. At `machine up`, FDR checks that the policy answers every attempt it takes, can't
  leave an agent waiting, is deterministic, and passes the spec's own assertions, then compiles it
  into an automaton. The daemon only walks that automaton; complier doesn't interpret CSP itself.
- **Allow, deny or refuse.** A call becomes `attempt.<role>.<action>`. If the policy offers it, the
  policy's own `allow` or `deny` edge is the verdict; if not, the call is refused and the policy
  stays where it was. Only allowed calls run.
- **Nothing polls the world.** Agents' translated calls are the only outside events.
- **Fails closed.** An MCP call the units don't cover, that can't be translated, or that can't be
  checked (no daemon, no machine) is denied. Built-in tools (Bash, Edit, ...) aren't translated
  yet; the hook only stops them editing the configuration that enforces all this.

## Repository map

| path | what it is | entry point |
| --- | --- | --- |
| [`website/`](website) | The Next.js site: landing page, the in-browser CEL + CSP playground, the CSP stepper, the research deck | `npm run dev` (from the root) |
| [`cli/`](cli) | The Rust `complier` CLI: daemon, Claude Code hooks, unit checker, MCP client for `gen` | `cargo build --manifest-path cli/Cargo.toml` |
| [`cel/`](cel) | CEL backend the CLI runs: cel-java 0.14.0 + verifier behind a small stdio bridge | `cel/build.sh` |
| [`plugin/`](plugin) | Claude Code plugin that installs complier's hooks | `claude --plugin-dir plugin` |
| [`packages/`](packages) | Reviewed metadata for each MCP server (`complier gen` writes here) | `packages/notion/service.yaml` |
| [`examples/`](examples) | A translation unit for Notion and a small runnable demo machine | `examples/units/notion.yaml`, `examples/demo/` |
| [`fdr/`](fdr) | `complier-fdr`, which has FDR prove a policy and compile its automaton (bring your own FDR), and an earlier standalone guard demo | `fdr/build-complier-fdr.sh` |

## Quickstart

### Website

Needs Node.js 20.9+.

```sh
npm ci
npm run dev          # http://localhost:3000
npm run build        # production build (what Vercel runs)
npm run typecheck
npm test             # the stepper's CSP tests; set FDR_HOME to also compare its traces with FDR's
```

The `/playground` runs entirely in the browser. The `/progress` deck's live agent demos also need
`DEMO_PASSWORD` and `OPENAI_API_KEY` in the environment.

The `/stepper` runs plain CSP and shows the rule behind every transition. Besides prefix, `[]`,
`|~|`, `;`, guards and `[| {..} |]`, it has:

- `P ||| Q`: interleaving. Each event is one side's, and the other side keeps its state.
- `prioritise(P, <{a, b}, {r}>)`: FDR's priority operator. `r` happens only when `P` can do no
  `a` or `b`; τ and ✓ rank with the first class, and events in no class are never held back.
- `ControllableCHAOS({a, b}, {r})`: a builtin model of any agent, as in [`fdr/`](fdr):
  `(STOP |~| (|~| x:A @ x -> ControllableCHAOS(A, R))) [] ([] r:R @ r -> ControllableCHAOS(A, R))`.
  It may try any event of A or none, and always offers R. Its default example is the refusal
  guard: `prioritise(ControllableCHAOS(A, R) [| union(A, R) |] (Policy ||| RefusalLoop), <A, R>)`.

### CEL backend

Needs a JDK 11+ and curl. Downloads pinned jars (sha256-checked) and builds the bridge:

```sh
cel/build.sh         # ends with: cel/build.sh: wrote .../cel/build/backend.json
```

### CLI

Needs Rust (edition 2024), the CEL backend above and FDR. macOS or Linux.

**FDR is not included.** complier uses your own copy: download FDR 4 from
[cocotec.io/fdr](https://cocotec.io/fdr/) and run it once to get its licence. The licence is free
for academic work and personal research; other use needs a commercial licence from its makers (see
[their licensing terms](https://cocotec.io/fdr/licensing.html)). Then build the bridge to it:

```sh
fdr/build-complier-fdr.sh             # macOS: FDR from /Applications/FDR4.app; Linux: see fdr/README.md
```

```sh
cargo install --path cli --locked     # installs `complier` into ~/.cargo/bin
complier check examples/units/notion.yaml
# ... admitted: every pair of rules is disjoint and the rules with the fallback cover the domain
complier translate examples/units/notion.yaml notion-update-page '{"page_id": "p1", "command": "replace_content"}'
# notion-update-page -> overwritten.p1
```

Run the demo machine (the writer must draft, then recreate, in turn):

```sh
complier up                           # the daemon, in its own terminal
complier machine up demo --spec examples/demo/draft.csp --unit examples/demo/draft.yaml
complier machine act demo --role writer draft    # draft allowed; the policy is now at state 3
complier machine act demo --role writer draft    # Error: draft refused: the policy doesn't take draft from writer now
complier machine act demo --role writer other    # Error: other denied: the policy denied other
complier machine log demo
complier machine down demo
```

To put a real agent on it, give Claude Code the Notion MCP server under the name the unit's
service uses (`notion`), and start it with the plugin:

```sh
claude mcp add --transport http notion https://mcp.notion.com/mcp
COMPLIER_MACHINE=demo COMPLIER_ROLE=writer claude --plugin-dir plugin
```

`complier add` and `complier gen` are only needed to (re)generate a service's `tools.yaml`.

Tests: `cargo test --manifest-path cli/Cargo.toml` (they run the real CEL backend, so build it first).

## What works today

- Enforcement in Claude Code's pre-tool-use hook: every MCP call is translated and checked by the
  daemon before it runs, and fails closed.
- YAML translation units with CEL rules, proven disjoint and exhaustive at load time; calls outside
  the unit's domain, ambiguous calls and rule errors are refused.
- Policies in CSPm with the full language FDR accepts, proven and compiled by FDR at `machine up`;
  every call is allowed, denied or refused, and the agent gets the reason.
- The plugin's other hooks: session context, and holding an idle agent's Stop until it can act.
- Only agents' actions (controllable events) for now: nothing observes the world.

## Licence

MIT, see [`LICENSE`](LICENSE). The website ships third-party builds of cel-java (Apache-2.0) and
Z3 (MIT) under `website/public/cel/`, with provenance and checksums in
[`website/app/_landing/cel/README.md`](website/app/_landing/cel/README.md); CheerpJ is loaded from
its CDN under its own licence. `cel/build.sh` downloads cel-java, Z3 and their dependencies from
Maven Central under their own licences.
