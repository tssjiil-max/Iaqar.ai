// «الاستقبال التلقائي» — live proof on the deployed preview (Staging project, isolated QA offices only).
//
// What Claude in Chrome does at the end of its search, in a real Chromium on the deployed app and Worker, with the
// real Firestore of iaqar-ai-staging:
//   the manager logs in → «ربط هذا المتصفح بـ Claude» (the key is written to this browser only, never shown) → the
//   shortcut text (run code, criteria) → the assistant opens  /scout-inbox.html#c=<code>&ingest=<batch>  → the page
//   sends by itself → saved in scoutFeed → merged, matched against the office's request → shown on the broker's scout
//   page. Then: a retry, the same ads again, a site whose terms forbid collecting, another site opening the page with
//   its own results, no key, another office.
//
//   env: PREVIEW_URL, PREVIEW_WORKER_URL, FIREBASE_SERVICE_ACCOUNT_JSON (Staging), OUT_DIR
// Guards: the Staging service account and the preview channel + preview Worker (or the shared Staging pair) only.
// Writes only under offices/qa-office-ingest*, this run's users and their login entries. Never prints a key.
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { parseFirebaseServiceAccountJson } from "../../staging-credentials.mjs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

for (const event of ["uncaughtException", "unhandledRejection"]) {
  process.on(event, (error) => { console.log(`::error title=ingest live script crashed::${String(error?.stack || error).split("\n").slice(0, 3).join(" | ").replace(/%/g, "%25")}`); process.exit(1); });
}
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();

const PROJECT = "iaqar-ai-staging";
const APP = String(process.env.PREVIEW_URL || "").replace(/\/+$/, "");
const WORKER = String(process.env.PREVIEW_WORKER_URL || "").replace(/\/+$/, "");
const OUT = process.env.OUT_DIR || "qa-ingest-live";
fs.mkdirSync(OUT, { recursive: true });
const OFFICE = "qa-office-ingest";
const OFFICE_B = "qa-office-ingest-b";
const RUN = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/[^0-9A-Za-z]/g, "");

const HOST = new URL(APP).hostname;
const onPreview = HOST.startsWith(`${PROJECT}--office-os-preview`) && /^https:\/\/iaqar-intake-os-preview\./.test(WORKER);
const onStaging = HOST === `${PROJECT}--staging-9c4b0k7h.web.app` && /^https:\/\/iaqar-intake-staging\./.test(WORKER);
if (!onPreview && !onStaging) throw new Error(`refusing: ${APP} + ${WORKER} is not the preview or Staging pair`);
const { serviceAccount } = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT);
if (serviceAccount?.project_id !== PROJECT) throw new Error("refusing: not the Staging service account");
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();

const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${String(detail).slice(0, 220)}` : ""}`); };
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const QA_PATH = /^offices\/qa-office-ingest(-b)?(\/|$)/;
const qa = (ref) => { if (!QA_PATH.test(ref.path)) throw new Error(`refusing path ${ref.path}`); return ref; };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RESET = ["scoutSettings", "scoutState", "scoutTasks", "scoutOpportunities", "scoutFeed", "scoutRuns", "scoutIngestKeys", "scoutIngestBatches",
  "opportunities", "matches", "operations", "journeys", "notifications", "members", "auditLogs", "matchCurrentPointers", "contacts", "clients", "owners"];
async function resetOffice(officeId, ownerUid, name) {
  const office = qa(db.collection("offices").doc(officeId));
  const snap = await office.get();
  if (snap.exists && snap.data().isTestFixture !== true) throw new Error(`refusing: ${officeId} exists and is not a test fixture`);
  for (const sub of RESET) await db.recursiveDelete(qa(office.collection(sub)));
  await office.set({
    officeId, officeName: name, officeNameKey: `qa${officeId.replace(/[^a-z]/g, "")}`, brokerName: "وسيط الاختبار", licenseNumber: "1200000000", city: "المدينة المنورة", phone: "0500000000",
    ownerUid, active: true, isTestFixture: true, createdBy: "ingest-live", specialties: ["sale", "rent"], platformOpportunityOnboardingAckAt: new Date(), updatedAt: new Date()
  });
  await office.collection("members").doc(ownerUid).set({ uid: ownerUid, role: "owner", active: true, isTestFixture: true, testRunId: RUN });
}

