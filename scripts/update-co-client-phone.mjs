#!/usr/bin/env node
import crypto from "node:crypto";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";
import * as admin from "firebase-admin";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "iaqar-ai-staging";
const OFFICE_ID = "staging-co-client-20260829";
const NEW_LOCAL = "0558882961";
const PASSWORD = "StagingLogo9";
const STAGING_URL = "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";

function normalizePhone(local) {
  let digits = String(local).replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = digits.slice(2);
  if (digits.startsWith("966")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return `+966${digits}`;
}

function phoneHash(phone) {
  return crypto.createHash("sha256").update(phone).digest("hex");
}

const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsed.serviceAccount) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
admin.initializeApp({ credential: admin.cert(parsed.serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();

const officeRef = db.collection("offices").doc(OFFICE_ID);
const officeSnap = await officeRef.get();
if (!officeSnap.exists) throw new Error(`Office ${OFFICE_ID} missing`);
const data = officeSnap.data();
const uid = data.ownerUid || OFFICE_ID;
const email = `${OFFICE_ID}@example.invalid`;

const oldPhone = data.phone || "+966500000000";
const newPhone = normalizePhone(NEW_LOCAL);

const newHash = phoneHash(newPhone);
const existing = await db.collection("loginDirectory").doc(newHash).get();
if (existing.exists) {
  const ex = existing.data();
  if (ex.active && ex.officeId !== OFFICE_ID) {
    await db.collection("loginDirectory").doc(newHash).set(
      {
        active: false,
        deactivatedAt: FieldValue.serverTimestamp(),
        deactivatedBy: "phone-change-co-client"
      },
      { merge: true }
    );
    console.log("deactivated previous owner", ex.officeId);
  }
}

await db.collection("loginDirectory").doc(phoneHash(oldPhone)).set(
  {
    active: false,
    deactivatedAt: FieldValue.serverTimestamp(),
    deactivatedBy: "phone-change-co-client"
  },
  { merge: true }
);

const now = FieldValue.serverTimestamp();
await officeRef.set({ phone: newPhone, updatedAt: now }, { merge: true });
await db.collection("publicOffices").doc(OFFICE_ID).set({ phone: newPhone, updatedAt: now }, { merge: true });
await db.collection("loginDirectory").doc(newHash).set(
  {
    uid,
    officeId: OFFICE_ID,
    email,
    phone: newPhone,
    active: true,
    updatedAt: now,
    changedBy: "phone-change-co-client"
  },
  { merge: true }
);

const init = await (await fetch(`${STAGING_URL}/__/firebase/init.json`)).json();
const res = await fetch(`${WORKER}/auth/phone-login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ phone: NEW_LOCAL, password: PASSWORD, apiKey: init.apiKey })
});
const body = await res.json().catch(() => ({}));
if (!res.ok || body.officeId !== OFFICE_ID) {
  console.error("login verify failed", res.status, body);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      officeId: OFFICE_ID,
      officeName: data.officeName,
      phone: NEW_LOCAL,
      password: PASSWORD,
      url: `${STAGING_URL}/?office=${OFFICE_ID}`
    },
    null,
    2
  )
);
