// «العروض والطلبات» on the real office shell (legacy.html + workflow-office.js + opportunity-bank.js), the real Worker
// and the in-memory Firestore double: the cards and their «مراجعة التطابق» survive the tab being opened again while a
// load is still running, and data updates arriving meanwhile. Seen on Staging (deploy run 40057732450): the list was
// emptied under the broker's tap and never came back.
//   node scripts/qa/office-os/bank-activation.e2e.mjs          (REPEAT=20 repeats the critical scenario; OUT_DIR for traces)
// Waits are on page state only (no fixed delays); no force click. Local data only — no real office or customer.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { startOfficeOsHarness, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B, idTokenFor } from "./server.mjs";

const OUT = process.env.OUT_DIR || "/tmp/iaqar-bank-activation";
const REPEAT = Math.max(1, Number(process.env.REPEAT || 1));
fs.mkdirSync(OUT, { recursive: true });
const REQ = "opp_bankrace_req", OFFER_A = "opp_bankrace_offer_a", OFFER_B = "opp_bankrace_offer_b";
const card = (id) => `#opportunityBankList [data-cv2-inbox-item][data-opportunity-id="${id}"]`;
const review = (id, matchId) => `${card(id)} [data-opportunity-primary-action="review_match"][data-match-id="${matchId}"]`;
const REQ_REVIEW = `${card(REQ)} [data-opportunity-primary-action="review_match"][data-match-id]`;
const workspace = (matchId) => `.cv2-match-workspace [data-cv2-exec-task][data-match-id="${matchId}"] [data-match-negotiation-page]`;

