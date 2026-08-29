import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildOwnerPricingFields,
  clientPurposeFromChip,
  inferClientPurposeChip,
  inferOwnerPurposeChip,
  inferPropertyTypeChip,
  intakePriceFieldLabel,
  ownerPurposeFromChip,
  propertyTypeFromChip
} from "../public/js/public-intake-quick-choice-domain.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const accessGate = readFileSync(join(root, "public", "js", "access-gate.js"), "utf8");

test("owner sale chip preserves OFFER sale semantics", () => {
  const purpose = ownerPurposeFromChip("sale");
  const pricing = buildOwnerPricingFields(purpose, 500000);
  assert.equal(purpose?.purpose, "SALE");
  assert.equal(pricing.transactionType, "sale");
  assert.equal(pricing.purpose, "SALE");
  assert.equal(pricing.salePrice, 500000);
  assert.equal(pricing.annualRent, 0);
});

test("owner rent chip preserves OFFER rent semantics", () => {
  const purpose = ownerPurposeFromChip("rent");
  const pricing = buildOwnerPricingFields(purpose, 48000);
  assert.equal(purpose?.purpose, "RENT");
  assert.equal(pricing.transactionType, "rent");
  assert.equal(pricing.purpose, "RENT");
  assert.equal(pricing.salePrice, 0);
  assert.equal(pricing.annualRent, 48000);
});

test("client purchase chip preserves request purchase semantics", () => {
  const row = clientPurposeFromChip("purchase");
  assert.equal(row?.requestKind, "purchase");
  assert.equal(inferClientPurposeChip("purchase"), "purchase");
});

test("client rent chip preserves request rent semantics", () => {
  const row = clientPurposeFromChip("rent");
  assert.equal(row?.requestKind, "rent");
  assert.equal(inferClientPurposeChip("rent"), "rent");
});

test("property chips map to existing propertyType values", () => {
  assert.equal(propertyTypeFromChip("apartment", ""), "شقة");
  assert.equal(propertyTypeFromChip("villa", ""), "فيلا");
  assert.equal(propertyTypeFromChip("land", ""), "أرض");
  assert.equal(propertyTypeFromChip("building", ""), "عمارة");
});

test("other property chip uses existing free-text propertyType field", () => {
  assert.equal(propertyTypeFromChip("other", "مستودع"), "مستودع");
  assert.equal(inferPropertyTypeChip("مستودع"), "other");
  assert.equal(inferPropertyTypeChip("شقة"), "apartment");
});

test("access-gate exposes quick-choice chips without owner/client wording", () => {
  assert.ok(accessGate.includes("لدي عقار"));
  assert.ok(accessGate.includes("أبحث عن عقار"));
  assert.equal(accessGate.includes("أنا عميل"), false);
  assert.equal(accessGate.includes("أنا مالك"), false);
  assert.ok(accessGate.includes("access-chip"));
  assert.ok(accessGate.includes("propertyTypeOtherInput"));
  assert.ok(accessGate.includes("wireIntakeQuickChoices"));
});

test("infer owner purpose from transaction type", () => {
  assert.equal(inferOwnerPurposeChip("rent"), "rent");
  assert.equal(inferOwnerPurposeChip("sale", "SALE"), "sale");
});

test("dynamic intake price labels follow purpose without changing stored field", () => {
  assert.equal(intakePriceFieldLabel(true, "sale"), "سعر البيع");
  assert.equal(intakePriceFieldLabel(true, "rent"), "الإيجار السنوي");
  assert.equal(intakePriceFieldLabel(false, "purchase"), "الميزانية");
  assert.equal(intakePriceFieldLabel(false, "rent"), "ميزانية الإيجار السنوي");
});

test("intake polish uses red asterisk labels without mandatory Arabic suffix", () => {
  assert.equal(accessGate.includes("(إلزامي)"), false);
  assert.ok(accessGate.includes("access-required-mark"));
  assert.ok(accessGate.includes("updateIntakePriceLabel"));
  assert.ok(accessGate.includes("intakePriceLabel"));
});

test("intake forms unify purpose label and compact voice button", () => {
  assert.ok(accessGate.includes('accessRequiredLabel("الغرض")'));
  assert.equal(accessGate.includes("نوع العرض"), false);
  assert.equal(accessGate.includes("نوع الطلب"), false);
  assert.ok(accessGate.includes("🎙️ إضافة بالصوت"));
  assert.ok(accessGate.includes("access-voice-slot"));
});

test("intake form order places contact fields before submit", () => {
  const formSlice = accessGate.slice(
    accessGate.indexOf("id=\"intakeForm\""),
    accessGate.indexOf("id=\"accessStatus\"")
  );
  const nameIdx = formSlice.indexOf("name=\"name\"");
  const phoneIdx = formSlice.indexOf("name=\"phone\"");
  const submitIdx = formSlice.indexOf("type=\"submit\"");
  assert.ok(nameIdx > 0 && phoneIdx > nameIdx && submitIdx > phoneIdx);
  const purposeIdx = formSlice.indexOf("access-chip-row--purpose");
  const propertyIdx = formSlice.indexOf("access-chip-row--property");
  const cityIdx = formSlice.indexOf("id=\"intakeCityInput\"");
  const priceIdx = formSlice.indexOf("name=\"priceOrBudget\"");
  assert.ok(purposeIdx < propertyIdx && propertyIdx < cityIdx && cityIdx < priceIdx && priceIdx < nameIdx);
});

test("property type chips use balanced grid without commercial chip option", () => {
  assert.ok(accessGate.includes("access-chip-row--property"));
  assert.ok(accessGate.includes("grid-template-columns:repeat(3"));
  assert.ok(accessGate.includes("intake-chip-property-"));
  assert.ok(accessGate.includes("propertyTypeOtherInput"));
});
