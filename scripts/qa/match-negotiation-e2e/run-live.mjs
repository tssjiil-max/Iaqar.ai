// Local QA only: client + owner + broker live negotiation in real Chromium against the
// real Worker (in-memory Firestore double). Three browser contexts, no shared state.
//   node scripts/qa/match-negotiation-e2e/run-live.mjs [repoRoot] [outDir]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startHarness, OFFICE, REQUEST_ID, OFFER_ID } from "./server.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "@playwright/test");
const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
const outDir = process.argv[3] || path.join(root, "test-results", "match-negotiation-live");
fs.mkdirSync(outDir, { recursive: true });
const { notificationRoutes, notificationDedupeKey } = await import(path.join(root, "public/js/match-event-domain.js"));

const results = [];
const errors = [];
const assert = (cond, message) => { if (!cond) throw new Error(message); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeout = 12000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn().catch(() => null);
    if (last) return last;
    await sleep(200);
  }
  throw new Error(`timeout: ${label}`);
}
async function step(group, id, title, fn, shot) {
  try {
    results.push({ group, id, title, pass: true, detail: await fn() });
  } catch (error) {
    results.push({ group, id, title, pass: false, detail: String(error?.message || error) });
  }
  if (shot) await shot.screenshot({ path: path.join(outDir, `${group}-${id}.png`) }).catch(() => {});
}

const browser = await chromium.launch();
const newPage = async (context) => {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  return page;
};

// ---------------------------------------------------------------- live scenario
const h = await startHarness({ root });
const base = `http://127.0.0.1:${h.port}`;
const matchId = h.match.id;
const opPath = `offices/${OFFICE}/operations/${h.matchOperation.id}`;
const events = () => JSON.parse(h.store.get(opPath)?.negotiationActivityJson || "[]");
const brokerContext = await browser.newContext({ viewport: { width: 420, height: 900 }, locale: "ar-SA" });
const broker = await newPage(brokerContext);
const ws = (sel = "") => `.cv2-match-workspace ${sel}`;
const unreadOnCard = () => broker.evaluate(() => {
  const badge = document.querySelector('#opportunityBankList [data-cv2-inbox-item][data-opportunity-id="opp_request_e2e"] [data-unread-updates]');
  return badge ? { count: Number(badge.getAttribute("data-unread-updates")), text: badge.textContent.trim() } : { count: 0, text: "" };
});
const workspaceLog = () => broker.evaluate(() => [...document.querySelectorAll(".cv2-match-workspace [data-negotiation-log] li .cv2-neg-log-title")].map((n) => n.textContent.trim()));
const openWorkspace = async () => {
  await broker.click('[data-bank-action-filter="all"]');
  const card = broker.locator('#opportunityBankList [data-cv2-inbox-item][data-opportunity-id="opp_request_e2e"]');
  await card.waitFor({ state: "visible", timeout: 10000 });
  await card.locator("[data-opportunity-primary-action]").click();
  await broker.locator(ws("[data-match-negotiation-page]")).waitFor({ state: "visible", timeout: 10000 });
};
const closeWorkspace = async () => { await broker.click(ws("[data-close-match-workspace]")); await sleep(300); };

await broker.goto(`${base}/`);
await broker.waitForFunction(() => window.__e2e?.ready, null, { timeout: 20000 });
// Broker sends both links (this mints the party sessions and gives the review URLs).
await openWorkspace();
for (const party of ["client", "owner"]) {
  const before = await broker.evaluate(() => window.__e2e.whatsapp.length);
  await broker.click(ws(`[data-party-send="${party}"]`));
  await waitFor(() => broker.evaluate((n) => window.__e2e.whatsapp.length > n, before), `${party} link`);
}
const links = await broker.evaluate(() => window.__e2e.whatsapp.map((w) => (w.text.match(/https?:\/\/\S*cv2Party=\S+/) || [""])[0]));
const [clientUrl, ownerUrl] = links;
await closeWorkspace();

