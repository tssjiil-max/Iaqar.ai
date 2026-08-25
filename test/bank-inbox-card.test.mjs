import test from "node:test";
import assert from "node:assert/strict";
import {
  BANK_INBOX_STATUS,
  bankInboxMissingLine,
  bankInboxSourceLabel,
  bankInboxStatusKey,
  buildBankInboxCardView,
  sortBankInboxRecords
} from "../public/js/bank-inbox-card-domain.js";
import { buildBankInboxCardHtml } from "../public/js/bank-inbox-card-ui.js";

const readyBase = {
  purpose: "SALE",
  propertyType: "أرض",
  city: "المدينة المنورة",
  district: "عروة",
  area: 1000,
  advertiserRole: "OWNER",
  advertiserPhoneNormalized: "+966501234567"
};

function fixture(id, extra = {}) {
  return { id, ...readyBase, ...extra };
}

export const BANK_INBOX_DEMO_FIXTURES = Object.freeze([
  fixture("1", {
    opportunityKind: "REQUEST",
    purpose: "PURCHASE",
    budget: 650000,
    sourceType: "office_link",
    updatedAt: "2026-08-20T10:00:00.000Z"
  }),
  fixture("2", {
    opportunityKind: "OFFER",
    purpose: "SALE",
    salePrice: 900000,
    district: "شوران",
    sourceType: "office_link",
    updatedAt: "2026-08-20T11:00:00.000Z"
  }),
  fixture("3", {
    opportunityKind: "OFFER",
    salePrice: 800000,
    advertiserPhoneNormalized: "",
    contactPhone: "",
    sourceType: "url",
    updatedAt: "2026-08-21T09:00:00.000Z"
  }),
  fixture("4", {
    opportunityKind: "OFFER",
    salePrice: 0,
    priceOrBudget: 0,
    sourceType: "import",
    updatedAt: "2026-08-21T09:30:00.000Z"
  }),
  fixture("5", {
    opportunityKind: "OFFER",
    salePrice: 0,
    advertiserPhoneNormalized: "",
    sourceType: "whatsapp",
    updatedAt: "2026-08-21T10:00:00.000Z"
  }),
  fixture("6", {
    opportunityKind: "OFFER",
    salePrice: 1200000,
    sourceType: "image",
    updatedAt: "2026-08-19T08:00:00.000Z"
  }),
  fixture("7", {
    opportunityKind: "REQUEST",
    purpose: "PURCHASE",
    budget: 0,
    advertiserPhoneNormalized: "",
    sourceType: "manual",
    updatedAt: "2026-08-22T08:00:00.000Z"
  }),
  fixture("8", {
    opportunityKind: "OFFER",
    salePrice: 750000,
    sourceType: "office_link",
    matchCount: 0,
    updatedAt: "2026-08-18T08:00:00.000Z"
  }),
  fixture("9", {
    opportunityKind: "REQUEST",
    purpose: "PURCHASE",
    budget: 500000,
    sourceType: "office_link",
    activeMatchCount: 2,
    updatedAt: "2026-08-17T08:00:00.000Z"
  }),
  fixture("10", {
    opportunityKind: "OFFER",
    salePrice: 640000,
    sourceType: "manual",
    updatedAt: "2026-08-24T12:00:00.000Z"
  })
]);

test("incomplete items sort above complete items", () => {
  const sorted = sortBankInboxRecords(BANK_INBOX_DEMO_FIXTURES);
  const keys = sorted.map((row) => bankInboxStatusKey(row));
  const firstComplete = keys.findIndex((key) => key !== BANK_INBOX_STATUS.NEEDS_COMPLETION);
  assert.ok(firstComplete > 0);
  assert.equal(keys.slice(0, firstComplete).every((key) => key === BANK_INBOX_STATUS.NEEDS_COMPLETION), true);
  assert.equal(keys.slice(firstComplete).includes(BANK_INBOX_STATUS.NEEDS_COMPLETION), false);
});

test("ready items without matches show قيد المطابقة, never مكتمل", () => {
  const view = buildBankInboxCardView(BANK_INBOX_DEMO_FIXTURES[0]);
  assert.equal(view.statusLabel, "قيد المطابقة");
  assert.equal(view.statusLabel.includes("مكتمل"), false);
  assert.equal(view.kindTitle, "طلب شراء");
  assert.equal(view.sourceLabel, "من رابط المكتب");
});

test("stored match count shows تم العثور على مطابقة without changing matching engine", () => {
  const view = buildBankInboxCardView(BANK_INBOX_DEMO_FIXTURES[8]);
  assert.equal(view.statusLabel, "تم العثور على مطابقة");
  assert.equal(view.statusLabel.includes("تمت المطابقة"), false);
});

test("missing contact uses يحتاج استكمال and ينقص رقم التواصل", () => {
  const view = buildBankInboxCardView(BANK_INBOX_DEMO_FIXTURES[2]);
  assert.equal(view.statusLabel, "يحتاج استكمال");
  assert.equal(view.missingLine, "ينقص رقم التواصل");
  assert.equal(bankInboxSourceLabel(BANK_INBOX_DEMO_FIXTURES[2]), "استيراد إعلان");
});

test("missing price uses ينقص السعر", () => {
  assert.equal(bankInboxMissingLine(BANK_INBOX_DEMO_FIXTURES[3]), "ينقص السعر");
});

test("whatsapp and image sources stay secondary Arabic labels", () => {
  assert.equal(bankInboxSourceLabel(BANK_INBOX_DEMO_FIXTURES[4]), "من واتساب");
  assert.equal(bankInboxSourceLabel(BANK_INBOX_DEMO_FIXTURES[5]), "من صورة");
  assert.equal(bankInboxSourceLabel(BANK_INBOX_DEMO_FIXTURES[6]), "إضافة مباشرة");
});

test("recently completed item stays in the same list below incomplete items", () => {
  const sorted = sortBankInboxRecords(BANK_INBOX_DEMO_FIXTURES);
  const complete = sorted.filter((row) => bankInboxStatusKey(row) !== BANK_INBOX_STATUS.NEEDS_COMPLETION);
  assert.equal(complete[0].id, "10");
  assert.equal(sorted.some((row) => row.id === "10"), true);
});

test("inbox html reuses the opportunity data card instead of a compact duplicate", () => {
  const html = buildBankInboxCardHtml(BANK_INBOX_DEMO_FIXTURES[2]);
  assert.match(html, /class="cv2-card is-collapsed"/);
  assert.match(html, /data-cv2-row="propertyPurpose"/);
  assert.match(html, /data-cv2-row="contact"/);
  assert.match(html, /يحتاج استكمال/);
  assert.match(html, /أكمل البيانات الناقصة/);
  assert.match(html, /عرض التفاصيل/);
  assert.equal(html.includes("bank-inbox-kind"), false);
  assert.equal(html.includes("data-bank-open-details"), false);
  assert.equal(html.includes("مكتمل"), false);
});

test("matching and match-found statuses appear on the same data card", () => {
  const matching = buildBankInboxCardHtml(BANK_INBOX_DEMO_FIXTURES[0]);
  const found = buildBankInboxCardHtml(BANK_INBOX_DEMO_FIXTURES[8]);
  assert.match(matching, /قيد المطابقة/);
  assert.match(matching, /class="cv2-card/);
  assert.equal(matching.includes("أكمل البيانات الناقصة"), false);
  assert.match(found, /تم العثور على مطابقة/);
  assert.match(found, /class="cv2-card/);
  assert.equal(found.includes("تمت المطابقة"), false);
});
