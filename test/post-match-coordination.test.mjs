import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DETAIL_KEY,
  detailKeysForPropertyType,
  detailValuesToCanonicalPatch,
  filterRequestedDetailKeys,
  PROPERTY_DETAIL_SCHEMA,
  isLandForbiddenDetailKey,
  ownerMissingDetailKeys
} from "../public/js/property-detail-schema-domain.js";
import {
  stableCoarseGeoPoint,
  buildPartyLocationView,
  readExactGeo
} from "../public/js/approximate-location-domain.js";
import {
  brokerScheduleHasConflict,
  evaluateViewingCandidate,
  VIEWING_APPOINTMENT_STATUS,
  TRAVEL_FALLBACK_FLAG
} from "../public/js/broker-viewing-schedule-domain.js";
import {
  CLIENT_INTEREST_STATUS,
  CLIENT_INTEREST_ACTION,
  CLIENT_NEGOTIATION_RESPONSE,
  COORDINATION_OUTCOME,
  NEGOTIATION_DECISION,
  PRICE_FLEXIBILITY,
  REJECTION_DISPOSITION,
  REJECTION_REASON,
  rejectionReasonOptions,
  normalizeClientBundle,
  normalizeOwnerBundle,
  resolveCoordinationOutcome,
  resolveOwnerContactNeeded,
  OWNER_AVAILABILITY,
  OWNER_VIEWING_ALLOWED,
  VIEWING_DAY,
  VIEWING_PERIOD
} from "../public/js/coordination-bundle-domain.js";
import { sanitizePartyPublicView } from "../public/js/party-session-domain.js";
import { buildPartyShellHtml } from "../public/js/party-shell-ui.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const partyShell = readFileSync(join(root, "public", "js", "party-shell-ui.js"), "utf8");
const partyEntry = readFileSync(join(root, "public", "js", "party-entry.js"), "utf8");

const now = new Date("2026-08-27T12:00:00.000Z");

test("party submit retries a timed-out owner reply and verifies persisted state", () => {
  assert.match(partyEntry, /AbortController/);
  assert.match(partyEntry, /\[15000, 25000\]/);
  assert.match(partyEntry, /fresh\?\.replied \|\| fresh\?\.decisionPackage\?\.submitted/);
  assert.match(partyEntry, /Number\(error\.status\) >= 500/);
  assert.doesNotMatch(partyShell, /الصور التي ترفعها ستُشارك مع العميل/);
});

test("interested client requires detail keys and does not start viewing", () => {
  const bundle = normalizeClientBundle({
    propertyType: "شقة",
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
    requestedDetailKeys: [DETAIL_KEY.AREA, DETAIL_KEY.BEDROOMS]
  });
  assert.equal(bundle.interestStatus, CLIENT_INTEREST_STATUS.INTERESTED);
  assert.equal(bundle.wantsViewing, false);
  assert.equal(bundle.viewingDays.length, 0);
  assert.equal(normalizeClientBundle({
    propertyType: "شقة",
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED
  }), null);
});

test("interested client can choose viewing without preliminary approval", () => {
  const bundle = normalizeClientBundle({
    propertyType: "شقة",
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
    interestAction: CLIENT_INTEREST_ACTION.VIEWING,
    viewingDays: [VIEWING_DAY.TOMORROW],
    viewingPeriods: [VIEWING_PERIOD.EVENING]
  });
  assert.equal(bundle.wantsViewing, true);
  assert.ok(bundle.viewingWindows.includes("tomorrow_evening"));
});

test("final rejection records a structured reason without viewing", () => {
  const bundle = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.NOT_SUITABLE,
    rejectionReason: REJECTION_REASON.SPECIFICATIONS,
    rejectionDisposition: REJECTION_DISPOSITION.FINAL
  });
  assert.equal(bundle.wantsViewing, false);
});

test("negotiable price rejection uses a structured flexibility request without a typed price", () => {
  assert.equal(normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.NOT_SUITABLE,
    rejectionReason: REJECTION_REASON.PRICE,
    rejectionDisposition: REJECTION_DISPOSITION.NEGOTIABLE
  }), null);
  const bundle = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.NOT_SUITABLE,
    rejectionReason: REJECTION_REASON.PRICE,
    rejectionDisposition: REJECTION_DISPOSITION.NEGOTIABLE,
    negotiationPreference: PRICE_FLEXIBILITY.ASK_OWNER
  });
  assert.equal(bundle.proposedPrice, null);
  assert.equal(bundle.negotiationPreference, PRICE_FLEXIBILITY.ASK_OWNER);
});

