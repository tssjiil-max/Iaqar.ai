import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeNeighborhoodName,
  normalizeNeighborhoodNames,
  containsNeighborhoodMetadata
} from "../public/js/service-neighborhood-domain.js";
import {
  adjacentNeighborhoodIds,
  adjacencyDataForTests,
  resolveDistrictIdFromLabel
} from "../public/js/neighborhood-adjacency-domain.js";
import {
  rankSuitableOffices,
  classifyOfficeForOpportunity,
  requiresOpportunityLocationCompletion,
  isOfficeEligibleForCooperationListing,
  SUITABLE_OFFICE_TIER
} from "../public/js/suitable-offices-domain.js";
import { minimumSharedFields } from "../worker/src/cooperation-phase6-domain.js";
import { applyCooperationDecision } from "../worker/src/cooperation-phase6-domain.js";

const MADINAH = "المدينة المنورة";

function office(overrides = {}) {
  return {
    officeId: overrides.officeId || "office-b",
    officeName: overrides.officeName || "مكتب تجريبي",
    city: MADINAH,
    cooperationMode: "APPROVAL_REQUIRED",
    approvalStatus: "approved",
    accountStatus: "active",
    licenseNumber: "1234567890",
    primaryNeighborhoodId: overrides.primaryNeighborhoodId || "",
    serviceNeighborhoodIds: overrides.serviceNeighborhoodIds || [],
    receiveExternalOpportunities: overrides.receiveExternalOpportunities !== false,
    cooperationAvailableNow: overrides.cooperationAvailableNow !== false,
    ...overrides
  };
}

test("normalization unifies equivalent district label", () => {
  const a = normalizeNeighborhoodName("حي عروة", MADINAH);
  const b = normalizeNeighborhoodName("عروة", MADINAH);
  assert.equal(a, b);
  assert.equal(a, "عروة");
});

test("normalization removes duplicates in lists", () => {
  const out = normalizeNeighborhoodNames(["عروة", " عروة ", "الوبرة"], MADINAH);
  assert.deepEqual(out, ["عروة", "الوبرة"]);
});

test("normalization blocks metadata inside district name", () => {
  assert.equal(normalizeNeighborhoodName("عروة 500 ألف", MADINAH), "");
  assert.equal(containsNeighborhoodMetadata("مساحة 300"), true);
});

test("adjacency is bidirectional", () => {
  const urwah = resolveDistrictIdFromLabel("عروة", MADINAH);
  const wabra = resolveDistrictIdFromLabel("الوبرة", MADINAH);
  assert.ok(adjacentNeighborhoodIds(urwah).includes(wabra));
  assert.ok(adjacentNeighborhoodIds(wabra).includes(urwah));
});

test("adjacency does not include self", () => {
  const urwah = resolveDistrictIdFromLabel("عروة", MADINAH);
  assert.equal(adjacentNeighborhoodIds(urwah).includes(urwah), false);
});

test("adjacency lists have no duplicate ids", () => {
  const data = adjacencyDataForTests();
  for (const [id, neighbors] of Object.entries(data)) {
    assert.equal(new Set(neighbors).size, neighbors.length);
    assert.equal(neighbors.includes(id), false);
  }
});

test("district without adjacency data does not break ranking", () => {
  const unknownId = resolveDistrictIdFromLabel("أبيار علي", MADINAH);
  const ranked = rankSuitableOffices({
    opportunity: { city: MADINAH, district: "أبيار علي" },
    offices: [office({ officeId: "far", primaryNeighborhoodId: unknownId })],
    ownOfficeId: "office-a"
  });
  assert.equal(ranked.total, 1);
  assert.equal(ranked.buckets[SUITABLE_OFFICE_TIER.SAME].length, 1);
});

test("same-neighborhood primary office is tier 1", () => {
  const urwah = resolveDistrictIdFromLabel("عروة", MADINAH);
  const classified = classifyOfficeForOpportunity({
    office: office({ primaryNeighborhoodId: urwah }),
    opportunityCity: MADINAH,
    opportunityDistrictIds: [urwah]
  });
  assert.equal(classified.tier, SUITABLE_OFFICE_TIER.SAME);
});

test("office serving target district is tier 1", () => {
  const urwah = resolveDistrictIdFromLabel("عروة", MADINAH);
  const wabra = resolveDistrictIdFromLabel("الوبرة", MADINAH);
  const classified = classifyOfficeForOpportunity({
    office: office({ primaryNeighborhoodId: wabra, serviceNeighborhoodIds: [urwah] }),
    opportunityCity: MADINAH,
    opportunityDistrictIds: [urwah]
  });
  assert.equal(classified.tier, SUITABLE_OFFICE_TIER.SAME);
});

