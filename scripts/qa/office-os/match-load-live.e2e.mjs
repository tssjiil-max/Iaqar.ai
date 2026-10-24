// Matching at office scale — live measurement on the deployed preview (Staging project, one isolated QA office).
// QA branch for PR #265 only (not for merge). BASELINE: the integration branch WITHOUT #265, for timings only.
//
// For 400, 1000 and 4999 records (and one save past the 5000-record ceiling), with the qualifying counterpart
// seeded under the id that sorts after every other record (the worst place for a one-page read):
//   save an offer through the preview Worker → is the request matched? was the whole office scanned? how long?
//   then the same through manual search («بحث عن خيارات مناسبة»).
// Reads and subrequests are not visible from outside the Worker: they are derived from the scan size and the code
// (pages of 300), and labelled as derived in the report.
//
//   env: PREVIEW_URL, PREVIEW_WORKER_URL, FIREBASE_SERVICE_ACCOUNT_JSON (Staging), OUT_DIR
// Guards: the Staging service account and the preview pair only. Writes only under offices/qa-office-match-load,
// this run's user and its login entry; everything is removed at the end.
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { parseFirebaseServiceAccountJson } from "../../staging-credentials.mjs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const PROJECT = "iaqar-ai-staging";
const APP = String(process.env.PREVIEW_URL || "").replace(/\/+$/, "");
const WORKER = String(process.env.PREVIEW_WORKER_URL || "").replace(/\/+$/, "");
const OUT = process.env.OUT_DIR || "qa-match-load";
fs.mkdirSync(OUT, { recursive: true });
const OFFICE = "qa-office-match-load";
const RUN = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/[^0-9A-Za-z]/g, "");
const HOST = new URL(APP).hostname;
if (!(HOST.startsWith(`${PROJECT}--office-os-preview`) && /^https:\/\/iaqar-intake-os-preview\./.test(WORKER))) throw new Error(`refusing: ${APP} + ${WORKER} is not the preview pair`);
const { serviceAccount } = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT);
if (serviceAccount?.project_id !== PROJECT) throw new Error("refusing: not the Staging service account");
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();
const QA_PATH = /^offices\/qa-office-match-load(\/|$)/;
const qa = (ref) => { if (!QA_PATH.test(ref.path)) throw new Error(`refusing path ${ref.path}`); return ref; };
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 400) }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`); };
const office = qa(db.collection("offices").doc(OFFICE));
const RESET = ["opportunities", "matches", "operations", "journeys", "notifications", "members", "auditLogs", "matchCurrentPointers", "tasks", "contacts", "clients", "owners", "failures"];

async function resetOffice(ownerUid) {
  const snap = await office.get();
  if (snap.exists && snap.data().isTestFixture !== true) throw new Error(`refusing: ${OFFICE} exists and is not a test fixture`);
  if (!ownerUid) { await db.recursiveDelete(office); return; }
  for (const sub of RESET) await db.recursiveDelete(qa(office.collection(sub)));
  await office.set({
    officeId: OFFICE, officeName: "مكتب قياس المطابقة", officeNameKey: "qaofficematchload", brokerName: "وسيط الاختبار", licenseNumber: "1200000000", city: "المدينة المنورة", phone: "0500000000",
    ownerUid, active: true, isTestFixture: true, createdBy: "match-load-live", specialties: ["sale", "rent"], platformOpportunityOnboardingAckAt: new Date(), updatedAt: new Date()
  });
  await office.collection("members").doc(ownerUid).set({ uid: ownerUid, role: "owner", active: true, isTestFixture: true, testRunId: RUN });
}

let user = null;
async function makeUser() {
  const uid = `qa-matchload-owner-${RUN}`.slice(0, 128);
  const phone = `05997${String(crypto.randomInt(0, 99999)).padStart(5, "0")}`;
  const dirRef = db.collection("loginDirectory").doc(sha(`+966${phone.slice(1)}`));
  if ((await dirRef.get()).exists) throw new Error("refusing: login directory collision");
  await auth.createUser({ uid, email: `${uid}@qa-preview.invalid`, password: crypto.randomBytes(18).toString("base64url"), displayName: "QA match load" });
  await dirRef.set({ uid, officeId: OFFICE, email: `${uid}@qa-preview.invalid`, phone: `+966${phone.slice(1)}`, active: true, isTestFixture: true, testRunId: RUN });
  user = { uid, dirRef };
  return user;
}
let token = "";
async function api(route, body) {
  if (!token) {
    const apiKey = (await (await fetch(`${APP}/__/firebase/init.json`)).json()).apiKey;
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: await auth.createCustomToken(user.uid), returnSecureToken: true }) });
    token = (await res.json()).idToken;
    if (!token) throw new Error(`sign-in failed ${res.status}`);
  }
  const started = performance.now();
  const res = await fetch(`${WORKER}${route}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ officeId: OFFICE, ...body }) });
  return { status: res.status, ms: Math.round(performance.now() - started), body: await res.json().catch(() => ({})) };
}

