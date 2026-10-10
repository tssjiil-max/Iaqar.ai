import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { foldListing, kapsoConfig, kapsoMessages, saudiMobile, verifyKapsoSignature } from "../worker/src/office-os/kapso-service.js";

test("Staging only, and only when configured", () => {
  assert.equal(kapsoConfig({ DEPLOYMENT_ENV: "production", KAPSO_WEBHOOK_SECRET: "s", KAPSO_OFFICE_ID: "o", KAPSO_PHONE_NUMBER_ID: "1" }).reason, "not_staging");
  assert.equal(kapsoConfig({ DEPLOYMENT_ENV: "staging" }).reason, "secret_missing");
  assert.equal(kapsoConfig({ DEPLOYMENT_ENV: "staging", KAPSO_WEBHOOK_SECRET: "s", KAPSO_OFFICE_ID: "o", KAPSO_PHONE_NUMBER_ID: "597907523413541" }).enabled, true);
});

test("signature: hex HMAC-SHA256 of the raw body", async () => {
  const raw = '{"a":1}';
  const good = crypto.createHmac("sha256", "secret").update(raw).digest("hex");
  assert.equal(await verifyKapsoSignature(raw, good, "secret"), true);
  assert.equal(await verifyKapsoSignature(raw + " ", good, "secret"), false);
  assert.equal(await verifyKapsoSignature(raw, good, "other"), false);
  assert.equal(await verifyKapsoSignature(raw, "", "secret"), false);
});

test("single and batched payloads", () => {
  const one = { message: { id: "wamid.1", type: "text", from: "966552019909", text: { body: "مرحبا" }, kapso: { direction: "inbound" } }, conversation: { contact_name: "x" }, phone_number_id: "597907523413541" };
  assert.equal(kapsoMessages(one)[0].body, "مرحبا");
  const batch = { type: "whatsapp.message.received", batch: true, data: [one, { ...one, message: { ...one.message, id: "wamid.2" } }], batch_info: {} };
  assert.deepEqual(kapsoMessages(batch).map((m) => m.id), ["wamid.1", "wamid.2"]);
});

test("Saudi mobile only", () => {
  assert.equal(saudiMobile("966552019909"), "0552019909");
  assert.equal(saudiMobile("16315551181"), "");
});

test("a conversation: short answers and corrections", () => {
  const l = foldListing([{ t: "مطلوب عمارة في الهجرة، الميزانية مليونين.", a: "" }, { t: "الرياض", a: "city" }, { t: "لا، الميزانية 2.1 مليون", a: "" }]);
  assert.deepEqual([l.kind, l.purpose, l.city, l.districts.join(), l.price, l.missing.length], ["REQUEST", "PURCHASE", "الرياض", "الهجرة", 2_100_000, 0]);
});
