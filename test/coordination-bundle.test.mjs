import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_INTEREST_STATUS,
  CLIENT_INFO_NEEDS,
  COORDINATION_OUTCOME,
  OWNER_AVAILABILITY,
  OWNER_VIEWING_ALLOWED,
  PRICE_CONFIRMATION,
  VIEWING_DAY,
  VIEWING_PERIOD,
  SPEC_GROUP,
  normalizeClientBundle,
  normalizeOwnerBundle,
  resolveCoordinationOutcome,
  livingStageForCoordinationOutcome,
  ownerContactNeededForCoordination,
  buildDecisionPackageView,
  bundleFromLegacyReply,
  specGroupsForPropertyType,
  ownerMissingSpecGroups,
  viewingWindowsFromDaysPeriods,
  bundlesEqual
} from "../public/js/coordination-bundle-domain.js";
import { parseCoordinationSession, brokerCoordinationSummary } from "../public/js/coordination-session-domain.js";
import { sanitizePartyPublicView } from "../public/js/party-session-domain.js";
import { buildPartyShellHtml } from "../public/js/party-shell-ui.js";

const now = new Date("2026-08-27T12:00:00.000Z");

test("apartment client can select photos location and specification sub-options", () => {
  const groups = specGroupsForPropertyType("شقة");
  assert.ok(groups.includes(SPEC_GROUP.AREA));
  assert.ok(groups.includes(SPEC_GROUP.ROOMS_BATHROOMS));
  const bundle = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.PRELIMINARY_OK,
    infoNeeds: [CLIENT_INFO_NEEDS.PHOTOS, CLIENT_INFO_NEEDS.LOCATION, CLIENT_INFO_NEEDS.SPECIFICATIONS],
    specNeeds: [SPEC_GROUP.AREA, SPEC_GROUP.ROOMS_BATHROOMS]
  });
  assert.equal(bundle.interestStatus, CLIENT_INTEREST_STATUS.PRELIMINARY_OK);
  assert.deepEqual(bundle.specNeeds, [SPEC_GROUP.AREA, SPEC_GROUP.ROOMS_BATHROOMS]);
});

test("land receives land-specific specification options", () => {
  const landGroups = specGroupsForPropertyType("أرض");
  const apartmentGroups = specGroupsForPropertyType("شقة");
  assert.ok(landGroups.includes(SPEC_GROUP.FACADE));
  assert.ok(!apartmentGroups.includes(SPEC_GROUP.LENGTHS));
});

test("client bundle normalizes viewing path with days and periods", () => {
  const bundle = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
    wantsViewing: true,
    viewingDays: [VIEWING_DAY.TOMORROW],
    viewingPeriods: [VIEWING_PERIOD.EVENING]
  });
  assert.equal(bundle.interestStatus, CLIENT_INTEREST_STATUS.INTERESTED);
  assert.deepEqual(bundle.viewingDays, [VIEWING_DAY.TOMORROW]);
  assert.ok(bundle.viewingWindows.includes("tomorrow_evening"));
});

test("client can select multiple infoNeeds and viewing windows", () => {
  const bundle = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
    infoNeeds: [CLIENT_INFO_NEEDS.PHOTOS, CLIENT_INFO_NEEDS.LOCATION],
    wantsViewing: true,
    viewingDays: [VIEWING_DAY.TOMORROW, VIEWING_DAY.WEEKEND],
    viewingPeriods: [VIEWING_PERIOD.EVENING, VIEWING_PERIOD.MORNING]
  });
  assert.equal(bundle.infoNeeds.length, 2);
  assert.ok(bundle.viewingWindows.length >= 2);
});

test("client not suitable hides viewing requirements in normalized bundle", () => {
  const bundle = normalizeClientBundle({ interestStatus: CLIENT_INTEREST_STATUS.NOT_SUITABLE });
  assert.equal(bundle.wantsViewing, false);
  assert.equal(bundle.viewingDays.length, 0);
});

