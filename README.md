<p align="center">
  <img src=".github/controllable-chaos.png" width="200" alt="Controllable Chaos, complier's mascot: a purple axolotl with mint gills and tail, smiling calmly">
</p>

<h1 align="center">complier</h1>

<p align="center"><b>Give your agents rules, not just instructions.</b></p>

A prompt asks an agent to publish only after a review. complier makes it so. You write which tool
calls count as which steps (a **translation unit**, in CEL) and the order those steps may happen in
(a **contract**, in CSP). complier sits between the agent and its MCP tools, checks every call
before it reaches the service, and refuses the ones that are out of turn, telling the agent why.

Live demo and walkthrough: [complier.dev](https://www.complier.dev)

## How it works

```
  agent (Claude Code + the complier plugin)
    │  tool call, e.g. notion-update-page {page_id: "p1", command: "replace_content"}
    ▼
  complier proxy ──── translation unit (CEL rules) ────►  event: overwritten.p1
    │                                                        │
    │                                                        ▼
    │                                     daemon: is the event allowed by the contract (CSP) now?
    │                                        no  ──►  refused before anything is sent, with the reason
    ▼  yes
  MCP server (e.g. Notion), whose credentials stay inside complier
```

- **Translation units are proven before they load.** Google's CEL verifier (with Z3) checks that no
  call matches two rules and every call matches a rule or the fallback. A unit that isn't proven
  is refused. See [`cel/README.md`](cel/README.md).
- **Contracts are CSP processes**, run by the daemon as *machines*. An agent's call is an output
  event (`!e`); it goes through only if the machine can take it now, and then the machine moves on.
- **Nothing polls the world.** Agents' translated calls are the only outside events.

## Repository map

| path | what it is | entry point |
| --- | --- | --- |
| [`website/`](website) | The Next.js site: landing page with the in-browser CEL + CSP demo, the CSP stepper, the research deck | `npm run dev` (from the root) |
| [`cli/`](cli) | The Rust `complier` CLI: MCP proxy, daemon, Claude Code hooks, unit checker | `cargo build --manifest-path cli/Cargo.toml` |
| [`cel/`](cel) | CEL backend the CLI runs: cel-java 0.14.0 + verifier behind a small stdio bridge | `cel/build.sh` |
| [`plugin/`](plugin) | Claude Code plugin that routes an agent's tools through `complier proxy` | `claude --plugin-dir plugin` |
| [`packages/`](packages) | Reviewed metadata for each MCP server (`complier gen` writes here) | `packages/notion/service.yaml` |
| [`examples/`](examples) | A translation unit for Notion and a small runnable demo machine | `examples/units/notion.yaml`, `examples/demo/` |

## Quickstart

### Website

Needs Node.js 20.9+.

```sh
npm ci
npm run dev          # http://localhost:3000
npm run build        # production build (what Vercel runs)
npm run typecheck
```

The landing demo runs entirely in the browser. The `/progress` deck's live agent demos also need
`DEMO_PASSWORD` and `OPENAI_API_KEY` in the environment.

### CEL backend

Needs a JDK 11+ and curl. Downloads pinned jars (sha256-checked) and builds the bridge:

```sh
cel/build.sh         # ends with: cel/build.sh: wrote .../cel/build/backend.json
```

### CLI

Needs Rust (edition 2024) and the CEL backend above. macOS or Linux.

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
complier machine act demo --role writer draft    # allowed
complier machine act demo --role writer draft    # Error: the spec doesn't allow draft now
complier machine log demo
complier machine down demo
```

To put a real agent on it, register the server and start Claude Code with the plugin:

```sh
complier add notion --url https://mcp.notion.com/mcp
COMPLIER_MACHINE=demo COMPLIER_ROLE=writer claude --plugin-dir plugin
```

Tests: `cargo test --manifest-path cli/Cargo.toml` (they run the real CEL backend, so build it first).

## What works today

- MCP proxy for HTTP (OAuth) and stdio servers, with credentials in the OS keychain.
- YAML translation units with CEL rules, proven disjoint and exhaustive at load time; calls outside
  the unit's domain, ambiguous calls and rule errors are refused.
- CSP contracts with prefix, choice, named processes and parallel composition, monitored per call;
  the agent gets the reason when a call is refused.
- Claude Code integration through the plugin's hooks (session context, tool gating, waiting on Stop).
- Contracts can't yet wait on events from the world (`?e` inputs are refused at `machine up`).

## Licence

MIT, see [`LICENSE`](LICENSE). The website ships third-party builds of cel-java (Apache-2.0) and
Z3 (MIT) under `website/public/cel/`, with provenance and checksums in
[`website/app/_landing/cel/README.md`](website/app/_landing/cel/README.md); CheerpJ is loaded from
its CDN under its own licence. `cel/build.sh` downloads cel-java, Z3 and their dependencies from
Maven Central under their own licences.
