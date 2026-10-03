import test from "node:test";
import assert from "node:assert/strict";
import { validateBrokerApplication, mapApplyError, mapAuthError, resetMessage } from "../public/os/domain/auth-flows-domain.js";

const good = { brokerName: "فهد", phone: "٠٥٠١٢٣٤٥٦٧", email: " Fahad@Test.com ", falLicense: "12000-99999", officeName: "مكتب الاختبار", password: "12345678" };

test("a complete application is normalised (local phone, lower-case email, digits-only licence)", () => {
  const r = validateBrokerApplication(good);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { brokerName: "فهد", phone: "0501234567", email: "fahad@test.com", falLicense: "1200099999", officeName: "مكتب الاختبار" });
});

test("every required field is reported and nothing passes when empty", () => {
  const r = validateBrokerApplication({});
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ["brokerName", "email", "falLicense", "officeName", "password", "phone"]);
});

test("short password, bad email, short office name, non-Saudi phone are rejected", () => {
  const r = validateBrokerApplication({ ...good, password: "1234567", email: "x", officeName: "abc", phone: "0412345678" });
  assert.deepEqual(Object.keys(r.errors).sort(), ["email", "officeName", "password", "phone"]);
});

test("server and auth errors land on the right field", () => {
  assert.equal(mapApplyError({ code: "email_already_used", message: "x" }).field, "email");
  assert.equal(mapApplyError({ code: "phone_already_used", message: "x" }).field, "phone");
  assert.equal(mapApplyError({ code: "fal_already_used", message: "x" }).field, "falLicense");
  assert.equal(mapApplyError({ code: "pilot_registration_closed", message: "مغلق" }).field, "");
  assert.equal(mapAuthError("auth/email-already-in-use").field, "email");
  assert.equal(mapAuthError("auth/weak-password").field, "password");
  assert.equal(mapAuthError("other").field, "");
});

test("reset message shows only a masked email, or a generic line", () => {
  assert.match(resetMessage({ maskedEmail: "s***@x.com" }), /s\*\*\*@x\.com/);
  assert.match(resetMessage({}), /إذا كان الرقم مسجلًا/);
});
