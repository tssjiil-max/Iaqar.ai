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