test("owner unavailable cannot produce viewing-ready outcome", () => {
  const client = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
    wantsViewing: true,
    viewingDays: [VIEWING_DAY.TOMORROW],
    viewingPeriods: [VIEWING_PERIOD.EVENING]
  });
  const owner = normalizeOwnerBundle({ propertyAvailability: OWNER_AVAILABILITY.NOT_AVAILABLE });
  const outcome = resolveCoordinationOutcome({ clientBundle: client, ownerBundle: owner, now });
  assert.equal(outcome.outcome, COORDINATION_OUTCOME.PROPERTY_NOT_AVAILABLE);
});

test("awaiting other party with client bundle only needs owner contact", () => {
  const client = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.PRELIMINARY_OK,
    wantsViewing: true,
    viewingDays: [VIEWING_DAY.TOMORROW],
    viewingPeriods: [VIEWING_PERIOD.EVENING]
  });
  const outcome = resolveCoordinationOutcome({ clientBundle: client, ownerBundle: null, now });
  assert.equal(outcome.outcome, COORDINATION_OUTCOME.AWAITING_OTHER_PARTY);
  const living = livingStageForCoordinationOutcome(outcome.outcome, { clientBundle: client, ownerBundle: null });
  assert.equal(living.ownerContactNeeded, true);
  assert.equal(
    ownerContactNeededForCoordination({
      outcome: outcome.outcome,
      clientBundle: client,
      ownerBundle: null
    }),
    true
  );
  assert.equal(
    ownerContactNeededForCoordination({
      outcome: outcome.outcome,
      clientSummary: "موافق مبدئيًا",
      ownerSummary: ""
    }),
    true
  );
});

test("awaiting other party with owner bundle only does not need owner contact", () => {
  const owner = normalizeOwnerBundle({
    propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
    viewingAllowed: OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION
  });
  const outcome = resolveCoordinationOutcome({ clientBundle: null, ownerBundle: owner, now });
  assert.equal(outcome.outcome, COORDINATION_OUTCOME.AWAITING_OTHER_PARTY);
  assert.equal(
    ownerContactNeededForCoordination({
      outcome: outcome.outcome,
      ownerBundle: owner,
      ownerSummary: "متاح"
    }),
    false
  );
});

test("awaiting both parties does not force owner contact", () => {
  const living = livingStageForCoordinationOutcome(COORDINATION_OUTCOME.AWAITING_BOTH_PARTIES);
  assert.equal(living.ownerContactNeeded, false);
});

test("resolver finds viewing ready when windows overlap", () => {
  const client = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
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
  const living = livingStageForCoordinationOutcome(outcome.outcome);
  assert.equal(living.stage, "APPOINTMENT_COORDINATION");
});

test("resolver reports schedule conflict only", () => {
  const client = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
    wantsViewing: true,
    viewingDays: [VIEWING_DAY.TODAY],
    viewingPeriods: [VIEWING_PERIOD.EVENING]
  });
  const owner = normalizeOwnerBundle({
    propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
    viewingAllowed: OWNER_VIEWING_ALLOWED.YES,
    viewingDays: [VIEWING_DAY.TOMORROW],
    viewingPeriods: [VIEWING_PERIOD.MORNING]
  });
  const outcome = resolveCoordinationOutcome({ clientBundle: client, ownerBundle: owner, now });
  assert.equal(outcome.outcome, COORDINATION_OUTCOME.SCHEDULE_CONFLICT);
});

test("owner price confirmation and update normalize", () => {
  const confirmed = normalizeOwnerBundle({
    propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
    priceConfirmation: PRICE_CONFIRMATION.CONFIRMED,
    viewingAllowed: OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION
  });
  assert.equal(confirmed.priceConfirmation, PRICE_CONFIRMATION.CONFIRMED);
  const updated = normalizeOwnerBundle({
    propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
    priceConfirmation: PRICE_CONFIRMATION.UPDATED,
    updatedPrice: 450000,
    viewingAllowed: OWNER_VIEWING_ALLOWED.NEEDS_COORDINATION
  });
  assert.equal(updated.updatedPrice, 450000);
});

