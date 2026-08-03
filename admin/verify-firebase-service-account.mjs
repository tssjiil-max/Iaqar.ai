import fs from "node:fs";
import { createSign } from "node:crypto";

const EXPECTED_PROJECT_ID = "aqar-b5d76";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

function fail(message) {
  console.error(`Firebase credential check failed: ${message}`);
  process.exit(1);
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

const filePath = process.argv[2];
if (!filePath) fail("No service account JSON file was provided.");

let serviceAccount;
try {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  serviceAccount = JSON.parse(raw);
} catch {
  fail("The selected JSON file could not be read.");
}

for (const field of ["project_id", "client_email", "private_key", "private_key_id"]) {
  if (!String(serviceAccount[field] || "").trim()) fail(`The JSON file is missing ${field}.`);
}
if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
  fail(`This key belongs to ${serviceAccount.project_id}, not ${EXPECTED_PROJECT_ID}.`);
}

const now = Math.floor(Date.now() / 1000);
const header = { alg: "RS256", typ: "JWT", kid: String(serviceAccount.private_key_id).trim() };
const claims = {
  iss: String(serviceAccount.client_email).trim(),
  scope: GOOGLE_SCOPE,
  aud: GOOGLE_TOKEN_URL,
  iat: now,
  exp: now + 3600
};
const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;

let assertion;
try {
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  assertion = `${unsigned}.${signer.sign(String(serviceAccount.private_key).trim()).toString("base64url")}`;
} catch {
  fail("The private key cannot create an RSA-SHA256 signature.");
}

let response;
try {
  response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
} catch {
  fail("Google could not be reached. Check the internet connection and try again.");
}

const responseText = await response.text();
if (!response.ok) {
  let details = {};
  try { details = JSON.parse(responseText); } catch { details = {}; }
  const code = String(details.error || `HTTP ${response.status}`).slice(0, 80);
  const description = String(details.error_description || "Google rejected the signed credential.").slice(0, 300);
  fail(`${code}: ${description}`);
}

let token;
try { token = JSON.parse(responseText); } catch { token = {}; }
if (!token.access_token) fail("Google did not return an access token.");

console.log(`Google accepted the Firebase key for ${serviceAccount.client_email}.`);
console.log("No private key or access token was printed or saved.");
