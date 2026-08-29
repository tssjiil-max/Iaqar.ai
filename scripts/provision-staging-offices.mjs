#!/usr/bin/env node
/**
 * Provision fresh staging offices and bind the canonical QA phone numbers.
 * Old loginDirectory rows for those phones are deactivated (not deleted).
 */
import crypto from "node:crypto";
import * as admin from "firebase-admin";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const PROJECT_ID = "iaqar-ai-staging";
const STAGING_URL = "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const BATCH = "20260829";
const PASSWORD = "StagingLogo9";
const FAL_LICENSE = "1234567890";

const OFFICES = [
  {
    slug: "co-client",
    officeName: "مكتب العقيق العقاري 2",
    phone: "0558882961",
    brokerName: "وسيط العقيق 2"
  },
  {
    slug: "co-property",
    officeName: "مكتب العقيق 3",
    phone: "0550406527",
    brokerName: "وسيط العقيق 3"
  },
  {
    slug: "hamra",
    officeName: "مكتب الحمراء العقاري",
    phone: "0511123456",
    brokerName: "وسيط الحمراء"
  },
  {
    slug: "wadi",
    officeName: "مكتب الوادي المبارك",
    phone: "0552019909",
    brokerName: "وسيط الوادي"
  },
  {
    slug: "aleeq",
    officeName: "مكتب العقيق العقاري",
    phone: "0530033914",
    brokerName: "وسيط العقيق"
  },
  {
    slug: "jamawat",
    officeName: "مكتب الجماوات العقاري",
    phone: "0504360061",
    brokerName: "وسيط الجماوات"
  },
  {
    slug: "coop-partner",
    officeName: "Staging Coop Target",
    phone: "0511234567",
    brokerName: "وسيط الشريك"
  }
];

function normalizePhone(local) {
  let digits = String(local || "").replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = digits.slice(2);
  if (digits.startsWith("966")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!/^5\d{8}$/.test(digits)) throw new Error(`Invalid phone ${local}`);
  return `+966${digits}`;
}

function phoneHash(phone) {
  return crypto.createHash("sha256").update(phone).digest("hex");
}

const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsed.serviceAccount) {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
  process.exit(1);
}