const clientContext = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: "ar-SA" });
const ownerContext = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: "ar-SA" });
const client = await newPage(clientContext);
const owner = await newPage(ownerContext);
const partyCurrent = (page) => page.evaluate(() => document.querySelector("[data-party-live-current] strong")?.textContent.trim() || "");
const partyHistory = (page) => page.evaluate(() => [...document.querySelectorAll("[data-party-live-history] li strong")].map((n) => n.textContent.trim()));
const choose = async (page, id, label) => {
  await page.click(`[data-party-live-choice="${id}"]`);
  await waitFor(async () => (await partyCurrent(page)) === label, `current = ${label}`);
};

await step("CLIENT", "1", "فتح الرابط", async () => {
  assert(clientUrl && clientUrl.includes("cv2Party="), `no client link: ${clientUrl}`);
  await client.goto(clientUrl.replace(/^https?:\/\/[^/]+/, base));
  await client.locator("[data-party-live]").waitFor({ state: "visible", timeout: 15000 });
  await waitFor(async () => events().some((e) => e.eventType === "LINK_OPENED" && e.actorType === "client"), "LINK_OPENED client");
  return { linkOpened: true };
}, client);
await step("CLIENT", "2", "مهتم", () => choose(client, "interested", "مهتم").then(() => ({ current: "مهتم" })), client);
await step("CLIENT", "3", "يحتاج وقت", () => choose(client, "needs_time", "يحتاج وقت").then(() => ({ current: "يحتاج وقت" })), client);
await step("CLIENT", "4", "موافق مبدئيًا", () => choose(client, "preliminary_agreement", "موافق مبدئيًا").then(() => ({ current: "موافق مبدئيًا" })), client);
await step("CLIENT", "5-6", "Refresh وآخر حالة باقية والرابط ACTIVE", async () => {
  await client.reload();
  await client.locator("[data-party-live]").waitFor({ state: "visible", timeout: 15000 });
  const current = await partyCurrent(client);
  assert(current === "موافق مبدئيًا", `after refresh ${current}`);
  const buttons = await client.locator("[data-party-live-choice]").count();
  assert(buttons === 6, `choices after refresh ${buttons}`);
  const clientEvents = events().filter((e) => e.actorType === "client" && e.eventType !== "LINK_OPENED").map((e) => e.eventType);
  assert(clientEvents.join() === "CLIENT_INTERESTED,CLIENT_NEEDS_TIME,CLIENT_PRELIMINARY_AGREEMENT", clientEvents.join());
  assert(events().filter((e) => e.eventType === "LINK_OPENED" && e.actorType === "client").length === 1, "refresh must not add LINK_OPENED");
  return { current, choicesStillAvailable: buttons, history: clientEvents };
}, client);

await step("BROKER", "1-2", "Live update + unread badge بدون فتح المطابقة", async () => {
  const unread = await waitFor(async () => { const u = await unreadOnCard(); return u.count >= 4 ? u : null; }, "unread 4 on bank card");
  assert(unread.text === "4 تحديثات جديدة", unread.text);
  return { badge: unread.text, brokerReloaded: false };
}, broker);

await step("OWNER", "1", "فتح الرابط", async () => {
  await owner.goto(ownerUrl.replace(/^https?:\/\/[^/]+/, base));
  await owner.locator("[data-party-live]").waitFor({ state: "visible", timeout: 15000 });
  await waitFor(async () => events().some((e) => e.eventType === "LINK_OPENED" && e.actorType === "owner"), "LINK_OPENED owner");
  return { linkOpened: true };
}, owner);
await step("OWNER", "2", "مهتم", () => choose(owner, "interested", "مهتم").then(() => ({ current: "مهتم" })), owner);
await step("OWNER", "3", "يحتاج وقت", () => choose(owner, "needs_time", "يحتاج وقت").then(() => ({ current: "يحتاج وقت" })), owner);
await step("OWNER", "4-5", "Refresh والحالة باقية", async () => {
  await owner.reload();
  await owner.locator("[data-party-live]").waitFor({ state: "visible", timeout: 15000 });
  const current = await partyCurrent(owner);
  assert(current === "يحتاج وقت", `after refresh ${current}`);
  return { current };
}, owner);
await step("CLIENT", "live", "صفحة العميل تتحدث فورًا بتحديث المالك", async () => {
  await waitFor(async () => (await partyHistory(client)).includes("المالك طلب وقتًا للرد"), "owner update on client page", 10000);
  return { history: (await partyHistory(client)).slice(0, 3) };
}, client);

