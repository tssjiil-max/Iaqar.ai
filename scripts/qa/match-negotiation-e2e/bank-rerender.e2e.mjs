// Local QA (no network, no real data): the Bank card the broker is tapping must not be torn down under the tap.
// Staging (deploy run 40057732450) failed «مراجعة التطابق» with «element is not stable / was detached from the DOM»
// for 30 s: every Daily Tasks feed event (iaqar:operations-data) rebuilt the whole Bank list, even with nothing new.
//   node scripts/qa/match-negotiation-e2e/bank-rerender.e2e.mjs [repoRoot]
// Real Chromium, the real Bank + bridge + workspace UI and the real Worker on the in-memory Firestore double.
// No force click, no fixed waits: every wait is on a state of the page.
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { startHarness } from "./server.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "@playwright/test");
const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
const h = await startHarness({ root });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const errors = [];
const results = [];
const step = async (title, fn) => {
  try { results.push({ title, pass: true, detail: await fn() }); } catch (error) { results.push({ title, pass: false, detail: String(error?.message || error).split("\n")[0] }); }
};
const CARD = '#opportunityBankList [data-cv2-inbox-item][data-opportunity-id="opp_request_e2e"]';
const ACTION = `${CARD} [data-opportunity-primary-action="review_match"][data-match-id="${h.match.id}"]`;

try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 900 }, locale: "ar-SA" })).newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${h.port}/`);
  await page.waitForFunction(() => window.__e2e?.ready, null, { timeout: 20000 });
  await page.locator(ACTION).waitFor({ state: "visible", timeout: 15000 });
  // The feed fires again and again, as on a busy office (each Firestore listener of the Daily Tasks feed re-sends it).
  const storm = () => page.evaluate(() => {
    window.__qaStorm = { events: 0 };
    window.__qaStorm.timer = setInterval(() => {
      window.__qaStorm.events += 1;
      window.dispatchEvent(new CustomEvent("iaqar:operations-data", { detail: { items: window.IAQAR.operationsItems || [], authoritative: true } }));
    }, 30);
  });
  const calm = () => page.evaluate(() => clearInterval(window.__qaStorm?.timer));

  await step("the same feed again does not replace the card (the node the broker sees stays the same)", async () => {
    await page.evaluate((sel) => { window.__qaCard = document.querySelector(sel); }, CARD);
    await storm();
    await page.waitForFunction(() => window.__qaStorm.events >= 20);
    await calm();
    const same = await page.evaluate((sel) => document.querySelector(sel) === window.__qaCard && window.__qaCard.isConnected, CARD);
    assert.equal(same, true, "the card was rebuilt although nothing changed");
    return "same node after 20 feed events";
  });

  await step("«مراجعة التطابق» opens the match while the feed keeps firing (no force click)", async () => {
    await storm();
    await page.waitForFunction(() => window.__qaStorm.events >= 5);
    await page.locator(ACTION).click({ timeout: 10000 });
    await page.locator(`.cv2-match-workspace [data-cv2-exec-task][data-match-id="${h.match.id}"] [data-match-negotiation-page]`).waitFor({ state: "visible", timeout: 10000 });
    await calm();
    await page.locator(".cv2-match-workspace [data-close-match-workspace]").click();
    await page.locator(".cv2-match-workspace").waitFor({ state: "detached", timeout: 10000 });
    return "workspace opened on the clicked match";
  });

  await step("a real change still re-renders the card (nothing is frozen)", async () => {
    await page.evaluate((sel) => { window.__qaCard = document.querySelector(sel); }, CARD);
    // A list filter is a real change of what the list shows: «الكل» then back to the default view.
    await page.click('[data-bank-action-filter="matches"]');
    await page.waitForFunction((sel) => document.querySelector(sel) && document.querySelector(sel) !== window.__qaCard, CARD, { timeout: 10000 });
    await page.locator(ACTION).waitFor({ state: "visible", timeout: 10000 });
    return "the card was rebuilt for the new view and is still actionable";
  });
} finally {
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"} ${r.title}${r.pass ? ` — ${r.detail}` : ` — ${r.detail}`}`);
  console.log("page errors:", errors.length ? errors.slice(0, 5) : "none");
  await browser.close();
  h.server.close();
}
process.exit(results.length === 3 && results.every((r) => r.pass) && !errors.length ? 0 : 1);