test("owner missing requested specification surfaces only missing groups", () => {
  const clientBundle = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
    infoNeeds: [CLIENT_INFO_NEEDS.SPECIFICATIONS],
    specNeeds: [SPEC_GROUP.AREA, SPEC_GROUP.ROOMS_BATHROOMS]
  });
  const missing = ownerMissingSpecGroups(clientBundle, { area: 120 }, "شقة");
  assert.deepEqual(missing, [SPEC_GROUP.ROOMS_BATHROOMS]);
});

test("decision package replaces legacy buttons when session exists", () => {
  const session = {
    matchId: "match_1",
    officeId: "office_1",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  const view = sanitizePartyPublicView({
    party: "owner",
    snapshot: { typePurpose: "شقة للإيجار", priceLabel: "20,000 ر.س", propertyType: "شقة" },
    coordination: session
  });
  assert.equal(view.actions.length, 0);
  assert.equal(view.decisionPackage.mode, "decision_package_v1");
  const html = buildPartyShellHtml(view);
  assert.match(html, /data-party-decision-package/);
  assert.match(html, /تأكيد وإرسال/);
});

test("submitted bundle shows success copy without legacy actions", () => {
  const ownerBundle = normalizeOwnerBundle({
    propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
    viewingAllowed: OWNER_VIEWING_ALLOWED.YES,
    viewingDays: [VIEWING_DAY.TOMORROW],
    viewingPeriods: [VIEWING_PERIOD.EVENING]
  });
  const session = parseCoordinationSession({
    matchId: "match_1",
    ownerBundle,
    createdAt: now.toISOString()
  });
  const view = sanitizePartyPublicView({
    party: "owner",
    officeName: "مكتب الاختبار",
    snapshot: { typePurpose: "شقة للإيجار", priceLabel: "20,000 ر.س" },
    coordination: session
  });
  assert.equal(view.replied, true);
  assert.match(view.submitSuccessCopy, /مكتب الاختبار/);
  const html = buildPartyShellHtml(view);
  assert.match(html, /تم إرسال ردك/);
});

test("legacy reply maps into bundle semantics", () => {
  const bundle = bundleFromLegacyReply("owner", "property_available", "");
  assert.equal(bundle.propertyAvailability, OWNER_AVAILABILITY.AVAILABLE);
  const summary = brokerCoordinationSummary({
    matchId: "m1",
    ownerBundle: bundle,
    createdAt: now.toISOString()
  });
  assert.match(summary, /متاح/);
});

test("decision package exposes semantic interest options", () => {
  const form = buildDecisionPackageView("client", { propertyType: "شقة", now });
  assert.equal(form.mode, "decision_package_v1");
  assert.ok(form.specOptions.length >= 2);
});

test("bundle equality ignores submittedAt for idempotency checks", () => {
  const left = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
    wantsViewing: true,
    viewingDays: [VIEWING_DAY.TOMORROW],
    viewingPeriods: [VIEWING_PERIOD.EVENING],
    submittedAt: "2026-01-01T00:00:00.000Z"
  });
  const right = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
    wantsViewing: true,
    viewingDays: [VIEWING_DAY.TOMORROW],
    viewingPeriods: [VIEWING_PERIOD.EVENING],
    submittedAt: "2026-02-01T00:00:00.000Z"
  });
  assert.equal(bundlesEqual(left, right), true);
});

test("viewing windows from days and periods map predictably", () => {
  const windows = viewingWindowsFromDaysPeriods(["tomorrow"], ["evening"]);
  assert.deepEqual(windows, ["tomorrow_evening"]);
});
