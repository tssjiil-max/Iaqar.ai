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
  filterDistrictOptions,
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
    salePrice: "1200000",
    annualRent: "22000",
    area: "180",
    rooms: "4",
    extractedSnapshot: null
  });
  assert.equal(broker.salePrice, 1200000);
  assert.equal(broker.annualRent, null);
  assert.equal(broker.priceOrBudget, 1200000);
  assert.equal(broker.area, 180);
  assert.equal(broker.rooms, 4);
});

test("review defaults and broker fields keep sale and rent values separate", () => {
  const saleDefaults = buildReviewDefaults({
    purpose: "SALE",
    opportunityKind: "OFFER",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "الرانوناء",
    priceOrBudget: 580000
  }, "أرض للبيع", {
    extended: { transactionType: "بيع", salePrice: 580000, annualRent: null }
  });
  assert.equal(saleDefaults.salePrice, 580000);
  assert.equal(saleDefaults.annualRent, "");

  const rent = reviewValuesToBrokerFields({
    operationTypeId: "rent",
    propertyTypeId: "apartment",
    cityId: "madinah",
    districtId: DISTRICTS.find((item) => item.officialName === "السلام").id,
    salePrice: "1600000",
    annualRent: "22000",
    monthlyRent: "",
    optionalMonthlyRentAfterSixMonths: "1850",
    paymentInstallments: "2",
    area: "140",
    rooms: "4",
    bathrooms: "3",
    floorNumber: "1",
    extractedSnapshot: { opportunityKind: "OFFER" }
  });
  assert.equal(rent.salePrice, null);
  assert.equal(rent.annualRent, 22000);
  assert.equal(rent.optionalMonthlyRentAfterSixMonths, 1850);
  assert.equal(rent.paymentInstallments, 2);
  assert.equal(rent.priceOrBudget, 22000);
});

test("land review never carries room, bathroom, or floor values", () => {
  const land = reviewValuesToBrokerFields({
    operationTypeId: "sale",
    propertyTypeId: "land",
    cityId: "madinah",
    districtId: DISTRICTS.find((item) => item.officialName === "الرانوناء").id,
    salePrice: "580000",
    area: "431.75",
    rooms: "4",
    bathrooms: "3",
    floorNumber: "1",
    extractedSnapshot: { opportunityKind: "OFFER" }
  });
  assert.equal(land.rooms, null);
  assert.equal(land.bathrooms, null);
  assert.equal(land.floorNumber, null);
});

test("unknown operation does not assign a generic amount to sale, rent, or budget", () => {
  const defaults = buildReviewDefaults({
    opportunityKind: "OFFER",
    propertyType: "شقة",
    city: "",
    district: "",
    priceOrBudget: 900000
  }, "شقة متاحة");
  assert.equal(defaults.operationTypeId, "");
  assert.equal(defaults.salePrice, "");
  assert.equal(defaults.annualRent, "");
  assert.equal(defaults.budget, "");

  const broker = reviewValuesToBrokerFields({
    operationTypeId: "",
    propertyTypeId: "apartment",
    cityId: "madinah",
    districtId: DISTRICTS[0].id,
    salePrice: "900000",
    annualRent: "900000",
    budget: "900000"
  });
  assert.equal(broker.salePrice, null);
  assert.equal(broker.annualRent, null);
  assert.equal(broker.budget, null);
  assert.equal(broker.priceOrBudget, null);
});

test("unmatched extracted district opens as حي آخر with short manual name", () => {
  const defaults = buildReviewDefaults({
    purpose: "SALE",
    opportunityKind: "OFFER",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "العوالي"
  }, "أرض للبيع حي العوالي");
  assert.equal(defaults.districtId, DISTRICT_OTHER_ID);
  assert.equal(defaults.districtManual, "العوالي");
});

test("filterDistrictOptions always keeps حي آخر even under the item cap", () => {
  const items = [
    ...DISTRICTS.slice(0, 60).map((d) => ({ ...d })),
    {
      id: DISTRICT_OTHER_ID,
      officialName: "حي آخر / غير موجود في القائمة"
    }
  ];
  const emptyQuery = filterDistrictOptions("", items, 40);
  assert.ok(emptyQuery.some((d) => d.id === DISTRICT_OTHER_ID));
  assert.ok(emptyQuery.length <= 40);

  const unknown = filterDistrictOptions("العوالي", items, 40);
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].id, DISTRICT_OTHER_ID);
});
