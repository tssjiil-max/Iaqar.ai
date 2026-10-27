// Real proposal/reply components and Worker against the local in-memory harness; no messages are sent.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { startOfficeOsHarness, OFFICE_A } from "./server.mjs";
import { seedStates, callWorker } from "./seed.mjs";

const out = process.env.OUT_DIR || "/tmp/iaqar-secondary-money";
await fs.mkdir(out, { recursive: true });
const h = await startOfficeOsHarness();
const seeded = await seedStates(h);
const journeyId = seeded.negotiation.journeyId;
const proposalPath = `offices/${OFFICE_A}/proposals`;
const browser = await chromium.launch();
const results = [];
async function contextFor() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar-SA", serviceWorkers: "block" });
  const blocked = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    blocked.push(url.origin);
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  return { context, page, blocked, errors };
}
try {
  for (const raw of [null, "٦٠٠٬٠٠٠٫٥٠", "600,000.50", "600ريال000"]) {
    const label = `proposal-${results.length}`;
    const { context, page, blocked, errors } = await contextFor();
    let observed;
    try {
      await page.goto(h.origin);
      await page.locator('[name="phone"]').fill("0501111111");
      await page.locator('[name="password"]').fill("pass-a");
      await page.getByRole("button", { name: "دخول المكتب", exact: true }).click();
      await page.locator("[data-smart-office]").waitFor();
      const journey = { ...h.store.get(`offices/${OFFICE_A}/journeys/${journeyId}`), journeyId, lastProposal: { fields: { price: 600000.5 } } };
      const offer = h.store.get(`offices/${OFFICE_A}/opportunities/${seeded.negotiation.offerId}`);
      const request = h.store.get(`offices/${OFFICE_A}/opportunities/${seeded.negotiation.requestId}`);
      // Mount the exported production composer in the signed-in app; navigation is covered by journey.e2e.
      await page.evaluate(async ({ journey, offer, request }) => {
        const { openComposer } = await import("/os/views/composer.js");
        openComposer(journey, { offer, request });
      }, { journey, offer, request });
      const sheet = page.locator(".os-sheet");
      const input = sheet.locator('[name="price"]');
      const prefill = await input.inputValue();
      if (raw !== null) await input.fill(raw);
      const before = h.store.list(proposalPath);
      await sheet.getByRole("button", { name: "تجهيز المقترح والرابط" }).click();
      await page.waitForFunction(() => document.querySelector(".os-sheet .os-alert.ok") || document.querySelector(".os-toast.bad"));
      const after = h.store.list(proposalPath);
      const added = after.filter(row => !before.some(old => old.id === row.id));
      observed = { raw, prefill, before: before.length, after: after.length, savedPrices: added.map(row => row.fields.price), messages: added.map(row => row.messageText) };
      const valid = raw !== "600ريال000";
      assert.equal(added.length, valid ? 2 : 0, "invalid prices must not create proposals");
      assert.equal(prefill, "600,000.5", "visible default must retain cents");
      for (const row of added) {
        assert.equal(row.fields.price, 600000.5);
        assert.match(row.messageText, /600,000\.5 ريال/);
      }
      assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
      results.push({ label, passed: true, observed, errors, blocked });
      console.log(`PASS ${label}`);
    } catch (error) {
      results.push({ label, passed: false, error: error.message, observed, errors, blocked });
      console.error(`FAIL ${label}: ${error.message}`);
      await page.screenshot({ path: path.join(out, `${label}.png`), fullPage: true });
    } finally { await context.close(); }
  }
  for (const raw of ["٦٠٠٬٠٠٠٫٥٠", "600,000.50", "600ريال000"]) {
    const label = `counter-${results.length}`;
    const { context, page, blocked, errors } = await contextFor();
    let observed;
    try {
      const created = await callWorker(h, "/os/proposals/create", { officeId: OFFICE_A, journeyId, kind: "PRICE", recipients: ["owner"], fields: { price: 1000000 }, requestKey: label });
      const proposal = created.proposals[0];
      const before = h.store.get(`${proposalPath}/${proposal.proposalId}`);
      await page.goto(proposal.replyUrl);
      await page.locator('[data-option="counter"]').click();
      await page.locator('[name="text"]').fill(raw);
      await page.locator("h1").click(); // blur exercises the real reply-page formatter
      const afterBlur = await page.locator('[name="text"]').inputValue();
      await page.getByRole("button", { name: "إرسال الرد", exact: true }).click();
      await page.waitForFunction(() => document.body.textContent.includes("تم حفظ ردك") || document.querySelector('.os-alert.bad:not([hidden])'));
      const saved = h.store.get(`${proposalPath}/${proposal.proposalId}`);
      observed = { raw, afterBlur, reply: saved.reply || null };
      if (raw === "600ريال000") {
        assert.equal(afterBlur, raw, "invalid reply must not be rewritten");
        assert.deepEqual(saved, before, "invalid reply must not alter the proposal");
      } else {
        assert.equal(afterBlur, "600,000.5");
        assert.equal(saved.reply.text, "600000.5");
      }
      assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
      results.push({ label, passed: true, observed, errors, blocked });
      console.log(`PASS ${label}`);
    } catch (error) {
      results.push({ label, passed: false, error: error.message, observed, errors, blocked });
      console.error(`FAIL ${label}: ${error.message}`);
      await page.screenshot({ path: path.join(out, `${label}.png`), fullPage: true });
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await new Promise(resolve => h.server.close(resolve));
  await fs.writeFile(path.join(out, "results.json"), JSON.stringify({ results }, null, 2));
}
assert.equal(results.length, 7);
assert.equal(results.filter(row => !row.passed).length, 0, "Every proposal/counteroffer case must pass");
