import assert from "node:assert/strict";
import {
  isReservedInvalidEmail,
  sanitizePasswordResetResponse
} from "../src/password-recovery-guard.js";

assert.equal(isReservedInvalidEmail("st********@example.invalid"), true);
assert.equal(isReservedInvalidEmail("user@invalid"), true);
assert.equal(isReservedInvalidEmail("user@example.com"), false);
assert.equal(isReservedInvalidEmail(""), false);

{
  const original = {
    ok: true,
    requestId: "req-1",
    maskedEmail: "st********@example.invalid"
  };
  const sanitized = sanitizePasswordResetResponse(original);
  assert.deepEqual(sanitized, { ok: true, requestId: "req-1" });
  assert.equal(Object.hasOwn(sanitized, "maskedEmail"), false);
}

{
  const original = {
    ok: true,
    requestId: "req-2",
    maskedEmail: "su***@example.com"
  };
  const sanitized = sanitizePasswordResetResponse(original);
  assert.equal(sanitized, original);
}

console.log("password recovery guard tests passed");