admin.initializeApp({ credential: admin.cert(parsed.serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();

async function deactivatePhoneLogin(phone) {
  const hash = phoneHash(phone);
  const ref = db.collection("loginDirectory").doc(hash);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const prev = snap.data();
  await ref.set(
    { active: false, deactivatedAt: FieldValue.serverTimestamp(), deactivatedBy: "provision-staging-offices" },
    { merge: true }
  );
  return prev;
}

async function ensureAuthUser({ officeId, email }) {
  try {
    const existing = await auth.getUser(officeId);
    await auth.updateUser(officeId, { email, password: PASSWORD, disabled: false });
    return existing.uid;
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    const created = await auth.createUser({
      uid: officeId,
      email,
      password: PASSWORD,
      displayName: officeId
    });
    return created.uid;
  }
}

async function provisionOffice(spec) {
  const officeId = `staging-${spec.slug}-${BATCH}`;
  const email = `${officeId}@example.invalid`;
  const phone = normalizePhone(spec.phone);
  const localPhone = `0${phone.slice(4)}`;

  const previousLogin = await deactivatePhoneLogin(phone);
  const uid = await ensureAuthUser({ officeId, email });
  const now = FieldValue.serverTimestamp();

  await db.collection("offices").doc(officeId).set(
    {
      officeId,
      officeName: spec.officeName,
      officeNameKey: officeId,
      brokerName: spec.brokerName,
      phone,
      licenseNumber: FAL_LICENSE,
      city: "المدينة المنورة",
      specialties: [],
      ownerUid: uid,
      approvalStatus: "approved",
      accountStatus: "active",
      subscriptionStatus: "trial",
      pilotAuthorized: true,
      platformOpportunityOnboardingAckAt: new Date().toISOString(),
      isTestFixture: true,
      provisionedBy: "provision-staging-offices",
      provisionBatch: BATCH,
      previousLoginOfficeId: previousLogin?.officeId || "",
      approvedAt: now,
      registeredAt: now,
      createdAt: now,
      updatedAt: now
    },
    { merge: true }
  );

  await db.collection("publicOffices").doc(officeId).set(
    {
      officeId,
      officeName: spec.officeName,
      brokerName: spec.brokerName,
      phone,
      licenseNumber: FAL_LICENSE,
      city: "المدينة المنورة",
      specialties: [],
      coverUrl: "",
      updatedAt: now
    },
    { merge: true }
  );

  await db
    .collection("offices")
    .doc(officeId)
    .collection("members")
    .doc(uid)
    .set(
      {
        uid,
        role: "owner",
        active: true,
        createdAt: now,
        updatedAt: now
      },
      { merge: true }
    );

  await db.collection("loginDirectory").doc(phoneHash(phone)).set({
    uid,
    officeId,
    email,
    phone,
    active: true,
    updatedAt: now,
    provisionedBy: "provision-staging-offices",
    provisionBatch: BATCH
  });

  return {
    officeId,
    officeName: spec.officeName,
    phone: localPhone,
    password: PASSWORD,
    email,
    uid,
    previousOfficeId: previousLogin?.officeId || ""
  };
}

async function provisionQaE2eOffice(hamraOfficeId, hamraUid) {
  const officeId = `staging-qa-e2e-${BATCH}`;
  const now = FieldValue.serverTimestamp();
  await db.collection("offices").doc(officeId).set(
    {
      officeId,
      officeName: "QA E2E Dedicated",
      displayName: "QA E2E Dedicated",
      ownerUid: hamraUid,
      isTestFixture: true,
      provisionedBy: "provision-staging-offices",
      provisionBatch: BATCH,
      platformOpportunityOnboardingAckAt: now,
      createdAt: now,
      updatedAt: now
    },
    { merge: true }
  );
  await db
    .collection("offices")
    .doc(officeId)
    .collection("members")
    .doc(hamraUid)
    .set(
      {
        uid: hamraUid,
        role: "owner",
        active: true,
        updatedAt: now
      },
      { merge: true }
    );
  return {
    officeId,
    officeName: "QA E2E Dedicated",
    phone: "0511123456",
    password: PASSWORD,
    note: "نفس جوال مكتب الحمراء — استخدم ?office=" + officeId
  };
}

async function verifyLogins(rows) {
  const initRes = await fetch(`${STAGING_URL}/__/firebase/init.json`);
  const { apiKey } = await initRes.json();
  const verified = [];
  for (const row of rows) {
    if (!row.phone || row.note) {
      verified.push({ ...row, loginOk: row.note ? "shared" : false });
      continue;
    }
    const res = await fetch(`${WORKER}/auth/phone-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: row.phone, password: PASSWORD, apiKey })
    });
    const body = await res.json().catch(() => ({}));
    verified.push({
      ...row,
      loginOk: res.ok && body.officeId === row.officeId,
      loginOfficeId: body.officeId || ""
    });
  }
  return verified;
}

const created = [];
for (const spec of OFFICES) {
  const row = await provisionOffice(spec);
  created.push(row);
  console.log("provisioned", row.officeId, row.phone, row.previousOfficeId ? `← phone moved from ${row.previousOfficeId}` : "");
}

const hamra = created.find((row) => row.officeId.includes("hamra"));
const qa = await provisionQaE2eOffice(hamra.officeId, hamra.uid);
created.push(qa);

const report = await verifyLogins(created);
console.log(JSON.stringify(report, null, 2));

const failed = report.filter((row) => row.loginOk !== true && row.loginOk !== "shared");
if (failed.length) {
  console.error("LOGIN_VERIFY_FAILED", failed);
  process.exit(1);
}

console.log("OK provisioned", report.length, "offices");