const now = new Date();
const base = { officeId: OFFICE, lifecycleStatus: "ACTIVE", status: "active", matchingReadiness: "READY_FOR_MATCHING", dataCompleteness: 100, city: "المدينة المنورة", version: 1, createdAt: now, updatedAt: now, isTestFixture: true, testRunId: RUN };
let phoneSeq = 0;
const nextPhone = () => `0509${String(++phoneSeq).padStart(6, "0")}`;
let seeded = 0;
async function seedUnrelated(count, prefix) {
  const writer = db.bulkWriter();
  for (let i = 0; i < count; i += 1) {
    writer.set(qa(office.collection("opportunities").doc(`${prefix}${String(i).padStart(5, "0")}`)), {
      ...base, opportunityKind: "OFFER", purpose: "RENT", district: "الحرة الشرقية", propertyType: "مستودع", rentPrice: 40_000, priceOrBudget: 40_000, contactPhone: nextPhone(), contactName: "مالك"
    });
  }
  await writer.close();
  seeded += count;
}
const count = async () => (await office.collection("opportunities").count().get()).data().count;
const currentMatchesFor = async (recordId) => (await office.collection("matches").get()).docs.map((d) => d.data())
  .filter((m) => m.isCurrent !== false && [m.requestId, m.clientRequestId].includes(recordId));
const pages = (n) => Math.ceil(n / 300);
const results = [];

async function scale({ label, total, type, district, prefix, expectComplete }) {
  const requestId = `opp_zz${prefix}_request`;
  const have = await count();
  await seedUnrelated(Math.max(0, total - have - 2), `opp_a${prefix}_`);
  await qa(office.collection("opportunities").doc(requestId)).set({
    ...base, opportunityKind: "REQUEST", purpose: "PURCHASE", advertiserRole: "CLIENT", district, propertyType: type, budget: 900_000, priceOrBudget: 900_000, priceMax: 900_000, contactPhone: nextPhone(), contactName: "عميل"
  });
  const before = await count();
  const save = await api("/os/records/save", { requestKey: `load-${RUN}-${prefix}`, record: { kind: "OFFER", purpose: "SALE", city: "المدينة المنورة", district, propertyType: type, price: 880_000, contactName: "مالك", contactPhone: nextPhone() } });
  const matched = (await currentMatchesFor(requestId)).length;
  const manual = save.body.recordId ? await api("/os/records/candidates", { recordId: save.body.recordId }) : { status: 0, ms: 0, body: {} };
  const row = {
    label, recordsInOffice: before + 1, saveStatus: save.status, saveMs: save.ms, matches: save.body.matches, requestMatched: matched === 1,
    matchingComplete: save.body.matchingComplete, matchingScanned: save.body.matchingScanned, notice: save.body.matchingNotice || "",
    manualStatus: manual.status, manualMs: manual.ms, manualFound: (manual.body.candidates || []).some((c) => c.recordId === requestId), manualComplete: manual.body.matchingComplete,
    derived: { opportunityPagesPerSave: pages(save.body.matchingScanned || 0), opportunityDocumentReadsPerSave: save.body.matchingScanned || 0 }
  };
  results.push(row);
  console.log(JSON.stringify(row));
  check(`${label}: the save answered 200`, save.status === 200, `${save.status} ${JSON.stringify(save.body).slice(0, 200)}`);
  if (expectComplete) {
    check(`${label}: the qualifying request (id sorted last) is matched`, matched === 1 && save.body.matches >= 1, `matches=${save.body.matches} current=${matched}`);
    check(`${label}: the whole office was scanned`, save.body.matchingComplete === true && save.body.matchingScanned === before + 1, `${save.body.matchingScanned}/${before + 1}`);
    check(`${label}: manual search lists the request`, manual.status === 200 && row.manualFound && manual.body.matchingComplete === true, `${manual.status} found=${row.manualFound}`);
  } else {
    check(`${label}: past the ceiling the answer says the scan was partial (never presented as complete)`, save.body.matchingComplete === false && /لم يشمل/.test(row.notice) && manual.body.matchingComplete === false, `scanned=${save.body.matchingScanned} complete=${save.body.matchingComplete}/${manual.body.matchingComplete}`);
  }
}

try {
  await resetOffice((await makeUser()).uid);
  await scale({ label: "400 records", total: 400, type: "شقة", district: "العزيزية", prefix: "1", expectComplete: true });
  await scale({ label: "1000 records", total: 1000, type: "فيلا", district: "شوران", prefix: "2", expectComplete: true });
  await scale({ label: "4999 records", total: 4999, type: "دور", district: "قباء", prefix: "3", expectComplete: true });
  await scale({ label: "5002 records (past the 5000 ceiling)", total: 5002, type: "عمارة", district: "العوالي", prefix: "4", expectComplete: false });
} catch (error) {
  check("the measurement ran to the end", false, String(error?.stack || error).split("\n").slice(0, 3).join(" | "));
} finally {
  await resetOffice("").catch((error) => console.log("cleanup:", error.message));
  if (user) { await user.dirRef.delete().catch(() => {}); await auth.deleteUser(user.uid).catch(() => {}); }
  const failed = checks.filter((c) => !c.ok);
  fs.writeFileSync(path.join(OUT, "match-load-report.json"), JSON.stringify({ at: new Date().toISOString(), app: APP, worker: WORKER, run: RUN, seeded, results, checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} match load checks passed`);
  if (process.env.GITHUB_ACTIONS) {
    const esc = (t) => String(t).replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
    console.log(`::notice title=match load results::${esc(results.map((r) => `${r.label}: save ${r.saveMs} ms, scanned ${r.matchingScanned}, complete ${r.matchingComplete}, request matched ${r.requestMatched}; manual ${r.manualMs} ms found ${r.manualFound}`).join("\n"))}`);
    for (const c of failed) console.log(`::error title=match load check failed::${esc(`${c.name} — ${c.detail}`)}`);
  }
  process.exitCode = failed.length ? 1 : 0;
}
