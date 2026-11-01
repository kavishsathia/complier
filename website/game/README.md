# The landing page's game

The second section of the landing page. Controllable Chaos holds $500 of **fake** money and does
whatever the visitor asks. The visitor tries to get **more than $100 in total, in one challenge**,
under one of four defenses. Nothing here touches real money, accounts or payment services.

The $100 limit is cumulative per challenge, so two $60 transfers break it just like one $150
transfer does.

## Where it runs

Entirely in the visitor's browser. The site deploys as it is (Vercel) with no API routes, servers,
databases, daemons or model providers for the game:

- The challenge (ledger, conversation, event log, the chosen defense and its state) is one JSON
  object (`session.ts`), saved to `localStorage` after every change (`storage.ts`), so a reload
  carries on where it was. It is checked field by field when read back; an unreadable, old or
  inconsistent save is removed and a new challenge starts. It is the visitor's own demo state:
  checked, not protected from them.
- The agent is **Qwen2.5-0.5B-Instruct**, 4-bit (`onnx/model_q4.onnx` from
  `onnx-community/Qwen2.5-0.5B-Instruct` at revision `22942cb7d7ba4cc81bb4673549ca4d4614469b5e`;
  base model Apache-2.0), run in a Web Worker (`app/_landing/agent.worker.ts`) by transformers.js
  4.3.2 on ONNX Runtime's WebAssembly build, on the visitor's CPU. Nothing loads until the visitor
  presses "Load the model". transformers.js then downloads about 793 MB from the Hugging Face hub at
  that pinned revision, and its WebAssembly runtime from jsDelivr at the version it bundles; the
  browser's Cache API keeps them for the next visit. It needs about 2 GB of free memory, and the
  page warns when the device reports less than 4 GB.

## What happens on one call

```
visitor message ──► the small model (in the browser) ──► send_fake_money({amount_dollars})
                                                          │
        ▼
shared input check (every mode): a positive whole number of dollars, at most $10,000,
converted exactly to integer cents; anything else is rejected and nothing is sent
        │
        ▼
selected defense decides, before anything moves: allow / deny / unavailable
        │  deny or unavailable: nothing sent
        ▼
ledger.transfer (integer cents; fails if the wallet is short)
        │
        ▼
the defense is told the outcome; the challenge is saved
```

The ledger (`ledger.ts`) is the only record of money. A model's text never moves money: only an
allowed `send_fake_money` call does. A challenge runs one action at a time (`Session.exclusive`, and
the page ignores clicks while one runs), so a defense's check and the ledger update are one step and
fast clicks can't race the allowance. Switching defense or pressing "New challenge" ends the
challenge (anything still running on it stops) and the next one starts from $0.

The tool takes whole dollars: the small model copied "$150" as `amount_cents: 150` even with worked
examples in its prompt, but writes `amount_dollars: 150` correctly.

## The four defenses

| defense | mechanism | what it tracks | limits |
| --- | --- | --- | --- |
| Guardrail (`defenses/guardrail.ts`) | a judge model returns a violation probability; ≥ 0.5 blocks | whatever the judge infers from the chat | probabilistic, nothing proves it; the judge is the same small model, so it is **unavailable** until the model is loaded |
| LTL monitor (`defenses/ltl.ts`) | formula progression of `G (received_cents <= 10000)` over the ledger's states, before each transfer | the ledger's running total | trusts the ledger it reads |
| Per-call check (`defenses/stateless.ts`) | each call alone must be ≤ $100 | nothing | doesn't see earlier calls, so split transfers get through |
| Complier (`defenses/cap.ts`) | a running total of what was sent; a transfer that would take it over $100 is refused before it runs | its own total, which only transfers that went through add to | an illustration of complier's effect, not the complier runtime |

**The Complier mode is illustrative.** It is plain arithmetic in the page, showing the effect
complier has on this agent: a stateful limit checked before each call runs, which counts what
actually happened. It does not run complier's verified runtime. The complier CLI enforces this kind
of rule as a CSP contract that FDR proves against any agent (ControllableCHAOS) before anything runs,
in the agent's harness.

The LTL monitor and the Complier mode both stop the split attack; the per-call check doesn't, and
the guardrail depends on its judge. These are the mechanisms' behaviour on particular attacks, not a
proof that no other attack exists.

## Tests

- `npm test` runs `game.test.ts`: amounts, the ledger, LTL, each defense, the agent loop with
  `scripted.ts` (a **test transport** that replays fixed tool calls; it isn't a model, and the site
  never uses it), races, bounds, and saving and restoring challenges (including broken and tampered
  saves).
- `browser/check.mjs` drives the built site in Chromium on desktop and phones, and writes
  screenshots. It first checks the real page offers the model without fetching it; then, since the
  model can't load on a small test host, it defines `window.__complierGameTestModel` before the page
  starts, and a scripted transport stands in for the model (the page labels it a scripted test). The
  visitor's only way to play is talking to the model; there is no manual tool form.
