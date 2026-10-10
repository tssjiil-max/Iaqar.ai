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
import { getFirestore, FieldValue } from "firebase-admin/firestore";
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
    specialties: ["sale", "rent"], platformOpportunityOnboardingAckAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  });
}
if (ownerUid) {
  await office.set({ ownerUid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await office.collection("members").doc(ownerUid).set({ uid: ownerUid, role: "owner", active: true, isTestFixture: true, addedBy: "kapso-setup" }, { merge: true });
}
note("Kapso test office", `${OFFICE} ${snap.exists ? "kept" : "created"} · owner's Staging account linked: ${ownerUid ? "yes" : "no (not found)"}`);

const unsigned = await fetch(`${WORKER}/integrations/kapso/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-event": "whatsapp.message.received" }, body: "{}" }).catch(() => null);
const status = unsigned?.status || 0;
const body = unsigned ? await unsigned.json().catch(() => ({})) : {};
note("Kapso endpoint", `${WORKER}/integrations/kapso/webhook → unsigned POST answered ${status} (${body.error || ""}${body.reason ? ` · ${body.reason}` : ""})`);
if (![401, 503].includes(status)) { console.log("::error title=Kapso endpoint::an unsigned request was not refused"); process.exit(1); }
