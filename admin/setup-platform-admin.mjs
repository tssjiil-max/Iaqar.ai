import fs from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const jsonPath = process.env.IAQAR_SERVICE_ACCOUNT_JSON;
const email = String(process.env.IAQAR_ADMIN_EMAIL || "").trim().toLowerCase();
const password = String(process.env.IAQAR_ADMIN_PASSWORD || "");
if (!jsonPath || !email || password.length < 8) throw new Error("Missing setup data");

const serviceAccount = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
if (serviceAccount.project_id !== "aqar-b5d76") throw new Error("Wrong Firebase project");
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
console.log(`Platform admin ready: ${email}`);