const users = [];
async function makeUser(role, officeId) {
  const uid = `qa-ingest-${role}-${RUN}`.slice(0, 128);
  const phone = `05998${String(crypto.randomInt(0, 99999)).padStart(5, "0")}`;
  const email = `${uid}@qa-preview.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const dirRef = db.collection("loginDirectory").doc(sha(`+966${phone.slice(1)}`));
  if ((await dirRef.get()).exists) throw new Error("refusing: login directory collision");
  await auth.createUser({ uid, email, password, displayName: `QA ${role}` });
  await dirRef.set({ uid, officeId, email, phone: `+966${phone.slice(1)}`, active: true, isTestFixture: true, testRunId: RUN });
  const user = { uid, phone, password, dirRef, officeId };
  users.push(user);
  return user;
}

// Ten results the way the assistant returns them (pretend listings site; nothing is fetched from any link).
const items = [
  ["1001", "شقة للإيجار في حي العزيزية", "شقة للإيجار 3 غرف وصالة في حي العزيزية بالمدينة المنورة، الإيجار السنوي 32 الف ريال، للتواصل 0551000001", "rent", "شقة", "العزيزية", "", 32000, 140, 3],
  ["1002", "عمارة للبيع مخطط الحمراء هـ4", "عمارة دورين جديدة للبيع، كل دور شقة، مساحة 360 متر، السعر مليون ريال 0551000002", "sale", "عمارة", "الصناعية", "الحمراء هـ4", 1000000, 360, 0],
  ["1003", "أرض للبيع في السكب", "أرض سكنية للبيع حي السكب مساحة 800 متر على شارع 25 السعر 800 الف 0551000003", "sale", "أرض", "السكب", "", 800000, 800, 0],
  ["1004", "فيلا للبيع في الخضراء", "فيلا دورين وملحق في العوينة الخضراء 6 غرف ومصعد السعر مليون و150 الف 0551000004", "sale", "فيلا", "الخضراء", "العوينة", 1150000, 304, 6],
  ["1005", "عمارة للإيجار في شوران", "عمارة كاملة للإيجار في شوران 8 شقق الإيجار السنوي 240 الف ريال 0551000005", "rent", "عمارة", "شوران", "", 240000, 0, 0],
  ["1006", "شقة للبيع في بني بياضة", "شقة للبيع في حي بني بياضة مساحة 178 متر 5 غرف السعر 600 الف ريال 0551000006", "sale", "شقة", "بني بياضة", "", 600000, 178, 5],
  ["1007", "أرض في طيبة مخطط السلام", "أرض سكنية للبيع مخطط السلام حي طيبة 600 متر السعر مليون و100 الف 0551000007", "sale", "أرض", "طيبة", "السلام", 1100000, 600, 0],
  ["1008", "محل للإيجار في الخضراء", "محل تجاري للإيجار على شارع 30 في العوينة الخضراء مساحة 34 متر الإيجار السنوي 20 الف 0551000008", "rent", "محل تجاري", "الخضراء", "", 20000, 34, 0],
  ["1009", "شقة للإيجار في قربان", "شقة للإيجار في حي قربان غرفتين وصالة الإيجار 28 الف سنوي 0551000009", "rent", "شقة", "قربان", "", 28000, 110, 2],
  ["1010", "عمارة للإيجار في العزيزية", "عمارة للإيجار في حي العزيزية 6 شقق الإيجار السنوي 180 الف 0551000010", "rent", "عمارة", "العزيزية", "", 180000, 0, 0]
].map(([id, title, text, tx, propertyType, district, plan, price, area, rooms]) => ({ url: `https://listings.example.sa/ad/${id}?utm_source=claude`, title, text, kind: "OFFER", tx, propertyType, city: "المدينة المنورة", district, ...(plan ? { plan } : {}), price, ...(area ? { area } : {}), ...(rooms ? { rooms } : {}) }));
const restricted = { url: "https://haraj.com.sa/11223344", text: "شقة للإيجار في العزيزية 3 غرف 30 الف سنوي 0551000099", tx: "rent", propertyType: "شقة" };
const badLink = { url: "http://listings.example.sa/ad/9999", text: "شقة للإيجار في العزيزية غرفتين 25 الف سنوي" };
const batch = (batchId, list) => ({ batchId, search: { tx: "rent", propertyTypes: ["شقة", "عمارة"], city: "المدينة المنورة", districts: ["العزيزية"], plans: [] }, items: list });

const office = db.collection("offices").doc(OFFICE);
const feedCount = async (id = OFFICE) => (await qa(db.collection("offices").doc(id).collection("scoutFeed")).where("channel", "==", "AGENT").get()).size;
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true };
const report = { at: new Date().toISOString(), app: APP, worker: WORKER, run: RUN, checks };
const browser = await chromium.launch();

