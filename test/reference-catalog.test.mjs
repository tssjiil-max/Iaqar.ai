import test from "node:test";
import assert from "node:assert/strict";
import {
  DISTRICTS,
  DISTRICT_OTHER_ID,
  OPERATION_TYPES,
  PROPERTY_TYPES,
  buildReviewDefaults,
  districtsForCity,
  filterBySearch,
  matchDistrict,
  reviewValuesToBrokerFields
} from "../public/js/reference-catalog.js";

test("reference catalog exposes operation and property types", () => {
  assert.equal(OPERATION_TYPES.length, 4);
  assert.equal(PROPERTY_TYPES.length, 16);
  assert.ok(PROPERTY_TYPES.some((p) => p.id === "other"));
});

test("Medina districts are scoped to madinah city", () => {
  const list = districtsForCity("madinah");
  assert.ok(list.length >= 50);
  assert.ok(list.every((d) => d.cityId === "madinah"));
  assert.ok(list.every((d) => d.officialName && d.id));
  assert.equal(districtsForCity("riyadh").length, 0);
});

test("district search matches alias variants like حي العزيزية", () => {
  const matched = matchDistrict("حي العزيزية", "madinah");
  assert.ok(matched);
  assert.equal(matched.officialName, "العزيزية");
  const filtered = filterBySearch("عزيز", DISTRICTS, "officialName");
  assert.ok(filtered.some((d) => d.officialName === "العزيزية"));
});

test("buildReviewDefaults maps extracted fields when confident", () => {
  const defaults = buildReviewDefaults({
    purpose: "SALE",
    opportunityKind: "OFFER",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العزيزية"
  }, "عرض للبيع شقة في حي العزيزية المدينة المنورة");
  assert.equal(defaults.operationTypeId, "sale");
  assert.equal(defaults.propertyTypeId, "apartment");
  assert.equal(defaults.cityId, "madinah");
  assert.ok(defaults.districtId && defaults.districtId !== DISTRICT_OTHER_ID);
});

test("reference catalog maps review numeric fields", () => {
  const broker = reviewValuesToBrokerFields({
    operationTypeId: "sale",
    propertyTypeId: "apartment",
    cityId: "madinah",
    districtId: DISTRICTS[0].id,
    priceOrBudget: "1200000",
    area: "180",
    rooms: "4",
    extractedSnapshot: null
  });
  assert.equal(broker.priceOrBudget, 1200000);
  assert.equal(broker.area, 180);
  assert.equal(broker.rooms, 4);
});