/** A fresh office A with one request and two offers, matched by the real Worker; office B has records of its own. */
async function harness({ extraRecords = 0 } = {}) {
  const h = await startOfficeOsHarness();
  const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const base = { officeId: OFFICE_A, lifecycleStatus: "ACTIVE", status: "active", matchingReadiness: "READY_FOR_MATCHING", dataCompleteness: 100, city: "المدينة المنورة", district: "العزيزية", propertyType: "شقة", version: 1, createdAt: at(0), updatedAt: at(0) };
  for (let i = 0; i < extraRecords; i += 1) {
    h.store.seed(`offices/${OFFICE_A}/opportunities/opp_bankrace_old_${i}`, { ...base, opportunityKind: "OFFER", purpose: "SALE", advertiserRole: "OWNER", propertyType: "أرض", district: "قباء", priceOrBudget: 3_000_000 + i, contactPhone: `05022${String(10000 + i)}`, createdAt: at(600 + i), updatedAt: at(600 + i) });
  }
  h.store.seed(`offices/${OFFICE_A}/opportunities/${REQ}`, { ...base, opportunityKind: "REQUEST", purpose: "PURCHASE", advertiserRole: "CLIENT", budget: 900000, priceOrBudget: 900000, priceMax: 900000, contactPhone: "0501119301", contactName: "عميل المكتب" });
  h.store.seed(`offices/${OFFICE_A}/opportunities/${OFFER_A}`, { ...base, opportunityKind: "OFFER", purpose: "SALE", advertiserRole: "OWNER", salePrice: 895000, priceOrBudget: 895000, contactPhone: "0501119302", contactName: "مالك أ" });
  h.store.seed(`offices/${OFFICE_A}/opportunities/${OFFER_B}`, { ...base, opportunityKind: "OFFER", purpose: "SALE", advertiserRole: "OWNER", salePrice: 840000, priceOrBudget: 840000, contactPhone: "0501119303", contactName: "مالك ب" });
  h.store.seed(`offices/${OFFICE_B}/opportunities/opp_bankrace_office_b`, { ...base, officeId: OFFICE_B, opportunityKind: "OFFER", purpose: "SALE", advertiserRole: "OWNER", priceOrBudget: 880000, contactPhone: "0501119399", contactName: "مالك مكتب آخر" });
  const response = await h.worker.fetch(new Request("https://worker.test/matching/run", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${idTokenFor(OWNER_A)}` },
    body: JSON.stringify({ officeId: OFFICE_A, opportunityId: REQ, notify: false })
  }), h.env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const matches = (body.matches || []).filter((m) => (m.requestId || m.clientRequestId) === REQ).map((m) => ({ matchId: m.matchId, offerId: m.offerId || m.ownerOfferId }));
  assert.equal(matches.length, 2, `two matches: ${JSON.stringify(body).slice(0, 300)}`);
  return { h, matches, matchFor: (offerId) => matches.find((m) => m.offerId === offerId).matchId, offerOf: (matchId) => matches.find((m) => m.matchId === matchId)?.offerId };
}

/**
 * The office shell, signed in as office A's owner. `network` is the stub's test-only network model:
 * { slow: { [pathPrefix]: ms }, firstSnapshot: { [pathPrefix]: ms }, failOnce: pathPrefix }.
 */
async function openShell(browser, h, network = {}) {
  // Service workers off: their cache would otherwise decide script timing, not the network model under test.
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: "ar-SA", serviceWorkers: "block" });
  await context.tracing.start({ screenshots: true, snapshots: true });
  await context.addInitScript((model) => {
    const pick = (table, p) => Object.entries(table || {}).find(([prefix]) => p.startsWith(prefix))?.[1] || 0;
    let failed = false;
    window.__harnessNetwork = (p, kind) => {
      if (kind === "get" && model.failOnce && !failed && p.startsWith(model.failOnce)) { failed = true; return { fail: true }; }
      return { delayMs: kind === "get" ? pick(model.slow, p) : pick(model.firstSnapshot, p) };
    };
    window.__listRedraws = 0;
    window.__bankActivations = 0;
    window.__bankActivationLog = [];
    window.addEventListener("iaqar:opportunity-bank-opened", () => {
      window.__bankActivations += 1;
      window.__bankActivationLog.push(`${Math.round(performance.now())}ms ${(new Error().stack || "").split("\n").slice(3, 8).map((l) => l.trim().replace(location.origin, "")).join(" < ")}`);
    });
    document.addEventListener("DOMContentLoaded", () => {
      const list = document.getElementById("opportunityBankList");
      if (list) new MutationObserver(() => { window.__listRedraws += 1; }).observe(list, { childList: true });
    });
  }, network);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.message || error)));
  await page.goto(`${h.origin}/?env=staging&officeId=${OFFICE_A}&contentV2=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.firebase?.apps?.length > 0);
  const token = `h.${Buffer.from(JSON.stringify({ uid: OWNER_A })).toString("base64url")}.s`;
  await page.evaluate(async ({ token, officeId }) => { await window.firebase.auth().signInWithCustomToken(token); localStorage.setItem("iaqar.officeId", officeId); }, { token, officeId: OFFICE_A });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForShell(page);
  return { context, page, errors };
}
const waitForShell = (page) => page.waitForFunction(() => Boolean(window.firebase?.auth().currentUser && document.getElementById("mainTabOpportunities") && window.IAQAR?.activateOpportunityBankInline));

/**
 * Opens «العروض والطلبات» the way the Staging journey does (scripts/staging-bank-card-click-verify.mjs openBankTab):
 * the visible main tab, or — on the content V2 shell, where it is hidden — the app's own opener.
 */
async function openBank(page) {
  const mainTab = page.locator("#mainTabOpportunities:visible");
  if (await mainTab.count()) await mainTab.click();
  else await page.evaluate(() => { window.IAQAR.homeTabs?.switchTo?.("opportunities"); window.IAQAR.openOpportunityBank?.(); });
  await page.locator("#oppTabBank:visible, #platformOpportunityOnboarding:visible").first().waitFor({ state: "visible" });
  if (await page.locator("#platformOpportunityOnboarding").isVisible()) {
    await page.locator("#platformOnboardingAckBtn").click();
    await page.locator("#platformOpportunityOnboarding").waitFor({ state: "hidden" });
  }
}
const bankShown = (page) => page.waitForFunction(() => document.getElementById("oppTabBank")?.getAttribute("aria-selected") === "true" && !document.getElementById("oppPanelBank")?.hidden);
/** Open it, and — once the cards are on screen, while the rest of the load is still running — press the sub-tab again. */
const listState = (page) => page.evaluate(() => ({
  cards: [...document.querySelectorAll("#opportunityBankList [data-cv2-inbox-item]")].map((c) => `${c.dataset.opportunityId}:${c.querySelector("[data-opportunity-primary-action]")?.getAttribute("data-opportunity-primary-action") || "-"}`),
  text: (document.getElementById("opportunityBankList")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140),
  activations: window.__bankActivations || 0,
  activationLog: window.__bankActivationLog || []
}));
/** Wait until `selector` is visible; if it never is, say what the list showed instead. */
async function visible(page, selector, label) {
  await page.locator(selector).waitFor({ state: "visible", timeout: 15000 }).catch(async () => { throw new Error(`${label}: not shown — list ${JSON.stringify(await listState(page))}`); });
}
async function openBankTwice(page, firstVisible) {
  await openBank(page);
  await visible(page, firstVisible, "after opening");
  await page.locator("#oppTabBank").click();
  await bankShown(page);
}

/** Another member saves an unrelated record in the same office; wait until the shell's live feed has it and the list was redrawn. */
async function unrelatedUpdate(h, page, id) {
  const redraws = await page.evaluate(() => window.__listRedraws);
  h.store.seed(`offices/${OFFICE_A}/opportunities/${id}`, { officeId: OFFICE_A, lifecycleStatus: "ACTIVE", status: "active", opportunityKind: "OFFER", purpose: "SALE", propertyType: "فيلا", city: "المدينة المنورة", district: "قباء", priceOrBudget: 2_000_000, contactPhone: "0501119310", createdAt: "2020-01-01T00:00:00.000Z", updatedAt: new Date().toISOString(), version: 1 });
  await page.waitForFunction(({ id, redraws }) => (window.IAQAR?.operationsItems || []).some((item) => [item.id, item.recordId, item.opportunityId].some((v) => String(v || "").includes(id))) && window.__listRedraws > redraws, { id, redraws });
}

/** The card must be listed now. If it is not, the failure says whether it came back later (a blank frame) or never (lost). */
async function assertListed(page, id, when) {
  if (await page.locator(card(id)).count() === 1) return;
  const missingAt = Date.now();
  const state = await listState(page);
  const back = await page.locator(card(id)).waitFor({ state: "attached", timeout: 10000 }).then(() => `came back after ${Date.now() - missingAt} ms`, () => "never came back within 10 s");
  throw new Error(`card ${id} is not listed ${when} (${back}) — list ${JSON.stringify({ cards: state.cards, text: state.text })}`);
}

async function assertOpens(page, opportunityId, matchId, label) {
  const button = page.locator(review(opportunityId, matchId));
  await button.waitFor({ state: "visible", timeout: 10000 }).catch(async () => {
    const list = await page.evaluate(() => ({ cards: document.querySelectorAll("#opportunityBankList [data-cv2-inbox-item]").length, text: (document.getElementById("opportunityBankList")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160) }));
    throw new Error(`${label}: «مراجعة التطابق» for ${matchId} is not on ${opportunityId} — list ${JSON.stringify(list)}`);
  });
  await button.click({ timeout: 10000 });
  await page.locator(workspace(matchId)).waitFor({ state: "visible", timeout: 10000 });
  const opened = await page.evaluate(() => ({
    matchId: document.querySelector(".cv2-match-workspace [data-cv2-exec-task]")?.getAttribute("data-match-id") || "",
    sections: [...document.querySelectorAll(".cv2-match-workspace [data-match-section]")].map((n) => n.dataset.matchSection)
  }));
  assert.equal(opened.matchId, matchId, `${label}: the workspace is on the clicked match`);
  for (const section of ["property", "agreement", "parties", "broker"]) assert.ok(opened.sections.includes(section), `${label}: section ${section}`);
}
async function closeWorkspace(page) {
  await page.locator(".cv2-match-workspace [data-close-match-workspace]").click();
  await page.locator(".cv2-match-workspace").waitFor({ state: "detached" });
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const results = [];
async function scenario(name, run) {
  const started = Date.now();
  try { await run(); results.push({ name, ok: true, ms: Date.now() - started }); console.log(`✔ ${name}`); }
  catch (error) { results.push({ name, ok: false, error: String(error.message || error).split("\n").slice(0, 6).join(" | ") }); console.log(`✘ ${name} — ${String(error.message || error).split("\n")[0]}`); }
}
// Listeners answer after 600 ms at the earliest: by then the shell's operations module is loaded. (An earlier answer
// meets a separate, documented defect — the fallback operation projection — which this check does not cover.)
const FIRST = { [`offices/${OFFICE_A}/`]: 600 };
const SLOW_INCOMING = { slow: { cooperationRequests: 1500 }, firstSnapshot: FIRST };

try {
  if (REPEAT === 1) {
    await scenario("one opening: both sides carry «مراجعة التطابق», the offer opens its match", async () => {
      const { h, matchFor } = await harness();
      const { context, page, errors } = await openShell(browser, h, { firstSnapshot: FIRST });
      try {
        await openBank(page);
        await assertOpens(page, OFFER_B, matchFor(OFFER_B), "single opening");
        assert.deepEqual(errors, []);
      } finally { await context.tracing.stop({ path: path.join(OUT, "single.zip") }); await context.close(); h.server.close(); }
    });
  }

  for (let round = 1; round <= REPEAT; round += 1) {
    await scenario(`${REPEAT > 1 ? `[${round}/${REPEAT}] ` : ""}the tab opened again during a running load, then a live update: cards stay, the click opens the right match`, async () => {
      const { h, offerOf } = await harness({ extraRecords: round % 2 ? 0 : 30 });
      // A different listener order each round (first answers between 600 ms and 2 s).
      const order = Object.fromEntries(["matches", "operations", "opportunities", "deals", "publicIntake"].map((c) => [`offices/${OFFICE_A}/${c}`, 600 + Math.floor(Math.random() * 1400)]));
      const { context, page, errors } = await openShell(browser, h, { slow: { cooperationRequests: 1500 }, firstSnapshot: order });
      try {
        await openBankTwice(page, REQ_REVIEW);
        // The match the request card shows, and its offer: the pair the Staging journey clicks first.
        const shown = await page.locator(REQ_REVIEW).getAttribute("data-match-id");
        assert.ok(offerOf(shown), `the request card shows one of its own matches (${shown})`);
        await unrelatedUpdate(h, page, `opp_bankrace_unrelated_${round}`);
        for (const id of [REQ, OFFER_A, OFFER_B]) await assertListed(page, id, "after the update");
        await assertOpens(page, offerOf(shown), shown, "offer side");
        assert.deepEqual(errors, []);
      } finally { await context.tracing.stop({ path: path.join(OUT, `race-${round}.zip`) }); await context.close(); h.server.close(); }
    });
  }

  if (REPEAT === 1) {
    await scenario("a live update while the match workspace is open keeps it on that match; another match and the request side open fresh", async () => {
      const { h, matchFor, matches } = await harness();
      const { context, page, errors } = await openShell(browser, h, SLOW_INCOMING);
      try {
        await openBankTwice(page, REQ_REVIEW);
        await assertOpens(page, OFFER_B, matchFor(OFFER_B), "offer B");
        await unrelatedUpdate(h, page, "opp_bankrace_while_open");
        assert.equal(await page.evaluate(() => document.querySelector(".cv2-match-workspace [data-cv2-exec-task]")?.getAttribute("data-match-id")), matchFor(OFFER_B), "still on the same match after the update");
        await closeWorkspace(page);
        await assertOpens(page, OFFER_A, matchFor(OFFER_A), "a different match (offer A)");
        await closeWorkspace(page);
        const shown = await page.locator(`${card(REQ)} [data-opportunity-primary-action="review_match"]`).getAttribute("data-match-id");
        assert.ok(matches.some((m) => m.matchId === shown), "the request card shows one of its own matches");
        await assertOpens(page, REQ, shown, "request side");
        assert.deepEqual(errors, []);
      } finally { await context.tracing.stop({ path: path.join(OUT, "workspace.zip") }); await context.close(); h.server.close(); }
    });

    await scenario("after a page refresh both sides open again, and the tab opened in a quick burst still lists every card", async () => {
      const { h, matchFor } = await harness();
      const { context, page, errors } = await openShell(browser, h, SLOW_INCOMING);
      try {
        await openBankTwice(page, REQ_REVIEW);
        await page.reload({ waitUntil: "domcontentloaded" });
        await waitForShell(page);
        await openBank(page);
        await page.locator(REQ_REVIEW).waitFor({ state: "visible" });
        for (let i = 0; i < 5; i += 1) await page.locator("#oppTabBank").click();
        await unrelatedUpdate(h, page, "opp_bankrace_after_refresh");
        await assertOpens(page, OFFER_B, matchFor(OFFER_B), "offer after refresh");
        await closeWorkspace(page);
        await assertOpens(page, OFFER_A, matchFor(OFFER_A), "other offer after refresh");
        assert.deepEqual(errors, []);
      } finally { await context.tracing.stop({ path: path.join(OUT, "refresh.zip") }); await context.close(); h.server.close(); }
    });

    await scenario("a failed load never leaves an office with records on an empty list: it recovers (offered retry or the next load) and the match opens", async () => {
      const { h, matchFor } = await harness();
      const { context, page, errors } = await openShell(browser, h, { failOnce: `offices/${OFFICE_A}/opportunities`, firstSnapshot: FIRST });
      try {
        await openBank(page);
        await page.locator(`#opportunityBankRetry:visible, ${REQ_REVIEW}`).first().waitFor({ state: "visible", timeout: 15000 }).catch(async () => {
          throw new Error(`after a failed load: neither a retry nor the cards — list ${JSON.stringify(await listState(page))}`);
        });
        if (await page.locator("#opportunityBankRetry").isVisible()) await page.locator("#opportunityBankRetry").click();
        await visible(page, REQ_REVIEW, "after recovery");
        await assertOpens(page, OFFER_B, matchFor(OFFER_B), "after recovery");
        assert.deepEqual(errors.filter((e) => !/currently unavailable/.test(e)), []);
      } finally { await context.tracing.stop({ path: path.join(OUT, "retry.zip") }); await context.close(); h.server.close(); }
    });

    await scenario("isolation: office B's records never appear, and a live feed sent for office B changes nothing in office A", async () => {
      const { h, matchFor } = await harness();
      const { context, page, errors } = await openShell(browser, h, SLOW_INCOMING);
      try {
        await openBankTwice(page, REQ_REVIEW);
        assert.equal(await page.locator(card("opp_bankrace_office_b")).count(), 0, "no office B card");
        const before = await page.locator("#opportunityBankList").innerHTML();
        await page.evaluate((officeB) => window.dispatchEvent(new CustomEvent("iaqar:operations-data", { detail: { officeId: officeB, items: [], authoritative: true } })), OFFICE_B);
        assert.equal(await page.locator("#opportunityBankList").innerHTML(), before, "office B's feed is ignored");
        assert.ok(!(await page.locator("#opportunityBankList").innerText()).includes("0501119399"), "no office B contact");
        await assertOpens(page, OFFER_B, matchFor(OFFER_B), "after a foreign feed");
        assert.deepEqual(errors, []);
      } finally { await context.tracing.stop({ path: path.join(OUT, "isolation.zip") }); await context.close(); h.server.close(); }
    });
  }
  if (REPEAT === 1) {
    // While a load for office A is still running, the page moves to office B — the same user's office rebound
    // (access-gate unlockOfficeWorkspace → rebindOfficeContext), or another user signing in without a reload.
    // From that moment no card of office A may be on screen, not even for one frame.
    const ownRows = [REQ, OFFER_A, OFFER_B];
    const watchForeignRows = (page) => page.evaluate(({ officeB, ids }) => {
      window.__foreignFrames = [];
      const check = () => {
        if (window.IAQAR?.office?.officeId === officeB) {
          const shown = ids.filter((id) => document.querySelector(`#opportunityBankList [data-cv2-inbox-item][data-opportunity-id="${id}"]`));
          if (shown.length) window.__foreignFrames.push(`${Math.round(performance.now())}ms ${shown.join(",")}`);
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }, { officeB: OFFICE_B, ids: ownRows });
    for (const [label, switchTo] of [
      ["the same user's office rebound", (page) => page.evaluate((officeB) => window.IAQAR.rebindOfficeContext(officeB), OFFICE_B)],
      ["another user signing in without a reload", (page) => page.evaluate(async ({ officeB, token }) => {
        await window.firebase.auth().signOut();
        await window.firebase.auth().signInWithCustomToken(token);
        window.IAQAR.rebindOfficeContext(officeB);
      }, { officeB: OFFICE_B, token: `h.${Buffer.from(JSON.stringify({ uid: OWNER_B })).toString("base64url")}.s` })]
    ]) {
      await scenario(`isolation: ${label} during a running load never shows office A's cards under office B`, async () => {
        const { h } = await harness();
        const { context, page, errors } = await openShell(browser, h, SLOW_INCOMING);
        try {
          await openBankTwice(page, REQ_REVIEW);
          await watchForeignRows(page);
          await switchTo(page);
          await page.evaluate(() => { window.IAQAR.homeTabs?.switchTo?.("opportunities"); window.IAQAR.openOpportunityBank?.(); });
          await visible(page, card("opp_bankrace_office_b"), "office B's own record");
          // Office B's list is settled: no load is running and nothing more is queued.
          await page.waitForFunction(() => !/جارٍ/.test(document.getElementById("opportunityBankStatus")?.textContent || ""));
          const foreign = await page.evaluate(() => window.__foreignFrames);
          assert.deepEqual(foreign.slice(0, 5), [], `office A's cards were shown under office B (${foreign.length} frames)`);
          for (const id of ownRows) assert.equal(await page.locator(card(id)).count(), 0, `${id} is not listed under office B`);
          assert.deepEqual(errors, []);
        } finally { await context.tracing.stop({ path: path.join(OUT, `switch-${label.split(" ")[1]}.zip`) }); await context.close(); h.server.close(); }
      });
    }
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(OUT, "bank-activation-report.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} bank activation scenarios passed`);
  process.exitCode = failed.length ? 1 : 0;
}
