import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";
import { buildBankListCardView } from "../public/js/bank-list-card-domain.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

test("bank list card header has badge title and status aligned", () => {
  const html = readRepo("public", "js", "opportunity-bank.js");
  const inbox = readRepo("public", "js", "bank-inbox-card-ui.js");
  assert.ok(html.includes("buildBankInboxCardHtml"));
  assert.ok(inbox.includes("bank-inbox-head"));
  assert.ok(inbox.includes("bank-inbox-kind"));
  assert.ok(inbox.includes("bank-readiness-badge"));
  const shell = readRepo("public", "index.html");
  assert.ok(shell.includes(".bank-inbox-head"));
  assert.ok(shell.includes("align-items:center"));
});

test("bank list card uses stats grid for price area rooms", () => {
  const card = buildBankListCardView({
    id: "opp_1",
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "دور",
    city: "المدينة المنورة",
    district: "الرانوناء",
    price: 500000,
    area: 680,
    rooms: 6
  });
  assert.ok(card.priceText.includes("٥٠٠") || card.priceText.includes("500"));
  assert.ok(card.areaText.includes("٦٨٠") || card.areaText.includes("680"));
  assert.equal(card.roomsText, "6");
  assert.equal(card.location.includes("المدينة المنورة"), true);
});

test("land property hides rooms on bank card", () => {
  const card = buildBankListCardView({
    id: "opp_land",
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "أرض",
    area: 1200,
    rooms: 4
  });
  assert.equal(card.roomsText, "");
});

test("missing fields collapse to one readiness line", () => {
  const card = buildBankListCardView({
    id: "opp_incomplete",
    opportunityKind: "REQUEST",
    purpose: "PURCHASE",
    propertyType: "شقة",
    city: "الرياض"
  });
  assert.match(card.readinessLine, /^ينقص:/);
  assert.equal(card.headerStatus, "تحتاج استكمال");
  assert.equal(card.isReadyForMatching, false);
});

test("ready card shows جاهزة للمطابقة without غير محدد", () => {
  const card = buildBankListCardView({
    id: "opp_ready",
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "الوبرة",
    price: 900000,
    area: 160,
    rooms: 4,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966501234567",
    advertiserDisplayName: "سلطان"
  });
  assert.equal(card.readinessLine, "جاهزة للمطابقة");
  assert.equal(card.headerStatus, "جاهزة للمطابقة");
  assert.equal(card.priceText.includes("غير محدد"), false);
  assert.ok(card.contactLineMarkup.includes("phone-ltr"));
});

test("Arabic normalization on bank card display only", () => {
  const card = buildBankListCardView({
    id: "opp_ar",
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "office",
    city: "Riyadh",
    district: "Al-Wabra",
    price: 1000000,
    area: 200
  });
  assert.equal(card.title.includes("مكتب"), true);
  assert.equal(card.location.includes("الرياض"), true);
  assert.equal(card.location.includes("الوبرة"), true);
  assert.equal(card.location.includes("حي حي"), false);
});

test("match score hidden unless computed", () => {
  const hidden = buildBankListCardView({ id: "a", propertyType: "شقة", bestMatchScore: 82 });
  assert.equal(hidden.bestMatchScoreText, "");
  const shown = buildBankListCardView(
    { id: "b", propertyType: "شقة", bestMatchScore: 82, bestMatchComputed: true },
    { bestMatchScore: 82, bestMatchComputed: true }
  );
  assert.equal(shown.bestMatchScoreText, "82%");
});

test("bank row opens details from عرض التفاصيل", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  const ui = readRepo("public", "js", "bank-inbox-card-ui.js");
  assert.ok(bank.includes("bank-row-card"));
  assert.ok(bank.includes("openBankDetailFromList"));
  assert.ok(ui.includes("عرض التفاصيل"));
  assert.ok(bank.includes("keydown"));
});

test("DOM bank card keyboard opens detail with correct id", () => {
  const dom = new JSDOM(`<div id="opportunityBankList"></div>`, { url: "https://example.test/" });
  const doc = dom.window.document;
  const list = doc.getElementById("opportunityBankList");
  list.innerHTML = `<article class="bank-row bank-row-card" role="button" tabindex="0" data-opportunity-id="opp_test_1" data-open-id="opp_test_1" aria-label="test"></article>`;
  const row = list.querySelector(".bank-row-card");
  assert.equal(row.getAttribute("data-opportunity-id"), "opp_test_1");
  assert.equal(row.tagName, "ARTICLE");
  assert.equal(row.getAttribute("role"), "button");
});

test("bank card HTML uses compact details control without a complete button", () => {
  const ui = readRepo("public", "js", "bank-inbox-card-ui.js");
  assert.match(ui, /عرض التفاصيل/);
  assert.equal(ui.includes("data-complete-id"), false);
});
