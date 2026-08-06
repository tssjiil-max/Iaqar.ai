// ACCEPTANCE TEST 3 — office name validation (pure logic half).
// Directive §7.3: at least 4 visible characters, more allowed, unique system-wide,
// validated after trimming, equivalent duplicates rejected after normalization, Arabic
// and Latin supported, blank/whitespace-only rejected.

import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICE_NAME_MESSAGES,
  normalizeOfficeName,
  normalizeOfficeNameKey,
  significantCharacterCount,
  validateOfficeName
} from "../public/js/office-domain.js";

test("blank and whitespace-only office names are rejected", () => {
  for (const value of ["", "   ", "\t\n ", null, undefined]) {
    assert.equal(validateOfficeName(value), OFFICE_NAME_MESSAGES.empty, `value: ${JSON.stringify(value)}`);
  }
});

test("names with fewer than four visible characters are rejected", () => {
  for (const value of ["م", "مك", "مكت", "a", "ab", "abc", "م ك ت", "a.b-c", "__--..", "1 2 3"]) {
    assert.equal(
      validateOfficeName(value),
      OFFICE_NAME_MESSAGES.tooShort,
      `expected rejection for ${JSON.stringify(value)}`
    );
  }
});

test("separators and punctuation do not count as visible characters", () => {
  assert.equal(significantCharacterCount("م ك ت"), 3);
  assert.equal(significantCharacterCount("a.b-c_d"), 4);
  assert.equal(significantCharacterCount("   مكتب   "), 4);
  assert.equal(significantCharacterCount(""), 0);
});

test("four or more visible characters are accepted, in Arabic and in Latin", () => {
  for (const value of [
    "مكتب",
    "ABCD",
    "مكتب المسار",
    "مكتب المسار العقاري",
    "Al Masar Real Estate",
    "مكتب 2030"
  ]) {
    assert.equal(validateOfficeName(value), "", `expected acceptance for ${JSON.stringify(value)}`);
  }
});

test("the minimum is a floor, not an equality — longer names stay valid", () => {
  const growing = "مكتب";
  for (let extra = 0; extra < 20; extra += 1) {
    assert.equal(validateOfficeName(growing + "ا".repeat(extra)), "");
  }
});

test("names containing characters outside the allowed set are rejected", () => {
  for (const value of ["مكتب<script>", "office@home", "مكتب/العقار", "office;drop", "مكتب#1"]) {
    assert.equal(
      validateOfficeName(value),
      OFFICE_NAME_MESSAGES.characters,
      `expected rejection for ${JSON.stringify(value)}`
    );
  }
});

test("names longer than 80 characters are rejected", () => {
  assert.equal(validateOfficeName("م".repeat(81)), OFFICE_NAME_MESSAGES.tooLong);
  assert.equal(validateOfficeName("م".repeat(80)), "");
});

test("platform admins may use short reserved names", () => {
  assert.equal(validateOfficeName("مكت", { isPlatformAdmin: true }), "");
  assert.equal(validateOfficeName("م", { isPlatformAdmin: true }), "");
  assert.equal(validateOfficeName("", { isPlatformAdmin: true }), OFFICE_NAME_MESSAGES.empty);
});

test("the display name is trimmed and whitespace-collapsed but never otherwise altered", () => {
  assert.equal(normalizeOfficeName("  مكتب   المسار  "), "مكتب المسار");
  assert.equal(normalizeOfficeName("مكتب الأمل"), "مكتب الأمل", "hamza must survive in the display name");
  assert.equal(normalizeOfficeName("Al  Masar"), "Al Masar");
});

test("equivalent Arabic spellings normalize to the same uniqueness key", () => {
  const groups = [
    ["مكتب الأمل", "مكتب الامل", "  مكتب   الأمل  ", "مكتب الآمل", "مكتب الإمل"],
    ["مكتب الرؤية", "مكتب الروية"],
    ["دار الهدى", "دار الهدي"],
    ["شركة النخبة", "شركة النخبه"],
    ["مكتب المنى", "مكتب المني"]
  ];
  for (const group of groups) {
    const keys = group.map(normalizeOfficeNameKey);
    assert.equal(new Set(keys).size, 1, `expected one key for ${JSON.stringify(group)}, got ${JSON.stringify(keys)}`);
    assert.ok(keys[0].length >= 4, `key must remain non-trivial: ${keys[0]}`);
  }
});

test("diacritics and tatweel are ignored when comparing names", () => {
  const base = normalizeOfficeNameKey("مكتب الأمل");
  assert.equal(normalizeOfficeNameKey("مَكْتَب الأَمَل"), base);
  assert.equal(normalizeOfficeNameKey("مكتب الأمـــل"), base);
});

test("Latin case and full-width forms normalize to the same key", () => {
  const keys = ["AlMasar", "almasar", "ALMASAR", "ＡＬＭＡＳＡＲ", " al masar ", "al-masar", "al.masar"]
    .map(normalizeOfficeNameKey);
  assert.equal(new Set(keys).size, 1, JSON.stringify(keys));
  assert.equal(keys[0], "almasar");
});

test("genuinely different names keep different keys", () => {
  const distinct = ["مكتب الأمل", "مكتب النور", "مكتب المسار", "almasar", "alnoor"];
  const keys = distinct.map(normalizeOfficeNameKey);
  assert.equal(new Set(keys).size, distinct.length, JSON.stringify(keys));
});

test("a whitespace-only or punctuation-only name yields no key, so it can never be claimed", () => {
  assert.equal(normalizeOfficeNameKey("   "), "");
  assert.equal(normalizeOfficeNameKey("..--__"), "");
  assert.equal(validateOfficeName("..--__"), OFFICE_NAME_MESSAGES.tooShort);
});

test("the uniqueness key is capped so it always fits the claim document id", () => {
  assert.equal(normalizeOfficeNameKey("م".repeat(400)).length, 100);
});
