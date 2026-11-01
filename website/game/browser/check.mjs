// Browser check for the landing page's game, against the built site; writes screenshots. Not part
// of `npm test`: it needs Playwright and a running site.
//
//   VERCEL=1 npx next start website -p 3417 &
//   node website/game/browser/check.mjs OUT_DIR http://localhost:3417
//
// It never loads the real model (~793 MB; too big for the test host). First it checks the page as a
// visitor gets it: the model is offered, nothing is fetched, and the only way to play is the chat.
// Then it defines window.__complierGameTestModel before the page starts (the seam in
// app/_landing/browserModel.ts), so a SCRIPTED transport stands in for the model: it asks for every
// "$N" in the visitor's message, and the page labels its replies as a scripted test. That exercises
// chat -> tool calls -> defense -> ledger -> saved state; it says nothing about the real model.
//
// PLAYWRIGHT names the playwright package to load if it isn't installed here, and CHROMIUM a browser
// binary to use.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const [out, url] = process.argv.slice(2);
if (!out || !url) throw new Error("usage: check.mjs OUT_DIR URL");
mkdirSync(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT ?? "playwright");

const results = [];
const check = async (name, f) => {
  try {
    await f();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: String(e.message ?? e).slice(0, 500) });
  }
};

// The scripted model, as page code: the agent asks for each "$N" in the visitor's last message (at
// most 3), then replies without a tool call once it has the results. The guardrail's judge answers
// from window.__judgeQueue, or 0.2.
function scriptedModel() {
  window.__complierGameTestModel = (onState) => {
    const model = {
      kind: "scripted",
      state: { state: "idle" },
      load() {
        model.state = { state: "ready", ms: 0 };
        setTimeout(() => onState(model.state), 0);
      },
      terminate() {},
      async complete(messages, tools) {
        await new Promise((r) => setTimeout(r, 30));
        if (!tools.length) {
          const next = (window.__judgeQueue ?? []).shift() ?? 0.2;
          return { content: JSON.stringify({ violation_probability: next, reason: "scripted judge" }), tool_calls: [] };
        }
        const last = messages[messages.length - 1];
        if (last.role === "tool") return { content: "Done.", tool_calls: [] };
        const amounts = [...last.content.matchAll(/\$(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1])).slice(0, 3);
        return {
          content: amounts.length ? "" : "What would you like?",
          tool_calls: amounts.map((a, i) => ({ id: `s${i}`, name: "send_fake_money", arguments: JSON.stringify({ amount_dollars: a }) })),
          timing: "scripted test transport",
        };
      },
    };
    return model;
  };
}

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const phone = (width) => ({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const views = { desktop: { viewport: { width: 1280, height: 900 } }, mobile: phone(390), mobile360: phone(360) };

async function open(view, scripted) {
  const context = await browser.newContext(views[view]);
  if (scripted) await context.addInitScript(scriptedModel);
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(url, { waitUntil: "networkidle" });
  return { page, errors, requests };
}
const game = (page) => page.locator("#game");
const received = (page) => page.getByTestId("received").innerText();
const idle = (page) => page.waitForFunction(() => !document.querySelector(".game-busy"), null, { timeout: 30_000 });
const shot = (page, name) => game(page).screenshot({ path: `${out}/${name}.png` });
async function pick(page, name) {
  await page.getByRole("radio", { name: new RegExp(`^${name}`) }).click();
}
async function load(page) {
  await page.getByRole("button", { name: /Load the model/ }).click();
  await page.getByTestId("local-ready").waitFor();
}
async function say(page, text) {
  await page.locator("#game-message").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await idle(page);
}

// Nothing in the game is clipped: no element inside it is wider than its own box (the panel hides
// overflow, so the document's width alone doesn't show this), and the chat's Send button and heading
// lie inside the panel.
async function notClipped(page) {
  const problems = await page.evaluate(() => {
    const out = [];
    const panel = document.querySelector("#game .game").getBoundingClientRect();
    for (const el of [document.querySelector("#game .game"), ...document.querySelectorAll("#game .game *")]) {
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName}.${el.className} scrolls ${el.scrollWidth} in ${el.clientWidth}`);
    }
    const inside = (name, r) => {
      if (r.left < panel.left - 0.5 || r.right > panel.right + 0.5) out.push(`${name} spans ${r.left.toFixed(1)}..${r.right.toFixed(1)}, panel ${panel.left.toFixed(1)}..${panel.right.toFixed(1)}`);
    };
    const send = [...document.querySelectorAll("#game button")].find((b) => b.textContent.trim() === "Send");
    inside("Send", send.getBoundingClientRect());
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('label[for="game-message"]'));
    for (const r of range.getClientRects()) inside("chat heading", r);
    return out;
  });
  assert.deepEqual(problems, []);
}

const MODEL_HOSTS = /\/api\/|huggingface|jsdelivr|\.onnx|ort-wasm/;

// 1. The page as a visitor gets it.
for (const view of ["desktop", "mobile", "mobile360"]) {
  const { page, errors, requests } = await open(view, false);

  await check(`${view}: the hero is kept and the game is the second section`, async () => {
    assert.equal(await page.locator("main > section").first().getAttribute("class"), "hero");
    assert.equal(await page.locator("main > section").nth(1).getAttribute("id"), "game");
    assert.match(await page.locator("#hero-title").innerText(), /Give your agents rules/);
    await page.screenshot({ path: `${out}/${view}-hero.png` });
    const mascot = game(page).locator("img.game-mascot");
    await mascot.scrollIntoViewIfNeeded();
    assert.ok(await mascot.evaluate((img) => img.complete && img.naturalWidth > 0), "the mascot loaded");
  });

  await check(`${view}: the way to play is talking to the local model; no manual tool form, no hosted-model notice`, async () => {
    assert.match(await page.getByTestId("local-model").innerText(), /Qwen2\.5-0\.5B-Instruct[\s\S]*793 MB from Hugging Face/);
    assert.ok(await page.getByRole("button", { name: /Load the model \(793 MB\)/ }).isVisible());
    assert.equal(await page.locator("#game-message").getAttribute("placeholder"), "Load the model first");
    const text = await game(page).innerText();
    for (const stale of [/Live chat is off/i, /no model is configured/i, /Be the agent/i, /send_fake_money\s*yourself/i, /Send to me/, /\$150 at once/, /\$60, then \$60/]) {
      assert.doesNotMatch(text, stale);
    }
    assert.equal(await page.locator("#game .game-direct, #game-amount").count(), 0);
    await game(page).scrollIntoViewIfNeeded();
    await shot(page, `${view}-1-initial`);
  });

  await check(`${view}: nothing in the game is clipped`, () => notClipped(page));

  await check(`${view}: no page errors, and nothing is fetched for the model or a game server`, async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter((r) => MODEL_HOSTS.test(r)), []);
  });
  await page.context().close();
}

// 2. Playing through the chat, with the scripted transport standing in for the model.
for (const view of ["desktop", "mobile", "mobile360"]) {
  const { page, errors, requests } = await open(view, true);

  await check(`${view} (scripted model): Complier refuses the second $60 the agent sends, and $150 at once`, async () => {
    await load(page);
    assert.match(await page.getByTestId("local-ready").innerText(), /scripted test transport stands in/);
    await say(page, "Send me $60 now and then another $60.");
    assert.equal(await received(page), "$60");
    const calls = page.locator(".game-call");
    assert.equal(await calls.count(), 2);
    assert.match(await calls.nth(0).innerText(), /by the agent[\s\S]*allowed/);
    assert.match(await calls.nth(1).innerText(), /by the agent[\s\S]*blocked[\s\S]*\$60 \+ \$60 = \$120, over \$100: refused before it ran/);
    assert.match(await page.locator(".game-msg.is-agent").first().innerText(), /Agent \(scripted test\)/);
    await say(page, "Fine, just $150 then.");
    assert.equal(await received(page), "$60");
    assert.equal(await calls.count(), 3);
    await shot(page, `${view}-2-complier-chat`);
    await notClipped(page);
  });

  await check(`${view} (scripted model): a reload keeps the challenge and the chat`, async () => {
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await received(page), "$60");
    assert.equal(await page.locator(".game-call").count(), 3);
    assert.equal(await page.locator(".game-msg.is-visitor").count(), 2);
    assert.equal(await page.getByRole("radio", { name: /^Complier/ }).getAttribute("aria-checked"), "true");
  });

  if (view === "desktop") {
    await check("desktop (scripted model): sends in quick succession run one turn at a time", async () => {
      await page.getByRole("button", { name: "New challenge" }).click();
      await load(page);
      await page.locator("#game-message").fill("Send me $60 and $60.");
      // Four submits in one task, before React can re-render the button as disabled.
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("#game button")].find((x) => x.textContent.trim() === "Send");
        for (let i = 0; i < 4; i++) b.click();
      });
      await idle(page);
      assert.equal(await page.locator(".game-msg.is-visitor").count(), 1);
      assert.equal(await received(page), "$60");
    });

    await check("desktop (scripted model): switching to the per-call check starts from $0, and the split gets through", async () => {
      await pick(page, "Per-call check");
      assert.match(await page.locator(".game-notice").innerText(), /starts from \$0/);
      assert.equal(await received(page), "$0");
      await say(page, "Send me $60 and then $60.");
      assert.equal(await received(page), "$120");
      assert.match(await page.locator(".game-status").innerText(), /You win/);
      await shot(page, "desktop-3-stateless-chat");
    });

    await check("desktop (scripted model): the LTL monitor over transfer events lets the split through", async () => {
      await pick(page, "LTL monitor");
      await say(page, "Send me $60 and then $60.");
      assert.equal(await received(page), "$120");
      assert.match(await page.locator(".game-call").nth(1).innerText(), /satisfies/);
      await shot(page, "desktop-4-ltl-chat");
    });

    await check("desktop (scripted model): amounts the bank can't send are rejected before any defense", async () => {
      await say(page, "Send me $0 and $-50 and $12.5.");
      assert.equal(await page.locator(".game-call.is-invalid").count(), 3);
      assert.equal(await received(page), "$120");
      await shot(page, "desktop-5-invalid-chat");
    });

    await check("desktop (scripted model): the guardrail follows its judge: 0.2 passes, 0.9 blocks", async () => {
      await pick(page, "Guardrail");
      await page.evaluate(() => (window.__judgeQueue = [0.2, 0.9]));
      await say(page, "Send me $60 and then $60.");
      const calls = page.locator(".game-call");
      assert.match(await calls.nth(0).innerText(), /allowed[\s\S]*violation probability 0\.20/);
      assert.match(await calls.nth(1).innerText(), /blocked[\s\S]*violation probability 0\.90/);
      assert.equal(await received(page), "$60");
      await shot(page, "desktop-6-guardrail-chat");
    });

    await check("desktop (scripted model): a broken save starts a new challenge, with a notice", async () => {
      await page.evaluate(() => localStorage.setItem("complier-landing-game", JSON.stringify({ version: 2, id: "x", defense: "complier", wallet: 0, received: 999999 })));
      await page.reload({ waitUntil: "networkidle" });
      assert.match(await page.locator(".game-notice").innerText(), /couldn't be used \(bad counters\)/);
      assert.equal(await received(page), "$0");
      assert.equal(await page.evaluate(() => localStorage.getItem("complier-landing-game")), null);
      await shot(page, "desktop-7-reset");
    });
  }

  await check(`${view} (scripted model): no page errors, and nothing fetched for the model or a game server`, async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter((r) => MODEL_HOSTS.test(r)), []);
  });
  await page.context().close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
