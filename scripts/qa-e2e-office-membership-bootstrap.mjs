#!/usr/bin/env node
import { createHash } from "node:crypto";
import * as admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const OFFICE_ID = process.env.QA_E2E_OFFICE_ID || "qa-e2e-dedicated";
const PHONE = process.env.STAGING_PHONE || "0511123456";
const PROJECT_ID = process.env.FIREBASE_STAGING_PROJECT_ID || "iaqar-ai-staging";

function normalizeLoginPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = digits.slice(2);
  if (digits.startsWith("966")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return /^5\d{8}$/.test(digits) ? `+966${digits}` : "";
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function localLegacyPhone(normalized) {
  return normalized ? `0${normalized.slice(4)}` : "";
}

const { serviceAccount } = parseFirebaseServiceAccountJson(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  PROJECT_ID
);

if (!serviceAccount) {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON is missing or invalid for", PROJECT_ID);
  process.exit(1);
}

const normalizedPhone = normalizeLoginPhone(PHONE);
if (!normalizedPhone) {
  console.error("STAGING_PHONE is invalid after normalization");
  process.exit(1);
}

const app = admin.initializeApp({ credential: admin.cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore(app);

async function loadLoginDirectory() {
  const candidates = [
    { kind: "canonical", id: sha256(normalizedPhone) },
    { kind: "legacy", id: sha256(localLegacyPhone(normalizedPhone)) }
  ];

  for (const candidate of candidates) {
    const snap = await db.collection("loginDirectory").doc(candidate.id).get();
    if (snap.exists) return { kind: candidate.kind, snap };
  }
  return null;
}

async function main() {
  const directoryResult = await loadLoginDirectory();
  if (!directoryResult) {
    throw new Error("No loginDirectory record found for the staging login phone");
  }

  const directory = directoryResult.snap.data() || {};
  const uid = String(directory.uid || "").trim();
  const sourceOfficeId = String(directory.officeId || "").trim();
  if (directory.active !== true || !uid || !sourceOfficeId) {
    throw new Error("Staging loginDirectory record is inactive or incomplete");
  }

  const sourceRef = db.collection("offices").doc(sourceOfficeId);
  const sourceSnap = await sourceRef.get();
  if (!sourceSnap.exists) {
    throw new Error(`Source office from loginDirectory does not exist: ${sourceOfficeId}`);
  }

  const sourceMemberSnap = await sourceRef.collection("members").doc(uid).get();
  const sourceMember = sourceMemberSnap.data() || {};
  const targetRef = db.collection("offices").doc(OFFICE_ID);

  await targetRef.set({
    officeName: "QA E2E Dedicated",
    displayName: "QA E2E Dedicated",
    ownerUid: uid,
    isTestFixture: true,
    createdBy: "E2E",
    qaSourceOfficeId: sourceOfficeId,
    platformOpportunityOnboardingAckAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await targetRef.collection("members").doc(uid).set({
    ...sourceMember,
    role: sourceMember.role || "owner",
    active: true,
    qaE2eMembership: true,
    qaSourceOfficeId: sourceOfficeId,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  const [targetSnap, targetMemberSnap] = await Promise.all([
    targetRef.get(),
    targetRef.collection("members").doc(uid).get()
  ]);

  if (!targetSnap.exists || !targetMemberSnap.exists || targetMemberSnap.data()?.active === false) {
    throw new Error("QA office membership bootstrap verification failed");
  }

  console.log(JSON.stringify({
    ok: true,
    officeId: OFFICE_ID,
    sourceOfficeId,
    uidSuffix: uid.slice(-6),
    directoryMode: directoryResult.kind,
    sourceMemberFound: sourceMemberSnap.exists
  }));
}

main()
  .catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await app.delete().catch(() => null);
  });
