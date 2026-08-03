import fs from "node:fs";
import crypto from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const required = name => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const normalizePhone = value => {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = digits.slice(2);
  if (digits.startsWith("966")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!/^5\d{8}$/.test(digits)) throw new Error("Saudi phone must start with 05 and contain 10 digits");
  return `+966${digits}`;
};

const serviceAccount = JSON.parse(fs.readFileSync(required("IAQAR_SERVICE_ACCOUNT_JSON"), "utf8"));
const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth(app);
const db = getFirestore(app);
const email = required("IAQAR_LOGIN_EMAIL").toLowerCase();
const phone = normalizePhone(required("IAQAR_LOGIN_PHONE"));
const user = await auth.getUserByEmail(email);
let officeId = String(process.env.IAQAR_OFFICE_ID || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
if (!officeId) {
  const owned = await db.collection("offices").where("ownerUid", "==", user.uid).limit(2).get();
  if (owned.size !== 1) throw new Error("Could not resolve one office automatically; run again and enter the existing office ID");
  officeId = owned.docs[0].id;
}
const office = await db.collection("offices").doc(officeId).get();
if (!office.exists) throw new Error(`Office ${officeId} does not exist`);
const phoneHash = crypto.createHash("sha256").update(phone).digest("hex");
const directoryRef = db.collection("loginDirectory").doc(phoneHash);
await db.runTransaction(async transaction => {
  const existing = await transaction.get(directoryRef);
  if (existing.exists && existing.data().uid !== user.uid) throw new Error("Phone is already linked to another account");
  transaction.set(directoryRef, { uid: user.uid, officeId, email, phone, active: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  transaction.set(db.collection("offices").doc(officeId).collection("members").doc(user.uid),
    { uid: user.uid, role: "owner", active: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
});
console.log(`Phone login linked successfully for office ${officeId}`);
