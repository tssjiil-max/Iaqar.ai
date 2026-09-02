import test from "node:test";
import assert from "node:assert/strict";
import {
  dynamicFieldDefs,
  propertyCategory,
  buildClientIntakeDocument,
  REQUEST_KINDS
} from "../public/js/public-client-intake-domain.js";

test("propertyCategory classifies land apartment villa", () => {
  assert.equal(propertyCategory("أرض سكنية"), "land");
  assert.equal(propertyCategory("شقة"), "apartment");
  assert.equal(propertyCategory("فيلا"), "villa_house");
});

test("dynamic fields hide rooms for land purchase", () => {
  const fields = dynamicFieldDefs("purchase", "أرض سكنية");
  const names = fields.map((f) => f.name);
  assert.ok(names.includes("budget"));
  assert.ok(names.includes("area"));
  assert.ok(names.includes("streetWidth"));
  assert.equal(names.includes("rooms"), false);
  assert.equal(names.includes("bathrooms"), false);
});

test("rent apartment includes annualRent and furnished", () => {
  const fields = dynamicFieldDefs("rent", "شقة");
  const names = fields.map((f) => f.name);
  assert.ok(names.includes("annualRent"));
  assert.ok(names.includes("furnished"));
  assert.ok(names.includes("paymentInstallments"));
});

test("buildClientIntakeDocument uses canonical field names", () => {
  const doc = buildClientIntakeDocument({
    name: "سلطان محمد",
    phone: "0512345678",
    requestKind: "purchase",
    propertyType: "أرض سكنية",
    city: "المدينة المنورة",
    district: "الرانوناء",
    budget: "580000",
    area: "400",
    streetWidth: "24",
    details: "واجهة شمالية"
  }, { targetOffice: "office-a", source: "platform_public" });
  assert.equal(doc.transactionType, "purchase");
  assert.equal(doc.propertyType, "أرض سكنية");
  assert.equal(doc.city, "المدينة المنورة");
  assert.equal(doc.district, "الرانوناء");
  assert.equal(doc.budget, 580000);
  assert.equal(doc.amount, 580000);
  assert.equal(doc.area, 400);
  assert.equal(doc.streetWidth, 24);
  assert.equal(REQUEST_KINDS.length, 2);
});

test("shared price field is interpreted as request budget for purchase", () => {
  const doc = buildClientIntakeDocument({
    requestKind: "purchase",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "السلام",
    priceOrBudget: "980000",
    phone: "0500000000"
  });
  assert.equal(doc.priceOrBudget, 980000);
  assert.equal(doc.budget, 980000);
  assert.equal(doc.amount, 980000);
});

test("shared price field is interpreted as request annual budget for rent", () => {
  const doc = buildClientIntakeDocument({
    requestKind: "rent",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "السلام",
    priceOrBudget: "35000",
    phone: "0500000000"
  });
  assert.equal(doc.priceOrBudget, 35000);
  assert.equal(doc.annualRent, 35000);
  assert.equal(doc.amount, 35000);
});