test("negotiation session routes owner accept counter and reject", () => {
  const clientBundle = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.NOT_SUITABLE,
    rejectionReason: REJECTION_REASON.PRICE,
    rejectionDisposition: REJECTION_DISPOSITION.NEGOTIABLE,
    negotiationPreference: PRICE_FLEXIBILITY.ASK_OWNER
  });
  for (const [decision, expected] of [
    [NEGOTIATION_DECISION.ACCEPT, COORDINATION_OUTCOME.NEGOTIATION_ACCEPTED],
    [NEGOTIATION_DECISION.COUNTER, COORDINATION_OUTCOME.NEGOTIATION_COUNTERED],
    [NEGOTIATION_DECISION.REJECT, COORDINATION_OUTCOME.NEGOTIATION_REJECTED]
  ]) {
    const ownerBundle = normalizeOwnerBundle({
      propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
      negotiationDecision: decision,
      counterPreference: decision === NEGOTIATION_DECISION.COUNTER ? PRICE_FLEXIBILITY.DISCOUNT_2 : "",
      viewingAllowed: OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION,
      coordinationRequired: true
    });
    assert.equal(resolveCoordinationOutcome({ clientBundle, ownerBundle }).outcome, expected);
  }
});

test("client confirms the owner negotiation before broker intervention", () => {
  const clientBase = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.NOT_SUITABLE,
    rejectionReason: REJECTION_REASON.PRICE,
    rejectionDisposition: REJECTION_DISPOSITION.NEGOTIABLE,
    negotiationPreference: PRICE_FLEXIBILITY.ASK_OWNER
  });
  const ownerBundle = normalizeOwnerBundle({
    propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
    negotiationDecision: NEGOTIATION_DECISION.COUNTER,
    counterPreference: PRICE_FLEXIBILITY.DISCOUNT_5,
    viewingAllowed: OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION,
    coordinationRequired: true
  });
  assert.equal(resolveCoordinationOutcome({ clientBundle: clientBase, ownerBundle }).outcome, COORDINATION_OUTCOME.NEGOTIATION_COUNTERED);
  const clientAccepted = normalizeClientBundle({
    ...clientBase,
    negotiationResponse: CLIENT_NEGOTIATION_RESPONSE.ACCEPT
  });
  assert.equal(resolveCoordinationOutcome({ clientBundle: clientAccepted, ownerBundle }).outcome, COORDINATION_OUTCOME.NEEDS_BROKER);
});

test("apartment schema returns only apartment keys", () => {
  const keys = detailKeysForPropertyType("شقة");
  assert.ok(keys.includes(DETAIL_KEY.BEDROOMS));
  assert.ok(keys.includes(DETAIL_KEY.ELEVATOR));
  assert.ok(!keys.includes(DETAIL_KEY.UNITS));
});

test("villa schema returns villa keys without apartment floor", () => {
  const keys = detailKeysForPropertyType("فيلا");
  assert.ok(keys.includes(DETAIL_KEY.LAND_AREA));
  assert.ok(keys.includes(DETAIL_KEY.YARD));
  assert.ok(!keys.includes(DETAIL_KEY.FLOOR));
});

test("land schema never includes rooms or bathrooms", () => {
  const keys = detailKeysForPropertyType("أرض");
  assert.ok(!keys.includes(DETAIL_KEY.BEDROOMS));
  assert.ok(!keys.includes(DETAIL_KEY.BATHROOMS));
  assert.ok(!keys.includes(DETAIL_KEY.FLOOR));
  assert.ok(isLandForbiddenDetailKey(DETAIL_KEY.BEDROOMS));
});

test("rejection reasons and icons follow the property type", () => {
  const apartment = rejectionReasonOptions("شقة");
  const land = rejectionReasonOptions("أرض");
  assert.ok(apartment.some((item) => item.value === REJECTION_REASON.BEDROOMS && item.icon));
  assert.ok(apartment.some((item) => item.value === REJECTION_REASON.ELEVATOR && item.icon));
  assert.equal(land.some((item) => item.value === REJECTION_REASON.BEDROOMS), false);
  assert.equal(land.some((item) => item.value === REJECTION_REASON.BATHROOMS), false);
  assert.ok(land.some((item) => item.value === REJECTION_REASON.FRONTAGE && item.icon));
  assert.ok(land.some((item) => item.value === REJECTION_REASON.STREET_COUNT && item.icon));
});

test("building schema returns building keys", () => {
  const keys = detailKeysForPropertyType("عمارة");
  assert.ok(keys.includes(DETAIL_KEY.UNITS));
  assert.ok(keys.includes(DETAIL_KEY.ANNUAL_INCOME));
});