await step("BROKER", "3-4", "فتح المطابقة يصفّر unread لهذه المطابقة", async () => {
  const before = await waitFor(async () => { const u = await unreadOnCard(); return u.count >= 7 ? u : null; }, "unread 7");
  await openWorkspace();
  await waitFor(async () => Boolean(h.store.get(opPath)?.brokerSeenAt), "brokerSeenAt persisted");
  await closeWorkspace();
  const after = await waitFor(async () => { const u = await unreadOnCard(); return u.count === 0 ? u : null; }, "unread 0");
  const kept = events().filter((e) => e.actorType === "client" || e.actorType === "owner").length;
  assert(kept === 7, `events kept ${kept}`);
  return { before: before.text, after: after.count, eventsKept: kept };
}, broker);

await step("BROKER", "5", "سجل الإجراءات يحتوي أحداث العميل والمالك + live أثناء المشاهدة", async () => {
  await openWorkspace();
  const log = await workspaceLog();
  for (const line of ["العميل فتح رابط المطابقة", "العميل اختار: مهتم", "العميل طلب وقتًا للرد", "العميل اختار: موافق مبدئيًا", "المالك فتح رابط المطابقة", "المالك اختار: مهتم", "المالك طلب وقتًا للرد"]) {
    assert(log.includes(line), `missing log line: ${line}`);
  }
  const lastUpdate = await broker.evaluate(() => document.querySelector(".cv2-match-workspace [data-last-update]")?.textContent.trim() || "");
  // Live while viewing: the client asks for a viewing; the open workspace updates without reload.
  await client.click('[data-party-live-choice="viewing"]');
  await waitFor(async () => (await workspaceLog()).includes("العميل طلب معاينة"), "live event in open workspace", 10000);
  await waitFor(async () => (h.store.get(opPath)?.brokerSeenAt || "") >= (events().at(-1)?.createdAt || "z"), "auto-seen while viewing");
  await closeWorkspace();
  const unread = await waitFor(async () => { const u = await unreadOnCard(); return u.count === 0 ? u : null; }, "still 0 after live event");
  return { logLines: log.length, lastUpdate, liveEvent: "العميل طلب معاينة", unreadAfter: unread.count };
}, broker);

await step("BROKER", "msg", "رسالة الوسيط تصل صفحة العميل فورًا", async () => {
  await openWorkspace();
  await broker.fill(ws("[data-broker-message]"), "موعد المعاينة الخميس 5 مساءً");
  await broker.selectOption(ws("[data-broker-audience]"), "client");
  await broker.click(ws('[data-broker-action="send_message"]'));
  await waitFor(async () => (await partyHistory(client)).includes("رسالة من الوسيط"), "broker message on client page", 10000);
  const ownerHas = (await partyHistory(owner)).includes("رسالة من الوسيط");
  assert(!ownerHas, "owner must not see a client-only message");
  await closeWorkspace();
  return { clientSees: true, ownerSees: ownerHas };
}, client);

await step("AGREEMENT", "1", "تعديل الاتفاق من الوسيط ومن العميل: AGREEMENT_UPDATED + الحالة الحالية", async () => {
  await openWorkspace();
  await broker.selectOption(ws("[data-agreement-field]"), "price");
  await broker.fill(ws("[data-agreement-value]"), "860,000 ريال");
  await broker.click(ws('[data-broker-action="agreement_update"]'));
  await waitFor(() => client.evaluate(() => document.querySelector('[data-party-agreement-current="price"] dd')?.textContent.trim() === "860,000 ريال"), "price on client page", 10000);
  await client.selectOption("[data-party-agreement-field]", "paymentMethod");
  await client.fill("[data-party-agreement-value]", "تمويل بنكي");
  await client.click("[data-party-agreement-submit]");
  await waitFor(() => broker.evaluate(() => document.querySelector('.cv2-match-workspace [data-agreement-field-value="paymentMethod"] dd')?.textContent.trim() === "تمويل بنكي"), "payment on broker workspace", 10000);
  await closeWorkspace();
  const updates = events().filter((e) => e.eventType === "AGREEMENT_UPDATED").map((e) => `${e.actorType}:${e.payload.field}=${e.payload.value}`);
  assert(updates.length === 2, updates.join());
  const state = JSON.parse(h.store.get(opPath).matchStateJson || "{}").agreement;
  assert(state.price.value === "860,000 ريال" && state.paymentMethod.value === "تمويل بنكي", JSON.stringify(state));
  return { history: updates, current: { price: state.price.value, paymentMethod: state.paymentMethod.value } };
}, broker);

