import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractAdvertiserPhonesFromText,
  normalizeAdvertiserPhoneE164,
  buildAdvertiserCompletionMessage,
  pickPrimaryAdvertiserPhone
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
