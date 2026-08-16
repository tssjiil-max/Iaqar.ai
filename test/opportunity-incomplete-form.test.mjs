import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIncompleteFormFields,
  contactPartyLabel,
  purposeOptionsForRecord,
  hasCompleteContactPhone,
  mergeIncompleteFormPreview
} from "../public/js/opportunity-workspace-domain.js";
import { evaluateMatchingReadiness } from "../public/js/opportunity-readiness-domain.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

test("missing purpose shows purpose select not propertyType for client request", () => {
  const record = {
    opportunityKind: "REQUEST",
    contactType: "buyer",
    propertyType: "دور",
    city: "الرياض",
    district: "الوبرة",
    budget: 5000,
    advertiserRole: "CLIENT",
    advertiserPhoneNormalized: "+966512345678"
  };
  const readiness = evaluateMatchingReadiness(record);
  assert.ok(readiness.matchingReadinessMissing.includes("purpose"));
  const fields = buildIncompleteFormFields(record, readiness);
  const purposeField = fields.find((f) => f.key === "purpose");
  const propertyField = fields.find((f) => f.key === "propertyType");
  assert.equal(purposeField?.type, "purpose_select");
  assert.equal(purposeField?.label, "الغرض");
  assert.equal(propertyField, undefined);
});

test("owner offer purpose options are sale and rent", () => {
  const opts = purposeOptionsForRecord({ opportunityKind: "OFFER", contactType: "owner" });
  assert.deepEqual(opts.map((o) => o.value), ["SALE", "RENT"]);
  assert.deepEqual(opts.map((o) => o.label), ["بيع", "تأجير"]);
});

test("client request purpose options are purchase and lease", () => {
  const opts = purposeOptionsForRecord({ opportunityKind: "REQUEST", contactType: "buyer" });
  assert.deepEqual(opts.map((o) => o.value), ["PURCHASE", "LEASE_REQUEST"]);
  assert.deepEqual(opts.map((o) => o.label), ["شراء", "إيجار"]);
});

test("after purpose save preview becomes ready when other fields complete", () => {
  const record = {
    opportunityKind: "OFFER",
    contactType: "owner",
    propertyType: "أرض",
    city: "الرياض",
    district: "الوبرة",
    price: 1500000,
    area: 900,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966512345678"
  };
  const readiness = evaluateMatchingReadiness(record);
  assert.ok(readiness.matchingReadinessMissing.includes("purpose"));
  const merged = mergeIncompleteFormPreview(record, { purpose: "SALE" });
  const after = evaluateMatchingReadiness(merged);
  assert.equal(after.isReadyForMatching, true);
  assert.deepEqual(after.matchingReadinessMissing, []);
});

test("stays incomplete when another required field remains", () => {
  const record = {
    opportunityKind: "REQUEST",
    propertyType: "شقة",
    purpose: "PURCHASE"
  };
  const merged = mergeIncompleteFormPreview(record, { purpose: "PURCHASE" });
  const after = evaluateMatchingReadiness(merged);
  assert.equal(after.isReadyForMatching, false);
  assert.ok(after.matchingReadinessMissing.length > 0);
});

test("incomplete form HTML uses purpose select name", () => {
  const ui = readRepo("public", "js", "opportunity-bank-workspace-ui.js");
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(ui.includes('select name="purpose"'));
  assert.ok(ui.includes("purpose_select"));
  assert.equal(bank.includes("purpose: 'input[name=\"propertyType\"]'"), false);
  assert.ok(bank.includes("purpose: 'select[name=\"purpose\"]'"));
});

test("propertyType missing shows نوع العقار field only once", () => {
  const record = { purpose: "SALE", propertyType: "", city: "الرياض", district: "حي", price: 1, advertiserRole: "OWNER", advertiserPhoneNormalized: "+966511122233" };
  const readiness = evaluateMatchingReadiness(record);
  const fields = buildIncompleteFormFields(record, readiness);
  const propertyFields = fields.filter((f) => f.key === "propertyType");
  assert.equal(propertyFields.length, 1);
  assert.equal(propertyFields[0].label, "نوع العقار");
});

test("contact party label never returns raw office for client request", () => {
  assert.equal(contactPartyLabel({ contactType: "buyer", officeId: "office-a" }), "عميل");
  assert.equal(contactPartyLabel({ contactType: "office", officeId: "office-a" }), "مكتب");
});

test("incomplete phone shows full phone field label", () => {
  const record = { purpose: "SALE", propertyType: "شقة", city: "الرياض", district: "الوبرة", price: 1, advertiserRole: "OWNER" };
  const readiness = evaluateMatchingReadiness(record);
  const fields = buildIncompleteFormFields(record, readiness);
  const phone = fields.find((f) => f.key === "contactPhone");
  assert.equal(phone?.label, "رقم الجوال الكامل");
  assert.equal(phone?.type, "phone");
});

test("hasCompleteContactPhone true for valid stored e164", () => {
  assert.equal(hasCompleteContactPhone({ advertiserPhoneNormalized: "+966512345678" }), true);
  assert.equal(hasCompleteContactPhone({ phone: "055" }), false);
});

test("incomplete form disables contact actions when phone incomplete", () => {
  const ui = readRepo("public", "js", "opportunity-bank-workspace-ui.js");
  assert.ok(ui.includes("أكمل رقم الجوال أولًا"));
  assert.ok(ui.includes("bankIncompleteContactActions"));
  assert.ok(ui.includes("bankCompletePhoneBtn"));
  assert.ok(ui.includes("استكمال رقم الجوال"));
  assert.equal(ui.includes("اسم أو وصف المعلن"), false);
  assert.equal(ui.includes("bank-section bank-incomplete-contact"), false);
});

test("merge preview applies phone for readiness after valid local input", () => {
  const record = {
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "الرياض",
    district: "الوبرة",
    price: 1500000,
    advertiserRole: "OWNER"
  };
  const before = evaluateMatchingReadiness(record);
  assert.ok(before.matchingReadinessMissing.includes("contactPhone"));
  const merged = mergeIncompleteFormPreview(record, { advertiserPhoneLocal: "0512345678" });
  const after = evaluateMatchingReadiness(merged);
  assert.equal(after.isReadyForMatching, true);
});
