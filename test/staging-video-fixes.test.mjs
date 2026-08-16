import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDataCompleteness,
  DATA_COMPLETENESS
} from "../public/js/opportunity-status-domain.js";
import {
  buildEditPatch,
  shareRequestStatusLabel
} from "../public/js/opportunity-bank-domain.js";
import {
  buildAdvertiserDataPatch,
  maskPhoneForDisplay
} from "../public/js/advertiser-phone-domain.js";
import {
  contactLineMarkup,
  buildOpportunityCardView
} from "../public/js/opportunity-card-domain.js";
import {
  sanitizeOpportunityPatch,
  validateCooperationListingEnable
} from "../worker/src/opportunity-patch-service.js";
import { resolveNearbyEmptyReason } from "../worker/src/cooperation-nearby-service.js";

test("readiness never shows complete when budget missing", () => {
  const record = {
    purpose: "PURCHASE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي",
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966512345678",
    area: 120,
    rooms: 3
  };
  const completeness = normalizeDataCompleteness(record);
  assert.equal(completeness, DATA_COMPLETENESS.INCOMPLETE);
  const card = buildOpportunityCardView(record);
  assert.equal(card.dataCompletenessLabel, "ناقصة");
  assert.match(card.missingFieldsBanner, /الميزانية/);
});

test("buildEditPatch skips empty numeric fields without wiping", () => {
  const existing = {
    purpose: "PURCHASE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي",
    priceOrBudget: 400000,
    area: 100
  };
  const result = buildEditPatch(existing, {
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي",
    priceOrBudget: "",
    area: "150",
    rooms: ""
  });
  assert.equal(result.ok, true);
  assert.equal(result.patch.priceOrBudget, undefined);
  assert.equal(result.patch.area, 150);
  assert.equal(result.patch.rooms, undefined);
});

test("buildAdvertiserDataPatch preserves phone when input empty", () => {
  const existing = {
    advertiserPhoneNormalized: "+966512345678",
    advertiserPhoneRaw: "0512345678",
    advertiserRole: "OWNER"
  };
  const result = buildAdvertiserDataPatch(existing, {
    advertiserDisplayName: "محمد",
    advertiserPhoneLocal: "",
    advertiserRole: "OWNER"
  });
  assert.equal(result.ok, true);
  assert.equal(result.patch.advertiserPhoneNormalized, undefined);
});

test("share and cooperation statuses are Arabic", () => {
  assert.equal(shareRequestStatusLabel("PENDING"), "بانتظار رد المكتب");
  assert.equal(shareRequestStatusLabel("ACCEPTED"), "قَبِل المكتب");
  assert.equal(shareRequestStatusLabel("REJECTED"), "اعتذر المكتب");
  assert.equal(shareRequestStatusLabel("ENDED"), "منتهية");
});

test("contact line uses LTR phone span", () => {
  const markup = contactLineMarkup({
    advertiserDisplayName: "محمد",
    advertiserPhoneNormalized: "+966512345678"
  });
  assert.match(markup, /phone-ltr/);
  assert.match(markup, /dir="ltr"/);
  assert.ok(markup.includes(maskPhoneForDisplay("+966512345678")));
});

test("property type office is Arabic in card", () => {
  const card = buildOpportunityCardView({
    propertyType: "office",
    purpose: "SALE"
  });
  assert.match(card.description, /مكتب/);
});

test("worker patch rejects cooperation enable when incomplete", () => {
  const gate = validateCooperationListingEnable({
    purpose: "PURCHASE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي"
  });
  assert.equal(gate.ok, false);
  assert.ok(gate.missing.includes("priceOrBudget"));
});

test("worker patch strips protected fields", () => {
  const patch = sanitizeOpportunityPatch({
    brokerId: "hijack",
    officeId: "other",
    priceOrBudget: 500000,
    cooperationListing: "OPEN"
  });
  assert.equal(patch.brokerId, undefined);
  assert.equal(patch.officeId, undefined);
  assert.equal(patch.priceOrBudget, 500000);
});

test("nearby empty reason distinguishes incomplete vs not enabled", () => {
  const incomplete = resolveNearbyEmptyReason({ purpose: "SALE" }, []);
  assert.equal(incomplete.code, "incomplete_data");
  const notEnabled = resolveNearbyEmptyReason({
    purpose: "SALE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي",
    salePrice: 500000,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966512345678"
  }, []);
  assert.equal(notEnabled.code, "not_enabled");
});