await step("BROKER", "6", "FCM payload مرة واحدة فقط لكل حدث", async () => {
  // Re-render/refresh/reconnect noise: reload all pages; nothing new must be sent.
  const fcmBefore = h.store.fcm.length;
  await Promise.all([broker.reload(), client.reload(), owner.reload()]);
  await broker.waitForFunction(() => window.__e2e?.ready, null, { timeout: 20000 });
  await sleep(3500);
  const partyEvents = events().filter((e) => (e.actorType === "client" || e.actorType === "owner") && e.eventType !== "LINK_OPENED");
  const fcmDispatches = h.store.list(`offices/${OFFICE}/notificationDispatches`).filter((d) => d.channel === "fcm");
  assert(fcmDispatches.length === partyEvents.length, `fcm dispatches ${fcmDispatches.length} vs events ${partyEvents.length}`);
  assert(new Set(fcmDispatches.map((d) => d.eventId)).size === fcmDispatches.length, "duplicate fcm dispatch");
  assert(h.store.fcm.length === partyEvents.length, `fcm sends ${h.store.fcm.length} vs events ${partyEvents.length}`);
  assert(h.store.fcm.length === fcmBefore, "reload triggered a new FCM send");
  return { partyEvents: partyEvents.length, fcmDispatches: fcmDispatches.length, fcmSends: h.store.fcm.length, sample: fcmDispatches[0]?.body };
});

await step("BROKER", "7", "WhatsApp payload للطرف الآخر مرة واحدة فقط", async () => {
  const all = events();
  const expected = all.flatMap((e) => notificationRoutes(e).filter((r) => r.channel === "whatsapp").map((r) => notificationDedupeKey({ matchId, eventId: e.eventId, recipient: r.recipient, channel: r.channel })));
  const dispatches = h.store.list(`offices/${OFFICE}/notificationDispatches`).filter((d) => d.channel === "whatsapp");
  assert(dispatches.length === expected.length, `whatsapp dispatches ${dispatches.length} vs expected ${expected.length}`);
  assert(new Set(dispatches.map((d) => d.dedupeKey)).size === dispatches.length, "duplicate whatsapp dispatch");
  assert(dispatches.every((d) => d.status === "PENDING_BROKER_HANDOFF"), `statuses ${[...new Set(dispatches.map((d) => d.status))]}`);
  // Broker opens one handoff from the workspace: WHATSAPP_OPENED only.
  await openWorkspace();
  const handoff = broker.locator(ws("[data-whatsapp-handoff]")).first();
  await handoff.waitFor({ state: "visible", timeout: 8000 });
  const dispatchId = await handoff.getAttribute("data-whatsapp-handoff");
  await handoff.click();
  await waitFor(async () => h.store.get(`offices/${OFFICE}/notificationDispatches/${dispatchId}`)?.status === "WHATSAPP_OPENED", "handoff opened");
  await closeWorkspace();
  const statuses = h.store.list(`offices/${OFFICE}/notificationDispatches`).filter((d) => d.channel === "whatsapp").map((d) => d.status);
  assert(!statuses.some((s) => /SENT|DELIVERED|READ/.test(s)), "claimed delivery");
  return { whatsappPayloads: dispatches.length, byRecipient: dispatches.map((d) => `${d.eventType}→${d.recipient}`), openedOne: dispatchId };
}, broker);

// Close the pages before the server so background polls do not hit a closed port.
await Promise.all([brokerContext.close(), clientContext.close(), ownerContext.close()]);
h.server.close();