test("central schema covers every catalog type and warehouse has no rooms", () => {
  assert.equal(Object.keys(PROPERTY_DETAIL_SCHEMA).length, 16);
  const warehouseKeys = detailKeysForPropertyType("مستودع");
  assert.ok(warehouseKeys.includes(DETAIL_KEY.AREA));
  assert.ok(!warehouseKeys.includes(DETAIL_KEY.BEDROOMS));
  assert.ok(warehouseKeys.includes(DETAIL_KEY.CEILING_HEIGHT));
  assert.ok(warehouseKeys.includes(DETAIL_KEY.TRUCK_ACCESS));
});

test("requested detail keys are filtered by the central property schema", () => {
  assert.deepEqual(
    filterRequestedDetailKeys("مستودع", [DETAIL_KEY.AREA, DETAIL_KEY.BEDROOMS, DETAIL_KEY.CEILING_HEIGHT]),
    [DETAIL_KEY.AREA, DETAIL_KEY.CEILING_HEIGHT]
  );
  assert.deepEqual(
    filterRequestedDetailKeys("شقة", [DETAIL_KEY.BEDROOMS, DETAIL_KEY.TRUCK_ACCESS]),
    [DETAIL_KEY.BEDROOMS]
  );
});

test("6+ rooms uses a canonical persisted numeric value", () => {
  assert.deepEqual(detailValuesToCanonicalPatch({ rooms: "6+" }), { rooms: 6 });
});

test("owner missing detail keys follow client requestedDetailKeys", () => {
  const clientBundle = normalizeClientBundle({
    propertyType: "شقة",
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
    requestedDetailKeys: [DETAIL_KEY.AREA, DETAIL_KEY.BEDROOMS]
  });
  const missing = ownerMissingDetailKeys(clientBundle, { area: 120 }, "شقة");
  assert.deepEqual(missing, [DETAIL_KEY.BEDROOMS]);
});

test("party shell has no free-text chat composer", () => {
  assert.equal(partyShell.includes("textarea"), false);
  assert.equal(partyShell.includes("message composer"), false);
  assert.equal(partyEntry.includes("textarea"), false);
});

test("approximate location is stable between calls", () => {
  const geo = readExactGeo({ lat: 24.467891, lng: 39.612345 });
  const a = stableCoarseGeoPoint(geo.lat, geo.lng);
  const b = stableCoarseGeoPoint(geo.lat, geo.lng);
  assert.deepEqual(a, b);
  const view = buildPartyLocationView({ lat: geo.lat, lng: geo.lng, city: "المدينة المنورة", district: "العوالي" });
  assert.equal(view.mode, "approximate");
  assert.ok(view.map?.lat);
  assert.ok(view.map?.radiusMeters);
});

test("exact location only after broker confirmation flag", () => {
  const geo = readExactGeo({ lat: 24.467891, lng: 39.612345 });
  const before = buildPartyLocationView({ lat: geo.lat, lng: geo.lng, locationUrl: "https://maps.google.com/test" });
  assert.equal(before.mode, "approximate");
  const after = buildPartyLocationView(
    { lat: geo.lat, lng: geo.lng, locationUrl: "https://maps.google.com/test" },
    { exactAllowed: true }
  );
  assert.equal(after.mode, "exact");
  assert.ok(after.map?.locationUrl);
});

test("broker schedule rejects overlapping appointments", () => {
  const start = "2026-08-27T15:00:00.000Z";
  assert.equal(brokerScheduleHasConflict(start, [start]), true);
  assert.equal(brokerScheduleHasConflict(start, ["2026-08-28T15:00:00.000Z"]), false);
});

test("travel-sensitive scheduling requires broker confirmation without fake travel time", () => {
  const candidate = "2026-08-27T17:45:00.000Z";
  const evaluation = evaluateViewingCandidate({
    candidateStart: candidate,
    bookedStarts: [],
    previousAppointment: { endAt: "2026-08-27T17:00:00.000Z", appointmentAt: "2026-08-27T17:00:00.000Z" },
    previousRecord: { lat: 24.40, lng: 39.50 },
    candidateRecord: { lat: 24.55, lng: 39.70 }
  });
  assert.equal(evaluation.status, VIEWING_APPOINTMENT_STATUS.BROKER_CONFIRM_REQUIRED_FOR_TRAVEL);
  assert.equal(evaluation.travelEstimate, null);
  assert.equal(evaluation.reason, TRAVEL_FALLBACK_FLAG);
});

