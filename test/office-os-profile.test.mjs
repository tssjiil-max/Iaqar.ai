import test from "node:test";
import assert from "node:assert/strict";
import { buildOfficeProfile, checkPublicSlug } from "../public/os/domain/office-profile-domain.js";

const base = { officeName: "مكتب النور للعقار", brokerName: "سلطان", licenseNumber: "123", city: "الرياض", phone: "0501234567", whatsapp: "", specialties: ["sale", "bogus"] };

test("valid profile builds clean data", () => {
  const r = buildOfficeProfile(base, { isPlatformAdmin: false });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.specialties, ["sale"]);
  assert.ok(r.data.officeNameKey);
});

test("invalid phone is refused", () => {
  const r = buildOfficeProfile({ ...base, phone: "12345" }, { isPlatformAdmin: false });
  assert.equal(r.ok, false);
  assert.ok(r.errors.phone);
});

test("slug is normalised, not rejected", () => {
  assert.deepEqual(checkPublicSlug("Bad Slug!!"), { ok: true, slug: "bad-slug" });
  assert.equal(checkPublicSlug("sultan-new").slug, "sultan-new");
});
