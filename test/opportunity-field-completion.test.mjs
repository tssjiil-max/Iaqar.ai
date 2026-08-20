import test from "node:test";
import assert from "node:assert/strict";
import {
  isDisplayValueComplete,
  isContactPhoneComplete,
  buildOpportunitySpecsLine,
  isSpecsRowComplete,
  isDetailsRowComplete
} from "../public/js/opportunity-field-completion-domain.js";
import { buildOpportunityDetailsViewModel } from "../public/js/opportunity-details-ui.js";

test("isDisplayValueComplete rejects placeholders and empty values", () => {
  assert.equal(isDisplayValueComplete(null), false);
  assert.equal(isDisplayValueComplete(""), false);
  assert.equal(isDisplayValueComplete("   "), false);
  assert.equal(isDisplayValueComplete("غير محدد"), false);
  assert.equal(isDisplayValueComplete("أرض"), true);
  assert.equal(isDisplayValueComplete(500000), true);
  assert.equal(isDisplayValueComplete(0), false);
});

test("isContactPhoneComplete requires valid E.164", () => {
  assert.equal(isContactPhoneComplete("+966501234567"), true);
  assert.equal(isContactPhoneComplete("055123"), false);
  assert.equal(isContactPhoneComplete(""), false);
});

test("buildOpportunitySpecsLine combines area street facade and rooms", () => {
  const line = buildOpportunitySpecsLine({
    area: 1000,
    streetWidth: 20,
    facing: "شمالية",
    rooms: 5
  });
  assert.match(line, /م²/);
  assert.match(line, /شارع/);
  assert.match(line, /واجهة شمالية/);
  assert.match(line, /غرف/);
  assert.equal(isSpecsRowComplete({ area: 1000 }), true);
  assert.equal(isSpecsRowComplete({}), false);
});

test("isDetailsRowComplete maps rows from readiness checks", () => {
  const vm = buildOpportunityDetailsViewModel("opp_row", {
    propertyType: "أرض",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "عروة",
    salePrice: 900000,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966512345678",
    area: 1000
  });
  assert.equal(isDetailsRowComplete(vm, "propertyPurpose"), true);
  assert.equal(isDetailsRowComplete(vm, "location"), true);
  assert.equal(isDetailsRowComplete(vm, "price"), true);
  assert.equal(isDetailsRowComplete(vm, "specs"), true);
  assert.equal(isDetailsRowComplete(vm, "contact"), true);
});