test("client interest sets ownerContactNeeded when awaiting owner", () => {
  const clientBundle = normalizeClientBundle({
    propertyType: "شقة",
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
    requestedDetailKeys: [DETAIL_KEY.AREA]
  });
  const needed = resolveOwnerContactNeeded({
    clientBundle,
    ownerBundle: null,
    outcome: COORDINATION_OUTCOME.AWAITING_OTHER_PARTY
  });
  assert.equal(needed, true);
});

test("owner response clears ownerContactNeeded flag", () => {
  const clientBundle = normalizeClientBundle({
    propertyType: "شقة",
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
    requestedDetailKeys: [DETAIL_KEY.AREA]
  });
  const ownerBundle = normalizeOwnerBundle({
    propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
    viewingAllowed: OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION,
    detailValues: { area: 150 }
  });
  const outcome = resolveCoordinationOutcome({
    clientBundle,
    ownerBundle,
    canonicalOffer: { area: 150, propertyType: "شقة" }
  });
  const needed = resolveOwnerContactNeeded({
    clientBundle,
    ownerBundle,
    outcome: outcome.outcome
  });
  assert.equal(needed, false);
});

test("viewing ready when client preliminary and owner windows overlap", () => {
  const client = normalizeClientBundle({
    propertyType: "شقة",
    interestStatus: CLIENT_INTEREST_STATUS.PRELIMINARY_OK,
    wantsViewing: true,
    viewingDays: [VIEWING_DAY.TOMORROW],
    viewingPeriods: [VIEWING_PERIOD.EVENING]
  });
  const owner = normalizeOwnerBundle({
    propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
    viewingAllowed: OWNER_VIEWING_ALLOWED.YES,
    viewingDays: [VIEWING_DAY.TOMORROW],
    viewingPeriods: [VIEWING_PERIOD.EVENING]
  });
  const outcome = resolveCoordinationOutcome({ clientBundle: client, ownerBundle: owner, now });
  assert.equal(outcome.outcome, COORDINATION_OUTCOME.VIEWING_READY);
});

test("sanitize party view strips contact fields", () => {
  const view = sanitizePartyPublicView({
    party: "client",
    snapshot: {
      propertyType: "شقة",
      city: "المدينة المنورة",
      district: "العوالي",
      phone: "0500000000",
      ownerName: "test"
    },
    canonicalOffer: { propertyType: "شقة", lat: 24.5, lng: 39.6 }
  });
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("0500000000"), false);
  assert.equal(serialized.includes("ownerName"), false);
  assert.ok(view.property.locationView);
});

test("party UI uses the five structured phase-one decisions without preliminary approval", () => {
  const html = buildPartyShellHtml(sanitizePartyPublicView({
    party: "client",
    snapshot: { propertyType: "شقة", city: "المدينة المنورة" },
    coordination: { matchId: "m1", createdAt: now.toISOString() }
  }));
  assert.doesNotMatch(html, /موافق مبدئيًا/);
  assert.match(html, /مهتم/);
  assert.match(html, /غير مناسب/);
  assert.match(html, /أحتاج معلومات/);
  assert.match(html, /السعر غير مناسب/);
  assert.match(html, /السعر مرتفع/);
  assert.match(html, /شروط الدفع غير مناسبة/);
  assert.match(html, /قد أهتم إذا تغير الشرط/);
  assert.match(html, /ما المعلومات التي تحتاجها/);
  assert.match(html, /أرغب في المعاينة/);
});

test("owner negotiation UI is named إدارة المفاوضات and has structured decisions", () => {
  const clientBundle = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.NOT_SUITABLE,
    rejectionReason: REJECTION_REASON.PRICE,
    rejectionDisposition: REJECTION_DISPOSITION.NEGOTIABLE,
    negotiationPreference: PRICE_FLEXIBILITY.ASK_OWNER
  });
  const html = buildPartyShellHtml(sanitizePartyPublicView({
    party: "owner",
    snapshot: { propertyType: "شقة", city: "المدينة المنورة" },
    coordination: {
      matchId: "m-negotiation",
      createdAt: now.toISOString(),
      clientBundle,
      ownerBundle: normalizeOwnerBundle({ propertyAvailability: OWNER_AVAILABILITY.AVAILABLE })
    },
    canonicalOffer: { propertyType: "شقة", price: 700000 }
  }));
  assert.match(html, /إدارة المفاوضات/);
  assert.match(html, /أوافق/);
  assert.match(html, /أتمسك بالسعر/);
  assert.match(html, /نناقشه عند المعاينة/);
  assert.doesNotMatch(html, /السعر البديل|السعر المناسب لك/);
  assert.doesNotMatch(html, /textarea/);
  assert.doesNotMatch(html, /data-package-number="(?:proposedPrice|counterPrice|updatedPrice)"/);
});
