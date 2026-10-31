// The live model adapter and its spend cap, with a stub fetch standing in for the provider (TEST
// ONLY: no provider is called, and nothing here says how any model behaves).

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BudgetError, LIMITS, LiveTransport, liveConfig, type LiveConfig } from "./live.ts";
import { SpendGuard } from "./spend.ts";

const dir = () => mkdtempSync(path.join(tmpdir(), "game-spend-"));
const full = (d: string) => ({
  GAME_LIVE_INFERENCE: "1",
  GAME_MODEL_BASE_URL: "https://provider.example/v1",
  GAME_MODEL: "some-model",
  GAME_MODEL_API_KEY: "sk-test",
  GAME_MODEL_INPUT_USD_PER_MTOK: "1",
  GAME_MODEL_OUTPUT_USD_PER_MTOK: "4",
  GAME_SPEND_CAP_USD: "0.01",
  GAME_SPEND_FILE: path.join(d, "spend.json"),
});

test("live inference is off unless every setting is given, and checked", () => {
  const off = liveConfig({});
  assert.ok("unavailable" in off && off.unavailable.length === 8);
  const d = dir();
  assert.ok(!("unavailable" in liveConfig(full(d))));
  for (const [k, v] of [["GAME_LIVE_INFERENCE", "0"], ["GAME_MODEL_BASE_URL", "http://insecure.example"], ["GAME_SPEND_CAP_USD", "-1"], ["GAME_MODEL_OUTPUT_USD_PER_MTOK", "NaN"]]) {
    assert.ok("unavailable" in liveConfig({ ...full(d), [k]: v }), k);
  }
});

function stub(reply: unknown, seen: { url?: string; body?: Record<string, unknown>; auth?: string }[] = [], status = 200): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization });
    return new Response(JSON.stringify(reply), { status });
  }) as unknown as typeof fetch;
}

test("a live call is capped, admitted against the cap first, and charged what the provider reports", async () => {
  const d = dir();
  const config = liveConfig(full(d)) as LiveConfig;
  const seen: { url?: string; body?: Record<string, unknown>; auth?: string }[] = [];
  const t = new LiveTransport(
    config,
    stub({ choices: [{ message: { content: "hi", tool_calls: [{ id: "c1", function: { name: "send_fake_money", arguments: '{"amount_cents":1000}' } }] } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }, seen),
  );
  const out = await t.complete([{ role: "user", content: "hello" }]);
  assert.deepEqual(out, { content: "hi", tool_calls: [{ id: "c1", name: "send_fake_money", arguments: '{"amount_cents":1000}' }] });
  assert.equal(seen[0].url, "https://provider.example/v1/chat/completions");
  assert.equal(seen[0].body!.max_tokens, LIMITS.maxTokens);
  assert.equal(seen[0].auth, "Bearer sk-test");
  const spent = JSON.parse(readFileSync(path.join(d, "spend.json"), "utf8"));
  assert.deepEqual(spent, { cap_micros: 10000, spent_micros: 100 * 1 + 10 * 4, reserved_micros: 0, calls: 1 });
});

test("the cap refuses a call before it is made, and a failed call is charged its worst case", async () => {
  const d = dir();
  const config = liveConfig({ ...full(d), GAME_SPEND_CAP_USD: "0.003" }) as LiveConfig;
  const seen: unknown[] = [];
  const failing = new LiveTransport(config, stub({ error: "boom" }, seen as never, 500));
  await assert.rejects(failing.complete([{ role: "user", content: "hello" }]), /answered 500/);
  const after = config.spend.read();
  assert.ok(after.spent_micros > 1500 && after.reserved_micros === 0, JSON.stringify(after));
  await assert.rejects(failing.complete([{ role: "user", content: "hello" }]), BudgetError);
  assert.equal(seen.length, 1); // the refused call never reached the provider
});

test("an over-long conversation is refused without a call", async () => {
  const d = dir();
  const seen: unknown[] = [];
  const t = new LiveTransport(liveConfig(full(d)) as LiveConfig, stub({}, seen as never));
  await assert.rejects(t.complete([{ role: "user", content: "x".repeat(LIMITS.maxInputChars) }]), /too long/);
  assert.equal(seen.length, 0);
});

test("spend guard: admissions past the cap are refused", () => {
  const d = dir();
  const g = new SpendGuard(path.join(d, "s.json"), 1000);
  const results = Array.from({ length: 30 }, () => g.admit(100));
  assert.equal(results.filter((r) => r.ok).length, 10);
  assert.equal(g.read().reserved_micros, 1000);
  assert.throws(() => g.admit(-1));
});
