import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractAdvertiserPhonesFromText,
  normalizeAdvertiserPhoneE164,
  buildAdvertiserCompletionMessage,
  buildAdvertiserWhatsAppMessage,
  buildAdvertiserDataPatch,
  buildAdvertiserGreeting,
  normalizeAdvertiserRoleInput,
  isRealAdvertiserNameForGreeting,
  pickPrimaryAdvertiserPhone,
  validateAdvertiserPhoneLocalInput,
  safeAdvertiserDisplayName,
  setAdvertiserMessageModalContext,
  getAdvertiserMessageModalContext,
  clearAdvertiserMessageModalContext
} from "../public/js/advertiser-phone-domain.js";

test("extracts phone from whatsapp contact line", () => {
  const hits = extractAdvertiserPhonesFromText("للتواصل واتساب 0551234567");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].advertiserPhoneNormalized, "+966551234567");
});

test("does not extract phone from fal license and price line", () => {
  const hits = extractAdvertiserPhonesFromText("رقم رخصة فال 1010101 والسعر 22000");
  assert.equal(hits.length, 0);
});

test("extracts owner phone with country code", () => {
  const hits = extractAdvertiserPhonesFromText("جوال المالك +966551234567");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].advertiserPhoneNormalized, "+966551234567");
});

test("empty text yields no phones", () => {
  assert.equal(extractAdvertiserPhonesFromText("").length, 0);
});

test("two phones returns both without auto pick", () => {
  const hits = extractAdvertiserPhonesFromText("جوال المالك 0551111111 وواتساب 0552222222");
  assert.equal(hits.length, 2);
  assert.equal(pickPrimaryAdvertiserPhone(hits), null);
});

test("normalize E.164 variants", () => {
  assert.equal(normalizeAdvertiserPhoneE164("0551234567"), "+966551234567");
  assert.equal(normalizeAdvertiserPhoneE164("551234567"), "+966551234567");
  assert.equal(normalizeAdvertiserPhoneE164("966551234567"), "+966551234567");
  assert.equal(normalizeAdvertiserPhoneE164("+966551234567"), "+966551234567");
});

test("completion message has no undefined", () => {
  const msg = buildAdvertiserCompletionMessage({});
  assert.ok(!msg.includes("undefined"));
  assert.ok(!msg.includes("null"));
});

test("whatsapp cooperation message has no undefined", () => {
  const msg = buildAdvertiserWhatsAppMessage({
    brokerName: "وسيط",
    officeName: "مكتب",
    licenseNumber: "12345",
    propertyType: "شقة",
    district: "العوالي",
    city: "المدينة",
    officeLink: "https://example.com/o/test",
    advertiserDisplayName: "أبو محمد"
  });
  assert.ok(!msg.includes("undefined"));
  assert.ok(!msg.includes("null"));
  assert.ok(msg.includes("أبو محمد"));
  assert.ok(msg.includes("أستاذ"));
  assert.ok(!msg.includes("أستاذ/أبو"));
  assert.ok(msg.includes("شقة"));
  assert.ok(msg.includes("https://example.com/o/test"));
});

test("greeting uses generic salutation for role descriptors", () => {
  assert.equal(buildAdvertiserGreeting("وسيط"), "السلام عليكم");
  assert.equal(buildAdvertiserGreeting("مالك شقة العوالي"), "السلام عليكم");
  assert.equal(buildAdvertiserGreeting("أحمد"), "السلام عليكم أستاذ أحمد");
  assert.ok(!buildAdvertiserWhatsAppMessage({ advertiserDisplayName: "وسيط" }).includes("أبو"));
});

test("whatsapp message without license omits fal phrase", () => {
  const msg = buildAdvertiserWhatsAppMessage({ officeName: "مكتب", brokerName: "وسيط" });
  assert.ok(!msg.includes("رقم فال"));
});

test("validate phone local rejects invalid", () => {
  const bad = validateAdvertiserPhoneLocalInput("12345");
  assert.equal(bad.ok, false);
  const good = validateAdvertiserPhoneLocalInput("551234567");
  assert.equal(good.ok, true);
  assert.equal(good.e164, "+966551234567");
});

test("buildAdvertiserDataPatch stores display name", () => {
  const result = buildAdvertiserDataPatch({}, {
    advertiserDisplayName: "مالك شقة العوالي",
    advertiserPhoneLocal: "551234567",
    advertiserRole: "OWNER"
  });
  assert.equal(result.ok, true);
  assert.equal(result.patch.advertiserDisplayName, "مالك شقة العوالي");
  assert.equal(result.patch.advertiserPhoneNormalized, "+966551234567");
});

test("normalizeAdvertiserRoleInput maps Arabic labels to enum ids", () => {
  assert.equal(normalizeAdvertiserRoleInput("مالك"), "OWNER");
  assert.equal(normalizeAdvertiserRoleInput("وسيط"), "BROKER");
  assert.equal(normalizeAdvertiserRoleInput("وسيط عقاري"), "BROKER");
  assert.equal(normalizeAdvertiserRoleInput("مفوض"), "DELEGATE");
  assert.equal(normalizeAdvertiserRoleInput("عميل"), "CLIENT");
  assert.equal(normalizeAdvertiserRoleInput("OWNER"), "OWNER");
  assert.equal(normalizeAdvertiserRoleInput("unknown text", { fallback: "" }), "");
});

test("buildAdvertiserDataPatch normalizes Arabic advertiser role", () => {
  const owner = buildAdvertiserDataPatch({}, { advertiserRole: "مالك" });
  assert.equal(owner.ok, true);
  assert.equal(owner.patch.advertiserRole, "OWNER");

  const broker = buildAdvertiserDataPatch({}, { advertiserRole: "وسيط" });
  assert.equal(broker.ok, true);
  assert.equal(broker.patch.advertiserRole, "BROKER");
});

test("readAdvertiserDisplayName falls back to contactName from public intake", async () => {
  const { readAdvertiserDisplayName } = await import("../public/js/advertiser-phone-domain.js");
  assert.equal(
    readAdvertiserDisplayName({ contactName: "سلطان الصاعدي", advertiserDisplayName: "" }),
    "سلطان الصاعدي"
  );
  assert.equal(
    readAdvertiserDisplayName({ advertiserDisplayName: "أحمد", contactName: "قديم" }),
    "أحمد"
  );
});
