# The landing page's game

The second section of the landing page. Controllable Chaos holds $500 of **fake** money and does
whatever the visitor asks. The visitor tries to get **more than $100 in total, in one challenge**,
under one of four defenses. Nothing here touches real money, accounts or payment services.

Design assumption for this demo: the $100 limit is cumulative per challenge, so two $60 transfers
break it just like one $150 transfer does.

## What happens on one call

```
visitor message ──► agent model ──► send_fake_money({amount_dollars})
                    (in-browser Qwen2.5-0.5B, or a configured provider)
visitor "be the agent" form ──────────┘
        │
        ▼
shared input check (every mode): a positive whole number of $10 notes, at most $10,000,
converted exactly to integer cents
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
| Guardrail (`defenses/guardrail.ts`) | a judge model returns a violation probability; ≥ 0.5 blocks | whatever the judge infers from the chat | probabilistic, nothing proves it; the judge runs on the server (a configured provider, else the local model); **unavailable** without either |
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

The tool takes whole dollars, not cents. The small local model copied "$150" as `amount_cents: 150`
even with worked examples in its prompt, but writes `amount_dollars: 150` correctly; the ledger still
keeps integer cents, and the Complier unit reads `amount_dollars`, so the daemon translates exactly
the call the model made.

### The local model (in the visitor's browser)

With `GAME_LOCAL_MODEL_DIR` set, the agent can be **Qwen2.5-0.5B-Instruct** (from
`onnx-community/Qwen2.5-0.5B-Instruct`, base model Apache-2.0), 4-bit (`onnx/model_q4.onnx`), run in a
Web Worker (`app/_landing/agent.worker.ts`) by transformers.js 4.3.2 on ONNX Runtime's WebAssembly
build, on the visitor's CPU. Nothing loads until the visitor presses "Load the model", which
downloads about 793 MB from this site (`api/game/local-model`, which serves only the listed model
files and the ORT runtime from `node_modules/onnxruntime-web`; no CDN, no provider). Generation is
greedy, at most 96 new tokens per step.

The model only produces text and tool calls. The page sends each step to the server
(`browser_step`), which runs the calls through the same input check, defense and ledger as any other
call, and returns the tool results to give back to the model. The server can't tell a real model's
output from anything else a browser sends, so it doesn't need to: the defense sits at the tool, as
it would for any agent (ControllableCHAOS). Rows from this path are labelled with the model, its
token counts and time.

The guardrail's judge must not run in the visitor's browser, which could skip it, so with no
provider configured it runs the same model on this server (`local.ts`, transformers.js on
onnxruntime-node, one generation at a time). That takes about 1.8 GB of server memory once loaded.

```
GAME_LOCAL_MODEL_DIR=/path/qwen2.5-0.5b-instruct-onnx   # config.json, generation_config.json,
                     # tokenizer.json, tokenizer_config.json, special_tokens_map.json, onnx/model_q4.onnx
```

The files come from `https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct` (revision
`22942cb7d7ba4cc81bb4673549ca4d4614469b5e`). Of its exports, `model_quantized.onnx` (int8) produced
incoherent text on CPU, and `model_q4.onnx` produced well-formed tool calls, so the game uses q4.
`.npmrc` skips onnxruntime-node's optional CUDA download.

The browser needs about 2 GB of free memory while the model loads. On a 3.9 GB server with no swap,
running it in headless Chromium next to the site ran out of memory, so the in-browser path hasn't
been run end to end; the same model, prompt, tools and loop have been run on CPU in Node
(`local.test.ts`).

### Live model (off by default)

Live chat with a hosted model, and a hosted judge, need a provider. Nothing is assumed: all of these must be set, or
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
- `GAME_LOCAL_MODEL_DIR=… COMPLIER_SOCKET=… npm test` also runs `local.test.ts`: the real local
  model on this machine's CPU, through the agent loop, every offline defense and the daemon, writing
  what the model did to `GAME_EVIDENCE_DIR` if set. It needs about 3 GB of memory.
- `browser/check.mjs` drives the built site in Chromium on desktop and mobile and writes screenshots.