async function openInbox(context, code, body, name) {
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  // Exactly what the assistant does: open one address. No typing, no button.
  await page.goto(`${APP}/scout-inbox.html#c=${code}&ingest=${encodeURIComponent(JSON.stringify(body))}`);
  await page.locator('[data-inbox-result][data-state]').waitFor({ state: "attached" });
  const result = JSON.parse(await page.locator("[data-inbox-result]").textContent());
  const address = page.url();
  await page.screenshot({ path: path.join(OUT, `ingest-${name}.png`), fullPage: true });
  await page.close();
  return { result, address };
}

try {
  const health = await (await fetch(`${WORKER}/health`)).json();
  check(`Worker healthy on ${PROJECT}`, health.backendReady === true && health.deploymentEnvironment === "staging" && health.projectId === PROJECT, JSON.stringify({ projectId: health.projectId, env: health.deploymentEnvironment }));
  const owner = await makeUser("owner", OFFICE);
  const ownerB = await makeUser("ownerb", OFFICE_B);
  await resetOffice(OFFICE, owner.uid, "مكتب اختبار الاستقبال التلقائي");
  await resetOffice(OFFICE_B, ownerB.uid, "مكتب اختبار العزل");

  // 1 the manager logs in and sets the office's scope (type, sale/rent, city, districts) and turns the scout on
  const context = await browser.newContext(mobile);
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  await page.goto(`${APP}/`);
  await page.fill('input[name="phone"]', owner.phone);
  await page.fill('input[name="password"]', owner.password);
  await page.getByRole("button", { name: "دخول المكتب" }).click();
  await page.locator(".ref-office-tools").waitFor();
  const api = (route, body) => page.evaluate(async ([w, r, b]) => {
    const token = await firebase.auth().currentUser.getIdToken();
    const response = await fetch(`${w}${r}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(b) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, [WORKER, route, body]);
  const settings = await api("/os/scout/settings", { officeId: OFFICE, settings: { enabled: true, city: "المدينة المنورة", propertyTypes: ["شقة", "عمارة"], purposes: ["sale", "rent"], districts: ["العزيزية"] } });
  check("scout switched on with the office's scope", settings.status === 200 && settings.body.settings?.enabled === true, String(settings.status));
  const saved = await api("/os/records/save", { officeId: OFFICE, requestKey: `ingest-live-${RUN}`, record: { kind: "REQUEST", purpose: "LEASE_REQUEST", propertyType: "شقة", city: "المدينة المنورة", district: "العزيزية", price: "35,000", contactName: "عميل الاختبار", contactPhone: "0557300001" } });
  check("the office's own request is saved (the other side to match)", saved.status === 200 && Boolean(saved.body.recordId), String(saved.status));
  const requestId = saved.body.recordId;

  // 2 «ربط هذا المتصفح بـ Claude»: the key goes into this browser; the screen shows only the shortcut text
  await page.goto(`${APP}/#/settings/scout`);
  await page.locator("[data-scout-ingest-pair]").click();
  const shortcut = await page.locator("[data-scout-shortcut]").inputValue();
  await page.screenshot({ path: path.join(OUT, "ingest-01-pair-shortcut.png"), fullPage: true });
  const code = (shortcut.match(/#c=([a-z0-9]{8,16})&ingest=/) || [])[1] || "";
  check("pairing shows the shortcut text with a run code and the office's criteria", Boolean(code) && /شقة أو عمارة/.test(shortcut) && /المدينة المنورة/.test(shortcut) && /العزيزية/.test(shortcut) && /حراج/.test(shortcut));
  check("the key is never shown on the screen or in the shortcut", !/iqk\./.test(shortcut) && !(await page.content()).includes("iqk."));
  const pairing = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("iaqar.scoutInbox.pair") || "null"); } catch (_) { return null; } });
  check("the key is kept in this browser only", /^iqk\.qa-office-ingest\.[a-z0-9]{8,24}\.[A-Za-z0-9_-]{32,64}$/.test(String(pairing?.token || "")) && pairing.code === code);
  const keyDoc = (await qa(office.collection("scoutIngestKeys")).get()).docs.map((d) => d.data()).find((k) => k.keyId === pairing?.keyId);
  check("the server keeps a hash only (no secret stored)", Boolean(keyDoc?.secretHash) && !JSON.stringify(keyDoc).includes(String(pairing?.token || "").split(".")[3] || "§"));

  // 3 the assistant opens the address at the end of its search → sent with no hand on the page
  const first = await openInbox(context, code, batch(`claude-live-${RUN}`, [...items, restricted, badLink]), "02-auto-first");
  const r1 = first.result;
  check("automatic: 12 received, 10 saved, 2 refused with their reasons", r1.state === "DONE" && r1.received === 12 && r1.saved === 10 && (r1.rejectedItems || []).map((x) => x.reason).join(",") === "source_restricted,link_invalid", JSON.stringify({ state: r1.state, received: r1.received, saved: r1.saved, rejected: (r1.rejectedItems || []).map((x) => x.reason) }));
  check("the results leave the address once read (a reload sends nothing)", !first.address.includes("ingest="));
  const feed = (await qa(office.collection("scoutFeed")).where("channel", "==", "AGENT").get()).docs.map((d) => d.data());
  check("Staging Firestore: 10 feed documents, all «قيد المراجعة», links without tracking", feed.length === 10 && feed.every((d) => d.reviewStatus === "PENDING_REVIEW" && /^https:\/\/listings\.example\.sa\/ad\/10\d\d$/.test(d.link)), String(feed.length));
  check("nothing from the refused site was stored", !feed.some((d) => String(d.link || "").includes("haraj")));
  const finds = (await qa(office.collection("scoutOpportunities")).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  check("Staging Firestore: every result is an outside find with its source link", finds.length >= 10 && items.every((it) => finds.some((f) => String(f.url || "").startsWith(it.url.split("?")[0]))), String(finds.length));
  const flat = finds.find((f) => String(f.url || "").includes("/ad/1001"));
  check("matching: the apartment for rent in العزيزية is linked to the office's request by the matching engine", flat?.bestRecordId === requestId && Number(flat?.score) > 0, JSON.stringify({ best: flat?.bestRecordId, score: flat?.score, band: flat?.band }));
  const records = (await qa(office.collection("opportunities")).get()).docs.map((d) => d.data());
  check("nothing became an office record by itself (only the office's own request exists)", records.length === 1, String(records.length));

  // 4 retries and repeats
  const replay = await openInbox(context, code, batch(`claude-live-${RUN}`, [...items, restricted, badLink]), "03-auto-retry");
  check("the same batch again (a retry) writes nothing", replay.result.state === "DONE" && replay.result.replayed >= 1 && (await feedCount()) === 10, JSON.stringify({ replayed: replay.result.replayed, saved: replay.result.saved }));
  const again = await openInbox(context, code, batch(`claude-live-${RUN}-b`, items), "04-auto-repeat");
  check("the same ads in a new search are duplicates — no second find", again.result.saved === 0 && again.result.duplicates === 10 && (await qa(office.collection("scoutOpportunities")).get()).size === finds.length, JSON.stringify({ saved: again.result.saved, duplicates: again.result.duplicates }));

  // 5 another site opening the page with results of its own (no run code / a wrong one) → nothing sent
  const forged = await openInbox(context, "zzzzzzzzzz", batch(`forged-${RUN}`, [{ url: "https://spam.example.sa/x", text: "شقة للإيجار في العزيزية 30 الف سنوي — إعلان مزروع" }]), "05-forged");
  check("a page opened by another site with a wrong run code sends nothing", forged.result.state === "REFUSED" && forged.result.reason === "run_code_mismatch" && (await feedCount()) === 10);
  const stranger = await browser.newContext(mobile);
  const unpaired = await openInbox(stranger, code, batch(`unpaired-${RUN}`, items.slice(0, 1)), "06-unpaired-browser");
  check("a browser that was not paired sends nothing, even with the run code", unpaired.result.state === "REFUSED" && unpaired.result.reason === "not_paired");
  await stranger.close();

  // 6 the Worker's own refusals (no key, a bent office, another office's key)
  const noKey = await fetch(`${WORKER}/os/scout/ingest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(batch(`nokey-${RUN}`, items.slice(0, 1))) });
  check("no key → 401", noKey.status === 401, String(noKey.status));
  const bent = await fetch(`${WORKER}/os/scout/ingest`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${pairing.token}` }, body: JSON.stringify({ ...batch(`bent-${RUN}`, items.slice(0, 1)), officeId: OFFICE_B }) });
  check("a body naming another office → 403", bent.status === 403, String(bent.status));
  const [, , kid, secret] = String(pairing.token).split(".");
  const swapped = await fetch(`${WORKER}/os/scout/ingest`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer iqk.${OFFICE_B}.${kid}.${secret}` }, body: JSON.stringify(batch(`swap-${RUN}`, items.slice(0, 1))) });
  check("this office's key presented as another office's → 401", swapped.status === 401, String(swapped.status));
  check("office B received nothing", (await feedCount(OFFICE_B)) === 0);

  // 7 the broker sees them on his scout page, with the source link
  await page.goto(`${APP}/#/scout`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "ingest-07-broker-scout.png"), fullPage: true });
  const overview = await api("/os/scout/overview", { officeId: OFFICE });
  check("the broker's scout board shows the finds", overview.status === 200 && (overview.body.board || []).length >= 1, String((overview.body.board || []).length));
  if (flat) {
    await page.goto(`${APP}/#/scout/opp/${flat.id}`);
    await page.waitForTimeout(2500);
    const html = await page.content();
    await page.screenshot({ path: path.join(OUT, "ingest-08-find-detail.png"), fullPage: true });
    check("the find opens for the broker with its original link", html.includes("listings.example.sa"));
  }

  // 8 unpair: the key is revoked at once
  await page.goto(`${APP}/#/settings/scout`);
  page.once("dialog", (d) => d.accept());
  await page.locator("[data-scout-ingest-unpair]").click();
  const confirm = page.getByRole("button", { name: "فك الربط" });
  if (await confirm.count()) await confirm.last().click();
  await page.waitForTimeout(2500);
  const after = await fetch(`${WORKER}/os/scout/ingest`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${pairing.token}` }, body: JSON.stringify(batch(`after-${RUN}`, items.slice(0, 1))) });
  check("after «فك الربط» the key stops at once (401)", after.status === 401, String(after.status));
  // The scout is switched off for the QA office so the shared Staging scheduler leaves it alone.
  await api("/os/scout/settings", { officeId: OFFICE, settings: { enabled: false } });
  await context.close();
} catch (error) {
  check("live run completed without exceptions", false, String(error?.message || error).split("\n")[0]);
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) await p.screenshot({ path: path.join(OUT, `ingest-zz-failure-${Math.random().toString(36).slice(2, 6)}.png`), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  for (const u of users) {
    await u.dirRef.delete().catch(() => {});
    await auth.deleteUser(u.uid).catch(() => {});
    await qa(db.collection("offices").doc(u.officeId).collection("members").doc(u.uid)).delete().catch(() => {});
  }
  fs.writeFileSync(path.join(OUT, "ingest-live-report.json"), JSON.stringify(report, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} ingest live checks passed`);
  if (process.env.GITHUB_ACTIONS) {
    const esc = (t) => String(t).replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
    for (const c of failed.slice(0, 9)) console.log(`::error title=ingest live check failed::${esc(`${c.name} — ${c.detail}`)}`);
    const lines = [`app: ${APP}`, `passed ${checks.length - failed.length}/${checks.length}`, ...checks.map((c) => `${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`)];
    console.log(`::notice title=ingest live results::${esc(lines.join("\n")).slice(0, 7000)}`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### الاستقبال التلقائي — تحقق حي\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`);
  }
  process.exitCode = failed.length ? 1 : 0;
}
