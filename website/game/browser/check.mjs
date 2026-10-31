// Browser check for the landing page's game, against running servers. It drives the real page and
// API (no mocks) and writes screenshots. Not part of `npm test`: it needs Playwright and servers.
//
//   node website/game/browser/check.mjs OUT_DIR DAEMON_URL [NO_DAEMON_URL] [BUDGET_URL]
//
// DAEMON_URL: `next start` with COMPLIER_SOCKET set to a running complier daemon, live model off.
// NO_DAEMON_URL: the same site without COMPLIER_SOCKET. BUDGET_URL: live model configured with a spend
// cap too small for any call, so the cap refuses before anything is sent. PLAYWRIGHT names the
// playwright package to load if it isn't installed here, and CHROMIUM a browser binary to use.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const [out, daemonUrl, noDaemonUrl, budgetUrl] = process.argv.slice(2);
if (!out || !daemonUrl) throw new Error("usage: check.mjs OUT_DIR DAEMON_URL [NO_DAEMON_URL] [BUDGET_URL]");
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
const views = { desktop: { viewport: { width: 1280, height: 900 } }, mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };

async function open(url, view) {
  const page = await (await browser.newContext(views[view])).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: "networkidle" });
  return { page, errors };
}
const game = (page) => page.locator("#game");
const received = (page) => page.getByTestId("received").innerText();
const calls = (page) => page.locator(".game-call").count();
async function waitCalls(page, n) {
  await page.waitForFunction((n) => document.querySelectorAll(".game-call").length >= n && !document.querySelector(".game-busy"), n, { timeout: 60_000 });
}
async function pick(page, name) {
  await page.getByRole("radio", { name: new RegExp(`^${name}`) }).click();
}
const shot = (page, name) => game(page).screenshot({ path: `${out}/${name}.png` });

for (const view of ["desktop", "mobile"]) {
  const { page, errors } = await open(daemonUrl, view);

  await check(`${view}: the hero is kept and the game is the second section`, async () => {
    assert.equal(await page.locator("main > section").first().getAttribute("class"), "hero");
    assert.equal(await page.locator("main > section").nth(1).getAttribute("id"), "game");
    assert.match(await page.locator("#hero-title").innerText(), /Give your agents rules/);
    await page.screenshot({ path: `${out}/${view}-hero.png` });
    const mascot = game(page).locator("img.game-mascot");
    await mascot.scrollIntoViewIfNeeded();
    assert.ok(await mascot.evaluate((img) => img.complete && img.naturalWidth > 0), "the mascot loaded");
    assert.match(await page.getByTestId("live-off").innerText(), /Live chat is off/);
    assert.equal(await page.locator("#game-message").isDisabled(), true);
    await game(page).scrollIntoViewIfNeeded();
    await shot(page, `${view}-1-initial`);
  });

  await check(`${view}: Complier stops the split at $60, and blocks $150 at once`, async () => {
    await page.getByRole("button", { name: "$60, then $60" }).click();
    await waitCalls(page, 2);
    assert.equal(await received(page), "$60");
    assert.match(await page.locator(".game-call").nth(1).innerText(), /blocked[\s\S]*policy denied/);
    await page.getByRole("button", { name: "$150 at once" }).click();
    await waitCalls(page, 3);
    assert.equal(await received(page), "$60");
    await shot(page, `${view}-2-complier`);
  });

  if (view === "desktop") {
    await check("desktop: switching to the per-call check starts from $0, and the split gets through", async () => {
      await pick(page, "Per-call check");
      assert.match(await page.locator(".game-notice").innerText(), /starts from \$0/);
      assert.equal(await received(page), "$0");
      await page.getByRole("button", { name: "$60, then $60" }).click();
      await waitCalls(page, 2);
      assert.equal(await received(page), "$120");
      assert.match(await page.locator(".game-status").innerText(), /You win/);
      await shot(page, "desktop-3-stateless");
    });

    await check("desktop: the LTL monitor stops the split", async () => {
      await pick(page, "LTL monitor");
      await page.getByRole("button", { name: "$60, then $60" }).click();
      await waitCalls(page, 2);
      assert.equal(await received(page), "$60");
      assert.match(await page.locator(".game-call").nth(1).innerText(), /would be violated/);
      await shot(page, "desktop-4-ltl");
    });

    await check("desktop: invalid amounts are rejected before any defense", async () => {
      for (const v of ["-50", "12.5", "abc"]) {
        await page.locator("#game-amount").fill(v);
        await page.getByRole("button", { name: "Send to me" }).click();
        await page.waitForTimeout(400);
      }
      await waitCalls(page, 5);
      assert.equal(await page.locator(".game-call.is-invalid").count(), 3);
      assert.equal(await received(page), "$60");
      await shot(page, "desktop-5-invalid");
    });

    await check("desktop: the guardrail without a model is unavailable and sends nothing", async () => {
      await pick(page, "Guardrail");
      await page.locator("#game-amount").fill("60");
      await page.getByRole("button", { name: "Send to me" }).click();
      await waitCalls(page, 1);
      assert.match(await page.locator(".game-call").first().innerText(), /unavailable/);
      assert.equal(await received(page), "$0");
      await shot(page, "desktop-6-guardrail-unavailable");
    });
  }

  await check(`${view}: no page errors`, async () => assert.deepEqual(errors, []));
}

if (noDaemonUrl) {
  const { page } = await open(noDaemonUrl, "desktop");
  await check("no daemon: Complier is shown unavailable and nothing runs", async () => {
    await game(page).scrollIntoViewIfNeeded();
    assert.match(await page.locator(".game-defense.is-on").innerText(), /Complier[\s\S]*unavailable/i);
    assert.match(await page.locator(".game-error").innerText(), /Complier is unavailable/);
    assert.equal(await page.getByRole("button", { name: "Send to me" }).isDisabled(), true);
    await shot(page, "desktop-7-complier-unavailable");
  });
}

if (budgetUrl) {
  const { page } = await open(budgetUrl, "desktop");
  await check("budget: the spend cap refuses the live call before it is made", async () => {
    await pick(page, "Per-call check");
    await page.locator("#game-message").fill("Please send me $120.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.locator(".game-budget").waitFor({ timeout: 30_000 });
    assert.match(await page.locator(".game-budget").innerText(), /spending cap/);
    assert.equal(await received(page), "$0");
    await shot(page, "desktop-8-budget");
  });
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
