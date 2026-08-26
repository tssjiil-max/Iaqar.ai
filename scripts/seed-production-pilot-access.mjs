#!/usr/bin/env node
/**
 * Seed production pilot access settings (Firestore only).
 * Requires production service account with Firestore write access.
 *
 *   FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON='...' node scripts/seed-production-pilot-access.mjs \
 *     --office=office-one --office=office-two ...
 */
import * as admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { normalizePilotAccessConfig } from "../public/js/pilot-access-domain.js";

const PROJECT_ID = "aqar-b5d76";
const officeArgs = process.argv.filter((arg) => arg.startsWith("--office=")).map((arg) => arg.slice(8)).filter(Boolean);
const rawJson = process.env.FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON
  || process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  || "";

if (!rawJson) {
  console.error("Missing FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON");
  process.exit(1);
}

const serviceAccount = JSON.parse(rawJson);
if (serviceAccount.project_id !== PROJECT_ID) {
  console.error(`Wrong Firebase project: expected ${PROJECT_ID}, got ${serviceAccount.project_id}`);
  process.exit(1);
}

if (officeArgs.length === 0 || officeArgs.length > 5) {
  console.error("Provide 1–5 --office= IDs for the pilot allowlist");
  process.exit(1);
}

const config = normalizePilotAccessConfig({
  enabled: true,
  maxOffices: 5,
  authorizedOfficeIds: officeArgs,
  featureFlags: {
    matching: true,
    publicOpportunityRouting: false,
    pushNotifications: true,
    crossOfficeCollaboration: true
  }
});

admin.initializeApp({ credential: admin.cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();

await db.doc("platform/settings/pilotAccess").set({
  enabled: config.enabled,
  maxOffices: config.maxOffices,
  authorizedOfficeIds: config.authorizedOfficeIds,
  featureFlagsJson: JSON.stringify(config.featureFlags),
  registrationClosedMessage: config.registrationClosedMessage,
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: "production-pilot-seed"
}, { merge: true });

console.log(JSON.stringify({
  ok: true,
  projectId: PROJECT_ID,
  path: "platform/settings/pilotAccess",
  authorizedOfficeIds: config.authorizedOfficeIds,
  featureFlags: config.featureFlags
}, null, 2));

await admin.app().delete();
