# The landing page's game

The second section of the landing page. Controllable Chaos holds $500 of **fake** money and does
whatever the visitor asks. The visitor tries to get **more than $100 in total, in one challenge**,
under one of four defenses. Nothing here touches real money, accounts or payment services.

Design assumption for this demo: the $100 limit is cumulative per challenge, so two $60 transfers
break it just like one $150 transfer does.

## What happens on one call

```
visitor message ──► agent model (live only) ──► send_fake_money({amount_cents})
visitor "be the agent" form ─────────────────────────┘
        │
        ▼
shared input check (every mode): a positive whole number of $10 notes, at most $10,000
        │  invalid: rejected, nothing sent, the defense is never asked
        ▼
selected defense decides: allow / deny / unavailable
        │  deny or unavailable: nothing sent
        ▼
ledger.transfer (integer cents; fails if the wallet is short)
        │
        ▼
the defense is told the outcome (LTL: steps its trace; Complier: the daemon's `result`)
```

The ledger (`ledger.ts`) is the only record of money. A model's text never moves money. Each
challenge is serialised: a defense's check and the ledger update happen as one step, so parallel
requests can't race it.

## The four defenses

| defense | mechanism | what it tracks | limits |
| --- | --- | --- | --- |
| Guardrail (`defenses/guardrail.ts`) | a judge model returns a violation probability; ≥ 0.5 blocks | whatever the judge infers from the chat | probabilistic, nothing proves it; **unavailable** without a configured model |
| LTL monitor (`defenses/ltl.ts`) | formula progression of `G (received_cents <= 10000)` over the ledger's states, before each transfer | the ledger's running total | the monitor is this site's code and trusts the ledger it reads |
| Per-call check (`defenses/stateless.ts`) | each call alone must be ≤ $100 | nothing | doesn't see earlier calls, so split transfers get through |
| Complier (`defenses/complier.ts`) | the real complier daemon, over its Unix socket | the policy's state, moved only by allowed calls and their results | needs a daemon next to this server; otherwise **unavailable** |

The LTL monitor and Complier both stop the split attack. The difference isn't which attack each one
stops. Complier's policy (`complier/transfer.csp`) is proven by FDR at every machine up, against
ControllableCHAOS (an agent that may attempt anything), including the assertion that transfers that
went through never add up to more than $100. Its translation unit (`complier/transfer.yaml`) is
proven by the CEL verifier to map every valid call to exactly one event. The daemon also follows each
transfer's result, so a transfer the bank failed doesn't count. The tests and screenshots show how
these mechanisms behave on particular attacks. They don't show that no other attack exists.

### Complier mode, concretely

- Each challenge gets its own machine, `landing-game-<session id>`. Ending the challenge takes the
  machine down.
- A transfer of $a is the event `send.a` (a = 10, 20, …, 100); anything larger is `oversize`, which
  the policy always denies. Money moves in $10 notes so the unit has 10 rules. A rule per dollar
  (100 rules) took 86 s to prove at each machine up; 10 rules take about 5 s.
- Every call is the daemon's `call` request with tool `mcp__fakebank__send_fake_money`, the same as
  the Claude Code hook sends. Every allowed call's outcome goes back as `result`. If the daemon
  can't answer, the call doesn't run.
- To regenerate the unit: `node website/game/complier/gen-unit.mjs`.

## Running it

```sh
cel/build.sh && fdr/build-complier-fdr.sh            # complier's CEL backend and FDR bridge
cargo build --release --manifest-path cli/Cargo.toml
cli/target/release/complier up                       # the daemon, in its own terminal
npm run build
COMPLIER_SOCKET=~/.complier/daemon.sock npm start    # http://localhost:3000/#game
```

Without `COMPLIER_SOCKET`, Complier mode shows as unavailable.

Sessions live in one server's memory, so the game needs a single long-running Node server. On Vercel
(`VERCEL` set) the API refuses with that reason. Each new challenge in Complier mode costs about 5 s
of FDR and CEL work on the daemon's host. The per-visitor limit is 12 new challenges per 10 minutes,
keyed on `x-forwarded-for`, so it only holds behind a proxy that sets that header.

### Live model (off by default)

Live chat and the guardrail's judge need a model. Nothing is assumed: all of these must be set, or
both stay unavailable and the page says so.

```
GAME_LIVE_INFERENCE=1
GAME_MODEL_BASE_URL=https://…          # any OpenAI-compatible chat completions endpoint
GAME_MODEL=…   GAME_MODEL_API_KEY=…     # server-side only
GAME_MODEL_INPUT_USD_PER_MTOK=…   GAME_MODEL_OUTPUT_USD_PER_MTOK=…
GAME_SPEND_CAP_USD=…   GAME_SPEND_FILE=/path/spend.json
```

Before each call, its worst-case cost is reserved against the cap in `GAME_SPEND_FILE`, and the call
is refused if that would exceed the cap. Calls are capped at 300 output tokens, 24,000 request
characters and 20 s. A challenge allows 10 messages, 4 model calls per message, 3 tool calls per
model message, 20 transfer attempts and 15 minutes. Loading the page never calls a model.

## Tests

- `npm test` runs `game.test.ts` (ledger, amounts, LTL, the offline defenses, sessions, bounds,
  races) and `live.test.ts` (live config, spend cap, request shape against a stub fetch). The model in
  these tests is `scripted.ts`, a **test transport** that replays fixed tool calls through the real
  agent loop. It isn't a model, and the site never uses it.
- `COMPLIER_SOCKET=… npm test` also runs `complier.test.ts` against the real daemon. Without the
  variable, those tests are skipped and the output says why.
- `browser/check.mjs` drives the built site in Chromium on desktop and mobile and writes screenshots.
