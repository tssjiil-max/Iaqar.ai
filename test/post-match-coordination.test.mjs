import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DETAIL_KEY,
  detailKeysForPropertyType,
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
  COORDINATION_OUTCOME,
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

test("preliminary approval enables viewing preference flow", () => {
  const bundle = normalizeClientBundle({
    propertyType: "شقة",
    interestStatus: CLIENT_INTEREST_STATUS.PRELIMINARY_OK,
    wantsViewing: true,
    viewingDays: [VIEWING_DAY.TOMORROW],
    viewingPeriods: [VIEWING_PERIOD.EVENING]
  });
  assert.equal(bundle.wantsViewing, true);
  assert.ok(bundle.viewingWindows.includes("tomorrow_evening"));
});

test("not suitable does not require viewing fields", () => {
  const bundle = normalizeClientBundle({ interestStatus: CLIENT_INTEREST_STATUS.NOT_SUITABLE });
  assert.equal(bundle.wantsViewing, false);
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

test("building schema returns building keys", () => {
  const keys = detailKeysForPropertyType("عمارة");
  assert.ok(keys.includes(DETAIL_KEY.UNITS));
  assert.ok(keys.includes(DETAIL_KEY.ANNUAL_INCOME));
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

test("party UI shows unified interest labels", () => {
  const html = buildPartyShellHtml(sanitizePartyPublicView({
    party: "client",
    snapshot: { propertyType: "شقة", city: "المدينة المنورة" },
    coordination: { matchId: "m1", createdAt: now.toISOString() }
  }));
  assert.match(html, /موافق مبدئيًا/);
  assert.match(html, /ما المعلومات التي تحتاجها/);
  assert.match(html, /أرغب في المعاينة/);
});
