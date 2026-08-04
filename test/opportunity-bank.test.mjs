// Phase 1 Opportunity Bank entry (directive §7.6) and the row projection rules from §13
// and §26: the visible administrative activity summary shows only date added and
// cooperation status, contact information stays hidden by default, and no internal
// technical value is ever projected.

import test from "node:test";
import assert from "node:assert/strict";
import {
  cooperationStatusLabel,
  formatDateAdded,
  opportunityAmountText,
  opportunityBankRow,
  toDateValue
} from "../public/js/office-domain.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

const ownerOffer = {
  officeId: "office-alqiq",
  recordType: "owner_offer",
  city: "المدينة المنورة",
  district: "العزيزية",
  propertyType: "فيلا",
  price: 1500000,
  area: 420,
  rooms: 6,
  contactName: "محمد العلي",
  contactPhone: "0551234567",
  createdAt: new Date("2026-03-14T09:00:00Z"),
  // Internal values that must never reach the broker-facing row:
  confidence: 74,
  completeness: 90,
  missingFieldsJson: '["streetWidth"]',
  matchRuns: 5,
  rawText: "نص الرسالة الأصلي"
};

test("the row identifies the opportunity with the information §13 permits", () => {
  const row = opportunityBankRow("opp_1", ownerOffer);
  assert.equal(row.id, "opp_1");
  assert.equal(row.kindLabel, "عرض مالك");
  assert.equal(row.propertyType, "فيلا");
  assert.equal(row.location, "المدينة المنورة — العزيزية");
  assert.equal(row.amountLabel, "السعر المطلوب");
  assert.ok(row.amountText.includes("ريال"));
  assert.deepEqual(row.attributes.length, 2);
  assert.equal(row.contactName, "محمد العلي");
});

test("the visible activity summary is exactly date added and cooperation status", () => {
  const row = opportunityBankRow("opp_1", ownerOffer);
  assert.ok(row.dateAdded && row.dateAdded !== "غير محدد");
  assert.equal(row.cooperationStatus, "لم تُشارك");
});

test("no internal technical value is projected into the row", () => {
  const row = opportunityBankRow("opp_1", ownerOffer);
  const serialized = JSON.stringify(row);
  for (const forbidden of ["confidence", "completeness", "missingFields", "matchRuns", "rawText", "score", "priority", "workflowStage"]) {
    assert.equal(row[forbidden], undefined, `row must not carry ${forbidden}`);
  }
  assert.equal(serialized.includes("نص الرسالة الأصلي"), false, "the raw source must not leak into the list");
  assert.equal(serialized.includes("74"), false, "the confidence value must not leak");
});

test("contact phone numbers are never projected, only a display name", () => {
  const row = opportunityBankRow("opp_1", ownerOffer);
  assert.equal(JSON.stringify(row).includes("0551234567"), false);
  assert.equal(row.contactPhone, undefined);
  assert.equal(row.phone, undefined);
});

test("a customer request is labelled as a budget, not as an asking price", () => {
  const row = opportunityBankRow("opp_2", {
    recordType: "client_request",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "الدفاع",
    priceMin: 600000,
    priceMax: 750000,
    createdAt: new Date("2026-03-15T09:00:00Z")
  });
  assert.equal(row.kindLabel, "طلب عميل");
  assert.equal(row.amountLabel, "الميزانية");
  assert.ok(row.amountText.includes("—"), `expected a range, got ${row.amountText}`);
});

test("a budget with only an upper bound reads as 'up to'", () => {
  const amount = opportunityAmountText({ recordType: "client_request", priceMax: 800000 });
  assert.ok(amount.value.startsWith("حتى"), amount.value);
});

test("a missing price reads as unspecified rather than as zero", () => {
  for (const record of [{}, { price: 0 }, { priceMin: 0, priceMax: 0 }, { price: null }]) {
    assert.equal(opportunityAmountText(record).value, "غير محدد", JSON.stringify(record));
  }
});

test("unknown or missing fields degrade to explicit Arabic placeholders", () => {
  const row = opportunityBankRow("opp_3", {});
  assert.equal(row.kindLabel, "فرصة");
  assert.equal(row.propertyType, "غير محدد");
  assert.equal(row.location, "غير محدد");
  assert.equal(row.dateAdded, "غير محدد");
  assert.equal(row.cooperationStatus, "لم تُشارك");
  assert.deepEqual(row.attributes, []);
  assert.equal(row.contactName, "");
});

test("cooperation status is rendered from the approved label set only", () => {
  assert.equal(opportunityBankRow("x", { cooperationStatus: "ACTIVE" }).cooperationStatus, "تعاون نشط");
  assert.equal(opportunityBankRow("x", { cooperationStatus: "PENDING_APPROVAL" }).cooperationStatus, "بانتظار الموافقة");
  assert.equal(opportunityBankRow("x", { cooperationStatus: "made_up" }).cooperationStatus, "لم تُشارك");
  assert.equal(cooperationStatusLabel("REJECTED"), "رُفض الطلب");
});

test("Firestore timestamps, ISO strings, Date objects and seconds maps all convert", () => {
  const expected = Date.UTC(2026, 2, 14, 9, 0, 0);
  assert.equal(toDateValue(new Date(expected)).getTime(), expected);
  assert.equal(toDateValue("2026-03-14T09:00:00.000Z").getTime(), expected);
  assert.equal(toDateValue({ toDate: () => new Date(expected) }).getTime(), expected);
  assert.equal(toDateValue({ seconds: expected / 1000 }).getTime(), expected);
});

test("unparseable dates are reported as unspecified rather than as an invalid date", () => {
  for (const value of [null, undefined, "", "not a date", {}, { toDate: () => "nope" }, { toDate: () => { throw new Error("x"); } }]) {
    assert.equal(toDateValue(value), null, JSON.stringify(value));
    assert.equal(formatDateAdded(value), "غير محدد");
  }
});

test("the bank reads only the current office's own opportunities", () => {
  // Phase 3 moved the bank controller out of office-settings.js.
  const bank = readRepositoryFile("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes('collection("offices").doc(officeId())'), "the query must be scoped to this office");
  assert.ok(bank.includes('collection("opportunities")'));
  assert.equal(/\bcollectionGroup\s*\(/.test(bank), false, "a collection-group query would cross offices");
});

test("the bank shows a real empty state and a real error state, not fabricated rows", () => {
  const bank = readRepositoryFile("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("لا توجد فرص محفوظة بعد"), "an empty state message is required");
  assert.ok(bank.includes("تعذر تحميل بنك الفرص"), "an error state message is required");
  assert.equal(/const demo|sampleRows|fakeRows/.test(bank), false, "no seeded rows may exist");
});

test("the bank list markup escapes every projected value", () => {
  const bank = readRepositoryFile("public", "js", "opportunity-bank.js");
  const start = bank.indexOf("function renderList(");
  const end = bank.indexOf("async function lazyLoadSource(");
  assert.ok(start >= 0 && end > start, "renderList must exist in opportunity-bank.js");
  const renderer = bank.slice(start, end);
  const interpolations = [...renderer.matchAll(/\$\{([^}]+)\}/g)].map(match => match[1].trim());
  assert.ok(interpolations.length > 0, "list template must interpolate fields");
  for (const expression of interpolations) {
    assert.ok(
      expression.startsWith("escapeHtml(")
        || expression.startsWith("row.attributes.length ?")
        || expression.startsWith("state.selected.has("),
      `unescaped interpolation in the bank list: ${expression}`
    );
  }
});
