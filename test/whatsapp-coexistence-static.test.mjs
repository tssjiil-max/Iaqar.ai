import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("WhatsApp Embedded Signup launches and waits for Business App coexistence", async () => {
  const source = await readFile(new URL("../public/js/whatsapp-office.js", import.meta.url), "utf8");

  assert.match(source, /featureType\s*=\s*"whatsapp_business_app_onboarding"/);
  assert.match(source, /FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING/);
  assert.match(source, /resetSignupCapture\(\)/);
  assert.match(source, /await signupDataReady/);
  assert.match(source, /onboardingMode/);
  assert.match(source, /result\.coexistence/);
});

test("Meta phone state is authoritative before Firestore is marked connected", async () => {
  const source = await readFile(new URL("../worker/src/index.js", import.meta.url), "utf8");
  const start = source.indexOf("async function completeEmbeddedSignup(");
  const end = source.indexOf("\nasync function saveInboundMessage(", start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);

  assert.match(block, /is_on_biz_app/);
  assert.match(block, /platform_type/);
  assert.match(block, /code_verification_status/);
  assert.match(block, /metaPhoneStatus\s*&&\s*metaPhoneStatus\s*!==\s*"CONNECTED"/);
  assert.match(block, /coexistence_not_confirmed/);
  assert.match(block, /isOnBizApp:\s*firestoreBoolean\(isOnBizApp\)/);

  const coexistenceGate = block.indexOf('"coexistence_not_confirmed"');
  const connectedWrite = block.indexOf('status: firestoreString("connected")');
  assert.ok(coexistenceGate >= 0 && connectedWrite > coexistenceGate);
  assert.doesNotMatch(block, /codeVerificationStatus\s*!==\s*"VERIFIED"/);
});

test("Staging explicitly selects coexistence onboarding", async () => {
  const source = await readFile(new URL("../worker/wrangler.toml", import.meta.url), "utf8");
  const stagingStart = source.indexOf("[env.staging.vars]");
  const stagingEnd = source.indexOf("\n[env.staging.ai]", stagingStart);
  assert.ok(stagingStart >= 0 && stagingEnd > stagingStart);
  const block = source.slice(stagingStart, stagingEnd);
  assert.match(block, /META_ONBOARDING_MODE\s*=\s*"coexistence"/);
});
