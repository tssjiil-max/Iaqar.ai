import fs from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const ALLOWED_PROJECTS = new Set(["aqar-b5d76", "iaqar-ai-staging"]);

function readServiceAccount() {
  const rawJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (rawJson) {
    const parsed = JSON.parse(rawJson);
    return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  }
  const jsonPath = process.env.IAQAR_SERVICE_ACCOUNT_JSON;
  if (!jsonPath) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON or IAQAR_SERVICE_ACCOUNT_JSON");
  return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
}

const email = String(process.env.IAQAR_ADMIN_EMAIL || "").trim().toLowerCase();
const password = String(process.env.IAQAR_ADMIN_PASSWORD || "");
if (!email || password.length < 8) throw new Error("Missing IAQAR_ADMIN_EMAIL / IAQAR_ADMIN_PASSWORD");

const serviceAccount = readServiceAccount();
if (!ALLOWED_PROJECTS.has(serviceAccount.project_id)) {
  throw new Error(`Unsupported Firebase project: ${serviceAccount.project_id}`);
}
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });

const auth = getAuth();
let user;
try {
  user = await auth.getUserByEmail(email);
  user = await auth.updateUser(user.uid, { password, disabled: false, emailVerified: true });
} catch (error) {
  if (error.code !== "auth/user-not-found") throw error;
  user = await auth.createUser({ email, password, emailVerified: true, disabled: false });
}
await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), platformAdmin: true, admin: true });
console.log(`Platform admin ready: ${email} (${serviceAccount.project_id})`);
