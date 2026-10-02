// التعاون بين الوسطاء — browser check on the local harness. Runs the real Worker rules
// (worker/src/cooperation-brokers-service.js) over the harness store; /cooperation/workflow is
// simulated with the shared transition rules (the harness has no Google credentials).
// Office A (REQUEST side) ↔ Office B (OFFER side); a cooperation of office A with a third office is
// seeded to prove office B never sees it.
//   node scripts/qa/office-os/community.e2e.mjs   (OUT_DIR for screenshots)
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os/community");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, OWNER_A, OWNER_B, BROKER_A2, OFFICE_A, OFFICE_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));

const h = await startOfficeOsHarness();

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const checks = [];
const errors = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };
const until = async (fn, label, timeout = 6000) => { const t = Date.now(); while (Date.now() - t < timeout) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } throw new Error(`timeout: ${label}`); };

async function openAs(uid, hash, officeId = OFFICE_A) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true });
  await ctx.addInitScript(([u, o]) => { localStorage.setItem("harness.uid", u); localStorage.setItem("iaqar.officeId", o); }, [uid, officeId]);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: h.origin }).catch(() => {});
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${h.origin}/#/${hash}`);
  return page;
}
async function shot(page, name) {
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  check(`no horizontal scroll: ${name}`, overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

const { runCooperationBrokerAction } = await import(path.join(ROOT, "worker/src/cooperation-brokers-service.js"));
const { applyCooperationWorkflowTransition } = await import(path.join(ROOT, "public/js/cooperation-workflow-domain.js"));
const OFFICE_C = "office-gamma";

/* Harness store adapter for the service (values wrapped like Firestore fields). */
const wrap = (v) => ({ v });
const deps = {
  getFirestoreDocument: async ({ segments }) => { const d = h.store.get(segments.join("/")); return d ? { fields: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, wrap(v)])) } : null; },
  setFirestoreDocument: async ({ segments, fields }) => { h.store.patch(segments.join("/"), Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.v]))); },
  firestoreFieldsToJs: (fields) => Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.v])),
  firestoreHelpers: { firestoreString: wrap, firestoreInteger: wrap, firestoreTimestamp: (d) => wrap(d.toISOString()), firestoreBoolean: wrap }
};
const calls = [];
async function simulateWorker(page, officeId, uid) {
  await page.route("**/worker/cooperation/workflow", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    calls.push({ path: "workflow", ...body });
    const row = h.store.get(`cooperationRequests/${body.cooperationId}`);
    const applied = applyCooperationWorkflowTransition(row, body.action, { actorOfficeId: officeId, actorUid: uid });
    if (applied.ok && applied.patch) h.store.patch(`cooperationRequests/${body.cooperationId}`, applied.patch);
    await route.fulfill({ status: applied.ok ? 200 : 400, contentType: "application/json", body: JSON.stringify({ ok: applied.ok, duplicate: Boolean(applied.duplicate), message: applied.message }) });
  });
  await page.route("**/worker/cooperation/brokers", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    calls.push({ path: "brokers", ...body });
    const result = await runCooperationBrokerAction({ projectId: "p", actorOfficeId: body.officeId, actorUid: uid, cooperationId: body.cooperationId, action: body.action, brokerId: body.brokerId, shares: body.shares, accessToken: "t", deps });
    await route.fulfill({ status: result.ok ? 200 : (result.status || 400), contentType: "application/json", body: JSON.stringify(result.ok ? { ok: true, ...result } : { error: result.error, message: result.message }) });
  });
}

const base = (id, over) => ({ id, originatingOfficeId: OFFICE_A, originatingOfficeName: "مكتب سلطان العقاري", originatingBrokerId: OWNER_A, targetOfficeId: OFFICE_B, targetOfficeName: "مكتب الأفق للعقار",
  clientOfficeId: OFFICE_A, propertyOfficeId: OFFICE_B, status: "SUGGESTED", currentStage: "COOPERATION_MATCH_FOUND",
  originListing: { propertyType: "أرض", purpose: "sale", district: "السكب", city: "المدينة المنورة", priceOrBudget: 700000 }, updatedAt: "2026-10-01T10:00:00.000Z", ...over });
h.store.seed("cooperationRequests/c-main", base("c-main", {}));
h.store.seed("cooperationRequests/c-reject", base("c-reject", { status: "PENDING", currentStage: "WAITING_PARTNER", updatedAt: "2026-10-01T09:00:00.000Z" }));
h.store.seed("cooperationRequests/c-gamma", base("c-gamma", { targetOfficeId: OFFICE_C, targetOfficeName: "مكتب ثالث", status: "ACCEPTED", currentStage: "CUSTOMER_ACTION" }));
// Daily-task rows (the Worker writes one living task per office per cooperation).
const taskMeta = (over) => ({ cooperationTaskId: "c-reject", originatingOfficeId: OFFICE_A, targetOfficeId: OFFICE_B, clientOfficeId: OFFICE_A, propertyOfficeId: OFFICE_B, status: "PENDING", currentStage: "WAITING_PARTNER", ...over });
h.store.seed(`offices/${OFFICE_B}/operations/op-b`, { type: "COOPERATION_MATCH", status: "OPEN", titleText: "طلب تعاون جديد", metadata: taskMeta({}) });
h.store.seed(`offices/${OFFICE_A}/operations/op-a`, { type: "COOPERATION_MATCH", status: "OPEN", titleText: "طلب تعاون", metadata: taskMeta({}) });

