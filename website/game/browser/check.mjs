// Browser check for the landing page's game, against the built site. It drives the real page and
// writes screenshots. It never loads the model: the in-browser model is ~793 MB and is only checked
// to be offered, not fetched. Not part of `npm test`: it needs Playwright and a running site.
//
//   VERCEL=1 npx next start website -p 3417 &
//   node website/game/browser/check.mjs OUT_DIR http://localhost:3417
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

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const phone = (width) => ({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const views = { desktop: { viewport: { width: 1280, height: 900 } }, mobile: phone(390), mobile360: phone(360) };

async function open(view) {
  const page = await (await browser.newContext(views[view])).newPage();
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
async function pick(page, name) {
  await page.getByRole("radio", { name: new RegExp(`^${name}`) }).click();
}
async function split(page) {
  await page.getByRole("button", { name: "$60, then $60" }).click();
  await idle(page);
}
const shot = (page, name) => game(page).screenshot({ path: `${out}/${name}.png` });

// Nothing in the game is clipped: no element inside it is wider than its own box (the panel hides
// overflow, so the document's width alone doesn't show this), and the whole "Send to me" button and
// the manual-call heading's text lie inside the panel.
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
    const button = [...document.querySelectorAll("#game button")].find((b) => b.textContent.trim() === "Send to me");
    inside("Send to me", button.getBoundingClientRect());
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('label[for="game-amount"]'));
    for (const r of range.getClientRects()) inside("manual-call heading", r);
    return out;
  });
  assert.deepEqual(problems, []);
}

for (const view of ["desktop", "mobile", "mobile360"]) {
  const { page, errors, requests } = await open(view);

  await check(`${view}: the hero is kept and the game is the second section, with the model offered but not loaded`, async () => {
    assert.equal(await page.locator("main > section").first().getAttribute("class"), "hero");
    assert.equal(await page.locator("main > section").nth(1).getAttribute("id"), "game");
    assert.match(await page.locator("#hero-title").innerText(), /Give your agents rules/);
    await page.screenshot({ path: `${out}/${view}-hero.png` });
    const mascot = game(page).locator("img.game-mascot");
    await mascot.scrollIntoViewIfNeeded();
    assert.ok(await mascot.evaluate((img) => img.complete && img.naturalWidth > 0), "the mascot loaded");
    assert.match(await page.getByTestId("local-model").innerText(), /Qwen2\.5-0\.5B-Instruct[\s\S]*793 MB from Hugging Face/);
    assert.ok(await page.getByRole("button", { name: /Load the model \(793 MB\)/ }).isVisible());
    assert.equal(await page.locator("#game-message").isDisabled(), true);
    await game(page).scrollIntoViewIfNeeded();
    await shot(page, `${view}-1-initial`);
  });

  await check(`${view}: nothing in the game is clipped`, () => notClipped(page));

  await check(`${view}: Complier (cumulative cap) refuses the second $60 and $150 at once`, async () => {
    await split(page);
    assert.equal(await received(page), "$60");
    assert.match(await page.locator(".game-call").nth(1).innerText(), /blocked[\s\S]*\$60 \+ \$60 = \$120, over \$100: refused before it ran/);
    await page.getByRole("button", { name: "$150 at once" }).click();
    await idle(page);
    assert.equal(await received(page), "$60");
    assert.equal(await page.locator(".game-call").count(), 3);
    await shot(page, `${view}-2-complier`);
    await notClipped(page);
  });

  await check(`${view}: a reload keeps the challenge`, async () => {
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await received(page), "$60");
    assert.equal(await page.locator(".game-call").count(), 3);
    assert.equal(await page.getByRole("radio", { name: /^Complier/ }).getAttribute("aria-checked"), "true");
  });

  if (view === "desktop") {
    await check("desktop: clicks in quick succession run one action at a time", async () => {
      await page.getByRole("button", { name: "New challenge" }).click();
      // Four clicks in one task, before React can re-render the buttons as disabled.
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("#game button")].find((x) => x.textContent.trim() === "$60, then $60");
        for (let i = 0; i < 4; i++) b.click();
      });
      await idle(page);
      assert.equal(await received(page), "$60");
      assert.equal(await page.locator(".game-call").count(), 2);
    });

    await check("desktop: switching to the per-call check starts from $0, and the split gets through", async () => {
      await pick(page, "Per-call check");
      assert.match(await page.locator(".game-notice").innerText(), /starts from \$0/);
      assert.equal(await received(page), "$0");
      await split(page);
      assert.equal(await received(page), "$120");
      assert.match(await page.locator(".game-status").innerText(), /You win/);
      await shot(page, "desktop-3-stateless");
    });

    await check("desktop: the LTL monitor stops the split", async () => {
      await pick(page, "LTL monitor");
      await split(page);
      assert.equal(await received(page), "$60");
      assert.match(await page.locator(".game-call").nth(1).innerText(), /would be violated/);
      await shot(page, "desktop-4-ltl");
    });

    await check("desktop: invalid amounts are rejected before any defense", async () => {
      for (const v of ["-50", "12.5", "abc"]) {
        await page.locator("#game-amount").fill(v);
        await page.getByRole("button", { name: "Send to me" }).click();
        await idle(page);
      }
      assert.equal(await page.locator(".game-call.is-invalid").count(), 3);
      assert.equal(await received(page), "$60");
      await shot(page, "desktop-5-invalid");
    });

    await check("desktop: the guardrail without the model loaded is unavailable and sends nothing", async () => {
      await pick(page, "Guardrail");
      await page.locator("#game-amount").fill("60");
      await page.getByRole("button", { name: "Send to me" }).click();
      await idle(page);
      assert.match(await page.locator(".game-call").first().innerText(), /unavailable[\s\S]*load the model first/);
      assert.equal(await received(page), "$0");
      await shot(page, "desktop-6-guardrail-unavailable");
    });

    await check("desktop: a broken save starts a new challenge, with a notice", async () => {
      await page.evaluate(() => localStorage.setItem("complier-landing-game", JSON.stringify({ version: 2, id: "x", defense: "complier", wallet: 0, received: 999999 })));
      await page.reload({ waitUntil: "networkidle" });
      assert.match(await page.locator(".game-notice").innerText(), /couldn't be used \(bad counters\)/);
      assert.equal(await received(page), "$0");
      assert.equal(await page.evaluate(() => localStorage.getItem("complier-landing-game")), null);
      await shot(page, "desktop-7-reset");
    });
  }

  await check(`${view}: no page errors, no server calls for the game, and the model wasn't fetched`, async () => {
    assert.deepEqual(errors, []);
    const game = requests.filter((r) => /\/api\/|huggingface|jsdelivr|\.onnx|ort-wasm/.test(r));
    assert.deepEqual(game, []);
  });
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
