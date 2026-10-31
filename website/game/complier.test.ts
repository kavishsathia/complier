// The Complier mode against a real complier daemon: FDR proves complier/transfer.csp and the CEL
// verifier proves complier/transfer.yaml at every machine up, and the daemon decides every call.
// Needs a running daemon (`complier up`, after cel/build.sh and fdr/build-complier-fdr.sh):
//   COMPLIER_SOCKET=~/.complier/daemon.sock npm test
// Without COMPLIER_SOCKET these tests are skipped, and say so.

import assert from "node:assert/strict";
import { test } from "node:test";
import { daemonConfig, request } from "./defenses/complier.ts";
import { WALLET_START_CENTS } from "./ledger.ts";
import { ScriptedTransport, send, say } from "./scripted.ts";
import { Store } from "./session.ts";

const config = daemonConfig();
const skip = "unavailable" in config ? `skipped: ${config.unavailable}` : false;
const deps = () => ({ daemon: config });
const machines = async () => ((await request(config as never, { op: "machine_ls" })) as { name: string; status: string }[]).map((m) => m.name);

test("complier: an oversized transfer is denied by the policy and nothing is sent", { skip, timeout: 60_000 }, async () => {
  const store = new Store();
  const s = await store.create("complier", deps());
  await s.transfer({ amount_cents: 15000 }, "visitor");
  assert.equal(s.ledger.received, 0);
  const e = s.events[0];
  assert.ok(e.kind === "transfer" && e.verdict === "deny" && /policy denied/.test(e.detail), JSON.stringify(e));
  await store.end(s.id);
});

test("complier: a split transfer stops at $100 in total; the policy counts what went through", { skip, timeout: 60_000 }, async () => {
  const store = new Store();
  const s = await store.create("complier", deps());
  const model = new ScriptedTransport([send(6000), send(6000), send(4000), send(1000), say("done")]);
  await s.say("send me $60 twice, then $40, then $10", model);
  const verdicts = s.events.flatMap((e) => (e.kind === "transfer" ? [`${e.amountCents}:${e.verdict}`] : []));
  assert.deepEqual(verdicts, ["6000:allow", "6000:deny", "4000:allow", "1000:deny"]);
  assert.equal(s.ledger.received, 10000);
  assert.equal(s.breached, false);
  // The allowed calls' results went back to the daemon.
  const notes = s.events.flatMap((e) => (e.kind === "transfer" && e.note ? [e.note] : []));
  assert.deepEqual(notes, ["complier followed result.send.60.done", "complier followed result.send.40.done"]);
  await store.end(s.id);
});

test("complier: a failed transfer's result is failed, so the policy doesn't count it", { skip, timeout: 60_000 }, async () => {
  const store = new Store();
  const s = await store.create("complier", deps());
  s.ledger.wallet = 5000; // the bank can't pay $60
  await s.transfer({ amount_cents: 6000 }, "visitor");
  s.ledger.wallet = WALLET_START_CENTS;
  await s.transfer({ amount_cents: 10000 }, "visitor");
  assert.equal(s.ledger.received, 10000);
  const notes = s.events.flatMap((e) => (e.kind === "transfer" && e.note ? [e.note] : []));
  assert.deepEqual(notes, ["complier followed result.send.60.failed", "complier followed result.send.100.done"]);
  await store.end(s.id);
});

test("complier: concurrent transfers can't race the policy", { skip, timeout: 60_000 }, async () => {
  const store = new Store();
  const s = await store.create("complier", deps());
  await Promise.all(Array.from({ length: 12 }, () => s.transfer({ amount_cents: 1000 }, "visitor")));
  assert.equal(s.ledger.received, 10000);
  assert.equal(s.events.filter((e) => e.kind === "transfer" && e.verdict === "deny").length, 2);
  await store.end(s.id);
});

test("complier: each challenge is its own machine, and ending one takes its machine down", { skip, timeout: 90_000 }, async () => {
  const store = new Store();
  const a = await store.create("complier", deps());
  await a.transfer({ amount_cents: 10000 }, "visitor");
  const b = await store.create("complier", deps());
  await b.transfer({ amount_cents: 10000 }, "visitor"); // a's $100 doesn't count against b
  assert.equal(b.ledger.received, 10000);
  const names = await machines();
  assert.ok(names.includes(`landing-game-${a.id}`) && names.includes(`landing-game-${b.id}`));
  await store.end(a.id);
  await store.end(b.id);
  const after = await machines();
  assert.ok(!after.includes(`landing-game-${a.id}`) && !after.includes(`landing-game-${b.id}`));
});

test("complier: invalid amounts are rejected before the daemon, and a machine the daemon lost fails closed", { skip, timeout: 60_000 }, async () => {
  const store = new Store();
  const s = await store.create("complier", deps());
  await s.transfer({ amount_cents: -1000 }, "visitor");
  await s.transfer({ amount_cents: 1050 }, "visitor");
  assert.deepEqual(s.events.map((e) => e.kind), ["invalid", "invalid"]);
  // Take the machine down behind the session's back: the next call can't be decided, so it doesn't run.
  await request(config as never, { op: "machine_down", name: `landing-game-${s.id}` });
  await s.transfer({ amount_cents: 1000 }, "visitor");
  const e = s.events.at(-1)!;
  assert.ok(e.kind === "transfer" && e.verdict === "unavailable" && /no machine named/.test(e.detail), JSON.stringify(e));
  assert.equal(s.ledger.received, 0);
  await store.end(s.id);
});