let a; let b;
try {
  a = await openAs(OWNER_A, "office");
  await simulateWorker(a, OFFICE_A, OWNER_A);
  await a.locator("[data-community-entry]").waitFor();
  check("office home has the «التعاون» card", (await a.locator("[data-community-entry]").innerText()).includes("التعاون"));
  await until(async () => (await a.locator("[data-coop-summary]").innerText()).includes("بانتظار الرد"), "summary badge");
  check("the card shows a light summary only", /بانتظار الرد/.test(await a.locator("[data-coop-summary]").innerText()), await a.locator("[data-coop-summary]").innerText());
  await shot(a, "01-office-card");

  // A: no internal match → the suggestion is on the page; A asks office B (one office at a time).
  await a.locator("[data-community-entry]").click();
  await a.locator("[data-coop]").first().waitFor();
  check("page title and subtitle", (await a.locator(".os-page-title").innerText()) === "التعاون بين الوسطاء" && (await a.locator(".os-sub").first().innerText()).includes("وسيط العرض ووسيط الطلب"));
  check("only three states: نشط · بانتظار رد · السجل", (await a.locator("[data-tab]").allInnerTexts()).map((s) => s.replace(/\d+/g, "").trim()).join("|") === "نشط|بانتظار رد|السجل");
  check("A (a party) sees its cooperation with the third office as نشط", (await a.locator('[data-coop="c-gamma"]').count()) === 1);
  await a.locator('[data-tab="waiting"]').click();
  check("card shows office, property · district, and whose turn it is", (await a.locator('[data-coop="c-main"]').innerText()).includes("مكتب الأفق للعقار") && (await a.locator('[data-coop="c-main"]').innerText()).includes("السكب"));
  await shot(a, "02-community-a");
  await a.locator('[data-coop="c-main"] [data-coop-action="request_cooperation"]').click();
  await until(() => h.store.get("cooperationRequests/c-main").status === "PENDING", "request sent");
  check("A's request goes to one office (REQUEST once)", calls.filter((c) => c.path === "workflow" && c.action === "REQUEST").length === 1);

  // B: receives, accepts (double click must not duplicate).
  b = await openAs(OWNER_B, "community", OFFICE_B);
  await simulateWorker(b, OFFICE_B, OWNER_B);
  await b.locator('[data-coop="c-main"]').waitFor();
  check("B sees the request as «مطلوب منك الآن»", (await b.locator('[data-coop="c-main"]').innerText()).includes("مطلوب منك الآن"));
  check("B never sees A's cooperation with the third office", (await b.locator('[data-coop="c-gamma"]').count()) === 0);
  check("no contact data on cards", !/05\d{8}/.test(await b.locator(".os-task-list").innerText()));
  await shot(b, "03-community-b-incoming");
  await b.locator('[data-coop="c-main"] [data-coop-action="accept_cooperation"]').dblclick();
  await until(() => h.store.get("cooperationRequests/c-main").status === "ACCEPTED", "accepted");
  check("accept (double click) creates one accepted cooperation, same id", calls.filter((c) => c.action === "ACCEPT").length <= 2 && h.store.get("cooperationRequests/c-main").targetBrokerId === OWNER_B && (await b.locator('[data-coop="c-main"]').count()) <= 1);
  await b.locator('[data-tab="active"]').click();
  await b.locator('[data-coop="c-main"]').waitFor();
  check("accepted cooperation is under نشط for B", (await b.locator('[data-tab="active"] .n').innerText()) === "1");

  // Rejecting lets A move on to another office; B's «c-reject» only offers accept / not suitable.
  await b.locator('[data-tab="waiting"]').click();
  await b.locator('[data-coop="c-reject"] [data-coop-action="reject_cooperation"]').click();
  await b.locator(".os-dialog").getByRole("button", { name: "غير مناسب" }).click();
  await until(() => h.store.get("cooperationRequests/c-reject").status === "REJECTED", "rejected");
  check("not suitable ends that cooperation (history), nothing else changes", h.store.get("cooperationRequests/c-main").status === "ACCEPTED");

  // A: sees it active; brokers, commission and the third broker.
  await a.reload();
  await a.locator('[data-tab="active"]').click();
  await a.locator('[data-coop="c-main"]').waitFor();
  await a.locator('[data-coop="c-main"] [data-coop-details-open]').click();
  await a.locator("[data-coop-details]").waitFor();
  const roles = await a.locator("[data-broker-role]").evaluateAll((els) => els.map((e) => e.getAttribute("data-broker-role")));
  check("two brokers by default: وسيط العرض + وسيط الطلب", roles.join() === "PROPERTY_BROKER,REQUEST_BROKER");
  check("default agreement is 50% / 50%", (await a.locator('[data-share="propertyBrokerShare"]').innerText()).includes("50%") && (await a.locator('[data-share="requestBrokerShare"]').innerText()).includes("50%"));
  check("«وسيط مُحيل» is nowhere", !(await a.locator("[data-coop-details]").innerText()).includes("مُحيل"));
  await shot(a, "04-details");
  await a.locator("[data-edit-commission]").click();
  await a.fill('input[name="propertyBrokerShare"]', "70");
  check("a total other than 100 cannot be saved", await a.locator("[data-save-commission]").isDisabled());
  await a.fill('input[name="propertyBrokerShare"]', "60"); await a.fill('input[name="requestBrokerShare"]', "40");
  await a.locator("[data-save-commission]").click();
  await until(() => h.store.get("cooperationRequests/c-main").propertyBrokerShare === 60, "commission saved");
  const saved = h.store.get("cooperationRequests/c-main");
  check("agreement saved with who and when", saved.requestBrokerShare === 40 && saved.commissionAgreementUpdatedBy === OWNER_A && Boolean(saved.commissionAgreementUpdatedAt));

  await a.locator("[data-add-participating]").click();
  await a.locator('select[name="participatingBroker"]').waitFor();
  check("participating broker comes from A's own office", (await a.locator('select[name="participatingBroker"] option').allInnerTexts()).some((t) => t.includes("نواف")));
  await a.fill('input[name="propertyBrokerShare"]', "50");
  check("third-broker shares must also total 100", await a.locator("[data-save-participating]").isDisabled());
  await a.fill('input[name="propertyBrokerShare"]', "45"); await a.fill('input[name="requestBrokerShare"]', "35"); await a.fill('input[name="participatingBrokerShare"]', "20");
  await a.locator('select[name="participatingBroker"]').selectOption(BROKER_A2);
  await a.locator("[data-save-participating]").click();
  await a.locator("[data-max-brokers]").waitFor();
  const rolesAfter = await a.locator("[data-broker-role]").evaluateAll((els) => els.map((e) => e.getAttribute("data-broker-role")));
  check("third broker added as «وسيط مشارك»", rolesAfter.join() === "PROPERTY_BROKER,REQUEST_BROKER,PARTICIPATING_BROKER" && (await a.locator("[data-coop-details]").innerText()).includes("وسيط مشارك"));
  check("at three brokers: «تم الوصول للحد الأعلى للتعاون», no add button", (await a.locator("[data-max-brokers]").innerText()).includes("تم الوصول للحد الأعلى للتعاون") && (await a.locator("[data-add-participating]").count()) === 0);
  await shot(a, "05-three-brokers");
  // The fourth is refused by the service itself (not only hidden in the UI).
  const fourth = await runCooperationBrokerAction({ projectId: "p", actorOfficeId: OFFICE_B, actorUid: OWNER_B, cooperationId: "c-main", action: "ADD_PARTICIPATING_BROKER", brokerId: OWNER_B, shares: { propertyBrokerShare: 40, requestBrokerShare: 40, participatingBrokerShare: 20 }, accessToken: "t", deps });
  check("a fourth broker is refused by the service", fourth.ok === false && fourth.error === "max_brokers");
  const outsider = await runCooperationBrokerAction({ projectId: "p", actorOfficeId: OFFICE_C, actorUid: "uid-c", cooperationId: "c-main", action: "SET_COMMISSION", shares: { propertyBrokerShare: 10, requestBrokerShare: 80, participatingBrokerShare: 10 }, accessToken: "t", deps });
  check("an office that is not a party is refused (403)", outsider.ok === false && outsider.status === 403 && h.store.get("cooperationRequests/c-main").propertyBrokerShare === 45);

  // Daily Tasks: only what needs action.
  await b.goto(`${h.origin}/#/tasks`);
  await b.locator(".os-task-list").waitFor();
  await b.waitForTimeout(800);
  check("B (has something to do) sees the cooperation task in Daily Tasks", (await b.locator('[data-task="op-b"]').count()) === 1);
  await a.goto(`${h.origin}/#/tasks`);
  await a.locator(".os-task-list").waitFor();
  await a.waitForTimeout(800);
  check("A (only waiting) gets no informational cooperation task", (await a.locator('[data-task="op-a"]').count()) === 0);
  await shot(b, "06-b-daily-tasks");

  // History.
  await b.goto(`${h.origin}/#/community`);
  await b.locator('[data-tab="history"]').click();
  check("declined cooperation is in السجل", (await b.locator('[data-coop="c-reject"]').count()) === 1);
} catch (error) {
  check("cooperation journey completed", false, String(error?.message || error).split("\n")[0]);
  for (const p of [a, b]) if (p) console.log(await p.locator(".os-view").innerText().catch(() => "n/a"));
} finally {
  await browser.close();
  h.server.close();
  check("no browser console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} cooperation checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}