test("adjacent office is tier 2", () => {
  const urwah = resolveDistrictIdFromLabel("عروة", MADINAH);
  const wabra = resolveDistrictIdFromLabel("الوبرة", MADINAH);
  const classified = classifyOfficeForOpportunity({
    office: office({ primaryNeighborhoodId: wabra, serviceNeighborhoodIds: [wabra] }),
    opportunityCity: MADINAH,
    opportunityDistrictIds: [urwah]
  });
  assert.equal(classified.tier, SUITABLE_OFFICE_TIER.ADJACENT);
});

test("same-city distant office is tier 3", () => {
  const urwah = resolveDistrictIdFromLabel("عروة", MADINAH);
  const abiar = resolveDistrictIdFromLabel("أبيار علي", MADINAH);
  const classified = classifyOfficeForOpportunity({
    office: office({ primaryNeighborhoodId: abiar, serviceNeighborhoodIds: [abiar] }),
    opportunityCity: MADINAH,
    opportunityDistrictIds: [urwah]
  });
  assert.equal(classified.tier, SUITABLE_OFFICE_TIER.CITY);
});

test("office appears in only one tier bucket", () => {
  const urwah = resolveDistrictIdFromLabel("عروة", MADINAH);
  const ranked = rankSuitableOffices({
    opportunity: { city: MADINAH, district: "عروة" },
    offices: [
      office({ officeId: "same", primaryNeighborhoodId: urwah }),
      office({ officeId: "adj", primaryNeighborhoodId: resolveDistrictIdFromLabel("الوبرة", MADINAH) }),
      office({ officeId: "city", primaryNeighborhoodId: resolveDistrictIdFromLabel("أبيار علي", MADINAH) })
    ],
    ownOfficeId: "office-a"
  });
  const ids = [
    ...ranked.buckets[1],
    ...ranked.buckets[2],
    ...ranked.buckets[3]
  ].map((row) => row.officeId);
  assert.equal(new Set(ids).size, ids.length);
});

test("own office is excluded", () => {
  const ranked = rankSuitableOffices({
    opportunity: { city: MADINAH, district: "عروة" },
    offices: [office({ officeId: "office-a" })],
    ownOfficeId: "office-a"
  });
  assert.equal(ranked.total, 0);
});

test("inactive office is excluded", () => {
  const ranked = rankSuitableOffices({
    opportunity: { city: MADINAH, district: "عروة" },
    offices: [office({ accountStatus: "suspended" })],
    ownOfficeId: "office-a"
  });
  assert.equal(ranked.total, 0);
});

test("office that stopped cooperation is excluded", () => {
  const ranked = rankSuitableOffices({
    opportunity: { city: MADINAH, district: "عروة" },
    offices: [office({ cooperationAvailableNow: false })],
    ownOfficeId: "office-a"
  });
  assert.equal(ranked.total, 0);
});

test("office in another city is excluded from city tiers", () => {
  const ranked = rankSuitableOffices({
    opportunity: { city: MADINAH, district: "عروة" },
    offices: [office({ city: "الرياض" })],
    ownOfficeId: "office-a"
  });
  assert.equal(ranked.total, 0);
});

test("missing city or district requires completion", () => {
  assert.equal(requiresOpportunityLocationCompletion({ city: MADINAH }), true);
  assert.equal(requiresOpportunityLocationCompletion({ district: "عروة" }), true);
  assert.equal(requiresOpportunityLocationCompletion({ city: MADINAH, district: "عروة" }), false);
});

test("minimum shared fields omit contact data", () => {
  const min = minimumSharedFields({
    opportunityKind: "OFFER",
    propertyType: "شقة",
    city: MADINAH,
    district: "عروة",
    contactPhone: "0512345678",
    contactName: "أحمد",
    phone: "0512345678"
  });
  assert.equal(min.contactPhone, "");
  assert.equal(min.contactName, "");
  assert.equal(min.phone, "");
});

test("cooperation decision supports request details", () => {
  const applied = applyCooperationDecision({ status: "PENDING" }, "REQUEST_DETAILS");
  assert.equal(applied.ok, true);
  assert.equal(applied.patch.status, "DETAILS_REQUESTED");
});

test("office eligibility requires toggles", () => {
  assert.equal(isOfficeEligibleForCooperationListing(office()), true);
  assert.equal(isOfficeEligibleForCooperationListing(office({ receiveExternalOpportunities: false })), false);
  assert.equal(isOfficeEligibleForCooperationListing(office({ cooperationMode: "DISABLED" })), false);
});

test("UI tier labels are Arabic", () => {
  const ranked = rankSuitableOffices({
    opportunity: { city: MADINAH, district: "عروة" },
    offices: [office()],
    ownOfficeId: "office-a"
  });
  const row = ranked.buckets[1][0] || ranked.buckets[2][0] || ranked.buckets[3][0];
  assert.ok(row.reason && !/[A-Za-z]/.test(row.reason));
});
