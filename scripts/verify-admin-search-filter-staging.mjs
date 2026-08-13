#!/usr/bin/env node
/**
 * Staging verification for admin SEARCH/FILTER/SORT API behavior.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "../admin/package.json"));
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const PROJECT = "iaqar-ai-staging";
const WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const ADMIN_EMAIL = process.env.IAQAR_STAGING_ADMIN_EMAIL || "admin-e2e@iaqar-ai.internal";

async function getAdminIdToken() {
  const init = await (await fetch(`https://iaqar-ai-staging.web.app/__/firebase/init.json`)).json();
  const { serviceAccount } = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT);
  if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
  const user = await getAuth().getUserByEmail(ADMIN_EMAIL);
  const customToken = await getAuth().createCustomToken(user.uid);
  const signIn = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(init.apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true })
    }
  );
  const body = await signIn.json();
  if (!body.idToken) throw new Error("Admin sign-in failed");
  return body.idToken;
}

async function api(idToken, query) {
  const response = await fetch(`${WORKER}/admin/offices?${query}`, {
    headers: { Authorization: `Bearer ${idToken}` }
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

function allMatch(list, predicate) {
  return Array.isArray(list) && list.length > 0 && list.every(predicate);
}

async function main() {
  const idToken = await getAdminIdToken();
  const all = await api(idToken, "tab=all");
  if (all.status !== 200 || !all.payload.ok) throw new Error("Failed to load all offices");
  const offices = all.payload.offices || [];
  if (!offices.length) throw new Error("No offices on staging");

  const sample = offices.find(o => o.officeName) || offices[0];
  const q = encodeURIComponent(String(sample.officeName || sample.officeId).slice(0, 6));
  const searchRes = await api(idToken, `tab=all&q=${q}`);
  const searchOk = searchRes.status === 200 && (searchRes.payload.offices || []).some(
    o => String(o.officeName || "").toLowerCase().includes(decodeURIComponent(q).toLowerCase())
      || String(o.officeId || "").toLowerCase().includes(decodeURIComponent(q).toLowerCase())
  );

  const city = sample.city ? encodeURIComponent(sample.city) : "";
  const cityOk = city
    ? (await api(idToken, `tab=all&city=${city}`)).payload.offices?.every(o => o.city === sample.city)
    : true;

  const approvedRes = await api(idToken, "tab=all&approvalStatus=approved");
  const approvedOk = allMatch(approvedRes.payload.offices, o => o.approvalStatus === "approved");

  const activeRes = await api(idToken, "tab=all&accountStatus=active");
  const activeOk = allMatch(activeRes.payload.offices, o => o.accountStatus === "active");

  const inactiveRes = await api(idToken, "tab=all&activityLevel=inactive");
  const inactiveOk = inactiveRes.status === 200
    && (inactiveRes.payload.offices || []).every(o => o.activityLevel === "inactive");

  const sortRes = await api(idToken, "tab=all&sort=oldest");
  const sorted = sortRes.payload.offices || [];
  const ts = v => Date.parse(v || "") || 0;
  const sortOk = sorted.length < 2 || ts(sorted[0].registrationSubmittedAt || sorted[0].createdAt)
    <= ts(sorted[sorted.length - 1].registrationSubmittedAt || sorted[sorted.length - 1].createdAt);

  const pass = searchOk && cityOk && approvedOk && activeOk && inactiveOk && sortOk;
  console.log(`SEARCH/FILTER/SORT: ${pass ? "PASS" : "FAIL"}`);
  console.log(JSON.stringify({ searchOk, cityOk, approvedOk, activeOk, inactiveOk, sortOk }, null, 2));
  if (!pass) process.exit(1);
}

main().catch((error) => {
  console.error("VERIFY_FAILED:", error.message || error);
  console.log("SEARCH/FILTER/SORT: FAIL");
  process.exit(1);
});
