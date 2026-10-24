// The office shell (legacy.html + workflow-office.js) projects each persisted Operation for Daily Tasks and
// «العروض والطلبات». When the operations listener answers before the operations domain module has loaded (a slow
// network, a service worker serving the page first), the first projection is the shell's short fallback — without
// officeId, offerId or requestId — and the Bank drops those operations: no «مراجعة التطابق» on any card. The full
// projection must replace it as soon as the domain is ready, without waiting for the data to change.
//   node scripts/qa/office-os/operations-projection.e2e.mjs        (OUT_DIR for traces)
// Real Chromium, the real shell and Worker on the in-memory Firestore double. Waits on page state only; no force click.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { startOfficeOsHarness, OFFICE_A, OWNER_A, idTokenFor } from "./server.mjs";

const OUT = process.env.OUT_DIR || "/tmp/iaqar-operations-projection";
fs.mkdirSync(OUT, { recursive: true });
const REQ = "opp_projection_req", OFFER = "opp_projection_offer";
const REVIEW = `#opportunityBankList [data-cv2-inbox-item][data-opportunity-id="${REQ}"] [data-opportunity-primary-action="review_match"][data-match-id]`;

async function harness() {
  const h = await startOfficeOsHarness();
  const now = new Date().toISOString();
  const base = { officeId: OFFICE_A, lifecycleStatus: "ACTIVE", status: "active", matchingReadiness: "READY_FOR_MATCHING", dataCompleteness: 100, city: "المدينة المنورة", district: "العزيزية", propertyType: "شقة", version: 1, createdAt: now, updatedAt: now };
  h.store.seed(`offices/${OFFICE_A}/opportunities/${REQ}`, { ...base, opportunityKind: "REQUEST", purpose: "PURCHASE", advertiserRole: "CLIENT", budget: 900000, priceOrBudget: 900000, priceMax: 900000, contactPhone: "0501119401", contactName: "عميل المكتب" });
  h.store.seed(`offices/${OFFICE_A}/opportunities/${OFFER}`, { ...base, opportunityKind: "OFFER", purpose: "SALE", advertiserRole: "OWNER", salePrice: 880000, priceOrBudget: 880000, contactPhone: "0501119402", contactName: "مالك" });
  const response = await h.worker.fetch(new Request("https://worker.test/matching/run", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${idTokenFor(OWNER_A)}` },
    body: JSON.stringify({ officeId: OFFICE_A, opportunityId: REQ, notify: false })
  }), h.env, { waitUntil() {} });
  const body = await response.json();
  const match = (body.matches || []).find((m) => (m.requestId || m.clientRequestId) === REQ);
  assert.ok(match?.matchId, `a match: ${JSON.stringify(body).slice(0, 200)}`);
  return { h, matchId: match.matchId };
}

/** Signs office A's owner into the shell; `domainDelayMs` holds the operations domain module back. */
async function openShell(browser, h, domainDelayMs) {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: "ar-SA", serviceWorkers: "block" });
  await context.tracing.start({ screenshots: true, snapshots: true });
  if (domainDelayMs) {
    await context.route(/\/js\/operations-domain-bridge\.js(\?|$)/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, domainDelayMs));
      await route.continue();
    });
  }
  await context.addInitScript(() => {
    window.__projection = { domainReadyAt: 0, feeds: [] };
    window.addEventListener("iaqar:operations-domain-ready", () => { window.__projection.domainReadyAt = Math.round(performance.now()); });
    window.addEventListener("iaqar:operations-data", (event) => {
      const ops = (event.detail?.items || []).filter((item) => String(item?.recordType || "").toLowerCase() === "operation");
      if (ops.length) window.__projection.feeds.push({ at: Math.round(performance.now()), withOffice: ops.filter((op) => op.officeId).length, total: ops.length });
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message || error)));
  await page.goto(`${h.origin}/?env=staging&officeId=${OFFICE_A}&contentV2=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.firebase?.apps?.length > 0);
  const token = `h.${Buffer.from(JSON.stringify({ uid: OWNER_A })).toString("base64url")}.s`;
  await page.evaluate(async ({ token, officeId }) => { await window.firebase.auth().signInWithCustomToken(token); localStorage.setItem("iaqar.officeId", officeId); }, { token, officeId: OFFICE_A });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.firebase?.auth().currentUser && window.IAQAR?.activateOpportunityBankInline));
  return { context, page, errors };
}

async function openBank(page) {
  const mainTab = page.locator("#mainTabOpportunities:visible");
  if (await mainTab.count()) await mainTab.click();
  else await page.evaluate(() => { window.IAQAR.homeTabs?.switchTo?.("opportunities"); window.IAQAR.openOpportunityBank?.(); });
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const results = [];
async function scenario(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log(`✔ ${name}`); }
  catch (error) { results.push({ name, ok: false, error: String(error.message || error).split("\n").slice(0, 4).join(" | ") }); console.log(`✘ ${name} — ${String(error.message || error).split("\n")[0]}`); }
}

try {
  for (const [label, delay] of [["no artificial delay (the harness's own load order)", 0], ["the first operations answer arrives before the domain module", 2500]]) {
    await scenario(`${label}: «مراجعة التطابق» appears, every projected operation keeps its office, the click opens the match`, async () => {
      const { h, matchId } = await harness();
      const { context, page, errors } = await openShell(browser, h, delay);
      try {
        await openBank(page);
        await page.waitForFunction(() => window.__projection.domainReadyAt > 0);
        await page.locator(REVIEW).waitFor({ state: "visible", timeout: 10000 }).catch(async () => {
          throw new Error(`no «مراجعة التطابق» on the request card — ${JSON.stringify(await page.evaluate(() => ({ ...window.__projection, now: Math.round(performance.now()) })))}`);
        });
        const projection = await page.evaluate(() => window.__projection);
        const last = projection.feeds.at(-1);
        assert.ok(last && last.withOffice === last.total, `the latest feed carries the office on every operation: ${JSON.stringify(projection)}`);
        assert.equal(await page.locator(REVIEW).getAttribute("data-match-id"), matchId);
        await page.locator(REVIEW).click();
        await page.locator(`.cv2-match-workspace [data-cv2-exec-task][data-match-id="${matchId}"] [data-match-negotiation-page]`).waitFor({ state: "visible", timeout: 10000 });
        assert.deepEqual(errors, []);
      } finally { await context.tracing.stop({ path: path.join(OUT, `projection-${delay}.zip`) }); await context.close(); h.server.close(); }
    });
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(OUT, "operations-projection-report.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} operations projection scenarios passed`);
  process.exitCode = failed.length ? 1 : 0;
}