// ---------------------------------------------------------------- fixtures
async function fixture(kind) {
  const f = await startHarness({ root, extraOperations: 0 });
  const fbase = `http://127.0.0.1:${f.port}`;
  const token = await (await fetch(`${fbase}/token`)).text();
  const call = async (p, body) => {
    const r = await fetch(`${fbase}/worker${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const tokens = {};
  for (const side of ["client", "owner"]) {
    tokens[side] = (await call("/party/sessions", { officeId: OFFICE, matchId: f.match.id, party: side, offerId: OFFER_ID, requestId: REQUEST_ID })).body.token;
  }
  await fetch(`${fbase}/worker/party/sessions/${encodeURIComponent(tokens.client)}/event`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ choiceId: "interested", clientEventId: "fx-1" }) });
  let closing;
  if (kind === "CLOSED_NO_AGREEMENT") {
    closing = await call("/workflow/action", { officeId: OFFICE, recordId: f.match.id, action: "close_match", note: "لا اتفاق" });
  } else {
    f.store.patch(`offices/${OFFICE}/matches/${f.match.id}`, { livingStage: "VIEWING_COMPLETED", viewingCompletedAt: "2026-09-29T08:00:00Z", viewingOutcome: "SERIOUS", seriousIntentConfirmed: true });
    closing = await call("/workflow/action", { officeId: OFFICE, recordId: f.match.id, action: "create_deal" });
  }
  assert(closing.status === 200, `${kind} fixture: ${JSON.stringify(closing.body)}`);
  const context = await browser.newContext({ viewport: { width: 400, height: 860 }, locale: "ar-SA" });
  const out = {};
  for (const side of ["client", "owner"]) {
    const page = await newPage(context);
    await page.goto(`${fbase}/?cv2Party=${encodeURIComponent(tokens[side])}`);
    await page.locator("[data-party-live]").waitFor({ state: "visible", timeout: 15000 });
    out[side] = await page.evaluate(() => ({
      readonly: document.querySelector("[data-party-live]")?.getAttribute("data-party-readonly") || "",
      finalLabel: document.querySelector("[data-party-live-final]")?.textContent.trim() || "",
      choiceButtons: document.querySelectorAll("[data-party-live-choice]").length,
      agreementForm: document.querySelectorAll("[data-party-agreement-form]").length,
      decisionForms: document.querySelectorAll("[data-party-bundle-submit], [data-party-action]").length,
      history: [...document.querySelectorAll("[data-party-live-history] li strong")].map((n) => n.textContent.trim())
    }));
    await page.screenshot({ path: path.join(outDir, `FIXTURE-${kind}-${side}.png`) }).catch(() => {});
    const blocked = await page.evaluate(async (t) => (await fetch(`/worker/party/sessions/${encodeURIComponent(t)}/event`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ choiceId: "needs_time" }) })).status, tokens[side]);
    out[side].newChoiceStatus = blocked;
  }
  await context.close();
  const history = JSON.parse(f.store.get(`offices/${OFFICE}/matches/${f.match.id}`).negotiationActivityJson || "[]");
  f.server.close();
  return { out, history };
}

for (const kind of ["CLOSED_NO_AGREEMENT", "AGREED"]) {
  await step("FIXTURE", kind, `${kind} → الطرفان Read Only`, async () => {
    const { out, history } = await fixture(kind);
    for (const side of ["client", "owner"]) {
      const v = out[side];
      assert(v.readonly === kind, `${side} readonly=${v.readonly}`);
      assert(v.choiceButtons === 0 && v.agreementForm === 0 && v.decisionForms === 0, `${side} still editable ${JSON.stringify(v)}`);
      assert(v.newChoiceStatus === 409, `${side} new choice status ${v.newChoiceStatus}`);
    }
    assert(out.client.history.includes("اخترت: مهتم"), "negotiation history lost");
    assert(history.some((e) => e.eventType === "CLIENT_INTERESTED"), "event history lost");
    return { client: out.client, owner: { readonly: out.owner.readonly, finalLabel: out.owner.finalLabel }, historyKept: history.length };
  });
}

fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ results, errors }, null, 2));
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"} ${r.group} ${r.id} ${r.title}${r.pass ? "" : ` — ${r.detail}`}`);
console.log("page errors:", errors.length ? errors.slice(0, 5) : "none");
await browser.close();
process.exit(results.every((r) => r.pass) && !errors.length ? 0 : 1);
