#!/usr/bin/env node
/**
 * Kapso WhatsApp Sandbox — Staging only. Makes sure the ONE test office exists and checks the endpoint is live.
 *   • Office `qa-office-kapso` (a test fixture): created when missing, never reset, never touched if it is not a fixture.
 *   • When the owner's Staging account exists (login directory of +966552019909), it is made the office owner,
 *     so he opens it with ?officeId=qa-office-kapso. Nothing is printed but yes/no.
 *   • Endpoint check: an unsigned POST must be refused (401 with the secret, 503 without it).
 *   env: FIREBASE_SERVICE_ACCOUNT_JSON (Staging), STAGING_WORKER_URL (optional)
 */
import crypto from "node:crypto";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const PROJECT = "iaqar-ai-staging";
const OFFICE = "qa-office-kapso";
const OWNER_PHONE = "+966552019909";
const WORKER = (process.env.STAGING_WORKER_URL || "https://iaqar-intake-staging.iaqar-ai.workers.dev").replace(/\/+$/, "");
const note = (title, text) => console.log(process.env.GITHUB_ACTIONS ? `::notice title=${title}::${text}` : `${title}: ${text}`);

const { serviceAccount } = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT);
if (serviceAccount?.project_id !== PROJECT) { console.log("::error title=Kapso setup::refusing — not the Staging service account"); process.exit(1); }
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT });
const db = getFirestore();

const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const dir = await db.collection("loginDirectory").doc(sha(OWNER_PHONE)).get();
const ownerUid = dir.exists ? String(dir.data().uid || "") : "";
const office = db.collection("offices").doc(OFFICE);
const snap = await office.get();
if (snap.exists && snap.data().isTestFixture !== true) { console.log(`::error title=Kapso setup::${OFFICE} exists and is not a test fixture — not touched`); process.exit(1); }
if (!snap.exists) {
  await office.set({
    officeId: OFFICE, officeName: "مكتب تجربة واتساب (Kapso)", officeNameKey: "qaofficekapso", brokerName: "وسيط التجربة", licenseNumber: "",
    city: "المدينة المنورة", phone: "", ownerUid: ownerUid || "kapso-sandbox-owner", active: true, isTestFixture: true, createdBy: "kapso-setup",
    specialties: ["sale", "rent"], platformOpportunityOnboardingAckAt: new Date(), createdAt: new Date(), updatedAt: new Date()
  });
}
if (ownerUid) {
  await office.set({ ownerUid, updatedAt: new Date() }, { merge: true });
  await office.collection("members").doc(ownerUid).set({ uid: ownerUid, role: "owner", active: true, isTestFixture: true, addedBy: "kapso-setup" }, { merge: true });
}
note("Kapso test office", `${OFFICE} ${snap.exists ? "kept" : "created"} · owner's Staging account linked: ${ownerUid ? "yes" : "no (not found)"}`);

const unsigned = await fetch(`${WORKER}/integrations/kapso/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-event": "whatsapp.message.received" }, body: "{}" }).catch(() => null);
const status = unsigned?.status || 0;
const body = unsigned ? await unsigned.json().catch(() => ({})) : {};
note("Kapso endpoint", `${WORKER}/integrations/kapso/webhook → unsigned POST answered ${status} (${body.error || ""}${body.reason ? ` · ${body.reason}` : ""})`);
if (![401, 503].includes(status)) { console.log("::error title=Kapso endpoint::an unsigned request was not refused"); process.exit(1); }

// With the secret on this run: signed deliveries that must be accepted and then ignored — nothing written, nothing sent
// (another sandbox number, a sender that is not allowed, another event). Proves the real secret is in place.
const SECRET = String(process.env.KAPSO_WEBHOOK_SECRET || "").replace(/[\r\n]/g, "");
if (SECRET) {
  const post = async (obj, event = "whatsapp.message.received", secret = SECRET) => {
    const raw = JSON.stringify(obj);
    const res = await fetch(`${WORKER}/integrations/kapso/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-event": event, "x-webhook-signature": crypto.createHmac("sha256", secret).update(raw).digest("hex"), "x-idempotency-key": crypto.randomUUID(), "x-webhook-payload-version": "v2" }, body: raw }).catch(() => null);
    return { status: res?.status || 0, body: res ? await res.json().catch(() => ({})) : {} };
  };
  const msg = (from, phoneId) => ({ message: { id: `wamid.setup.${crypto.randomUUID()}`, type: "text", from, text: { body: "فحص" }, kapso: { direction: "inbound" } }, conversation: { phone_number: from, phone_number_id: phoneId }, phone_number_id: phoneId });
  const wrongSecret = await post(msg("966500000000", "597907523413541"), undefined, "not-the-secret");
  const otherNumber = await post(msg("966552019909", "100000000000000"));
  const stranger = await post(msg("966500000000", "597907523413541"));
  const otherEvent = await post(msg("966552019909", "597907523413541"), "whatsapp.message.sent");
  const ok = wrongSecret.status === 401 && otherNumber.status === 200 && otherNumber.body.results?.[0]?.status === "other_number"
    && stranger.status === 200 && stranger.body.results?.[0]?.status === "sender_not_allowed" && otherEvent.status === 200 && otherEvent.body.ignored === "event";
  note("Kapso signature (real secret)", `wrong secret → ${wrongSecret.status} · signed, other number → ${otherNumber.status} ${otherNumber.body.results?.[0]?.status || otherNumber.body.error || ""} · signed, sender not allowed → ${stranger.status} ${stranger.body.results?.[0]?.status || stranger.body.error || ""} · signed, other event → ${otherEvent.status} ${otherEvent.body.ignored || otherEvent.body.error || ""}`);
  if (!ok) { console.log("::error title=Kapso signature::the Staging Worker did not accept the real secret as expected"); process.exit(1); }
}

// With the API key: one read-only call to Kapso's documented platform API (list phone numbers) — no message is sent.
const KEY = String(process.env.KAPSO_API_KEY || "").replace(/[\r\n]/g, "").trim();
if (KEY) {
  const res = await fetch("https://api.kapso.ai/platform/v1/whatsapp/phone_numbers", { headers: { "X-API-Key": KEY, accept: "application/json" } }).catch(() => null);
  const list = res?.ok ? await res.json().catch(() => ({})) : {};
  const rows = Array.isArray(list?.data) ? list.data : Array.isArray(list) ? list : [];
  const hasSandbox = JSON.stringify(rows).includes("597907523413541");
  note("Kapso API key", `read-only list of phone numbers → HTTP ${res?.status || 0}${res?.ok ? ` · key accepted · ${rows.length} number(s) · sandbox number listed: ${hasSandbox ? "yes" : "no"}` : " · key refused or wrong key type"}`);
}

// The last real deliveries (status and reply outcome only — no phone, no text), to confirm a real WhatsApp message.
const log = await office.collection("kapsoDeliveryLog").orderBy("at", "desc").limit(6).get().catch(() => ({ docs: [] }));
const records = await office.collection("opportunities").get().catch(() => ({ docs: [] }));
const fromWa = records.docs.filter((d) => d.data()?.intakeOrigin?.channel === "WHATSAPP");
note("Kapso deliveries", `${log.docs.length ? log.docs.map((d) => `${d.data().at?.slice(11, 19) || ""} ${d.data().status}/${d.data().reply}`).join(" · ") : "none yet"} · records from WhatsApp in ${OFFICE}: ${fromWa.length}`);
