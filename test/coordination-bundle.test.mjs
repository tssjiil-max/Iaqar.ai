import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_INTEREST,
  CLIENT_NEXT_ACTION,
  COORDINATION_OUTCOME,
  OWNER_AVAILABILITY,
  OWNER_VIEWING_ALLOWED,
  normalizeClientBundle,
  normalizeOwnerBundle,
  resolveCoordinationOutcome,
  livingStageForCoordinationOutcome,
  buildCoordinationFormView,
  bundleFromLegacyReply
} from "../public/js/coordination-bundle-domain.js";
import { parseCoordinationSession, brokerCoordinationSummary } from "../public/js/coordination-session-domain.js";
import { sanitizePartyPublicView } from "../public/js/party-session-domain.js";
import { buildPartyShellHtml } from "../public/js/party-shell-ui.js";

const now = new Date("2026-08-27T12:00:00.000Z");

test("client bundle normalizes viewing path", () => {
  const bundle = normalizeClientBundle({
    interest: CLIENT_INTEREST.INTERESTED,
    nextAction: CLIENT_NEXT_ACTION.VIEWING,
    viewingWindows: ["tomorrow_evening"]
  });
  assert.equal(bundle.interest, CLIENT_INTEREST.INTERESTED);
  assert.deepEqual(bundle.viewingWindows, ["tomorrow_evening"]);
});

test("resolver finds viewing ready when windows overlap", () => {
  const client = normalizeClientBundle({
    interest: CLIENT_INTEREST.INTERESTED,
    nextAction: CLIENT_NEXT_ACTION.VIEWING,
    viewingWindows: ["tomorrow_evening"]
  });
  const owner = normalizeOwnerBundle({
    propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
    viewingAllowed: OWNER_VIEWING_ALLOWED.YES,
    viewingWindows: ["tomorrow_evening"]
  });
  const outcome = resolveCoordinationOutcome({ clientBundle: client, ownerBundle: owner, now });
  assert.equal(outcome.outcome, COORDINATION_OUTCOME.VIEWING_READY);
  assert.match(outcome.brokerLine, /جاهز/);
  const living = livingStageForCoordinationOutcome(outcome.outcome);
  assert.equal(living.stage, "APPOINTMENT_COORDINATION");
});

test("resolver reports schedule conflict only", () => {
  const client = normalizeClientBundle({
    interest: CLIENT_INTEREST.INTERESTED,
    nextAction: CLIENT_NEXT_ACTION.VIEWING,
    viewingWindows: ["today_evening"]
  });
  const owner = normalizeOwnerBundle({
    propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
    viewingAllowed: OWNER_VIEWING_ALLOWED.YES,
    viewingWindows: ["tomorrow_morning"]
  });
  const outcome = resolveCoordinationOutcome({ clientBundle: client, ownerBundle: owner, now });
  assert.equal(outcome.outcome, COORDINATION_OUTCOME.SCHEDULE_CONFLICT);
  assert.equal(outcome.conflictField, "viewingWindows");
});

test("coordination form replaces legacy buttons when session exists", () => {
  const session = {
    matchId: "match_1",
    officeId: "office_1",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  const view = sanitizePartyPublicView({
    party: "owner",
    snapshot: { typePurpose: "شقة للإيجار", priceLabel: "20,000 ر.س" },
    coordination: session
  });
  assert.equal(view.actions.length, 0);
  assert.equal(view.coordinationForm.mode, "coordination_bundle");
  assert.equal(view.coordinationForm.submitted, false);
  const html = buildPartyShellHtml(view);
  assert.match(html, /data-party-coordination-form/);
  assert.match(html, /تسجيل الرد/);
  assert.equal(view.actions.length, 0);
});

test("submitted bundle shows recorded summary without legacy actions", () => {
  const ownerBundle = normalizeOwnerBundle({
    propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
    viewingAllowed: OWNER_VIEWING_ALLOWED.YES,
    viewingWindows: ["tomorrow_evening"]
  });
  const session = parseCoordinationSession({
    matchId: "match_1",
    ownerBundle,
    createdAt: now.toISOString()
  });
  const view = sanitizePartyPublicView({
    party: "owner",
    snapshot: { typePurpose: "شقة للإيجار", priceLabel: "20,000 ر.س" },
    coordination: session
  });
  assert.equal(view.replied, true);
  assert.match(view.replyLabel, /متاح/);
  const html = buildPartyShellHtml(view);
  assert.match(html, /تم تسجيل ردك/);
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

test("coordination form exposes semantic steps not free text", () => {
  const form = buildCoordinationFormView("client", { now });
  const interestStep = form.steps.find((step) => step.field === "interest");
  assert.equal(interestStep?.options?.some((opt) => opt.value === "interested" && opt.label === "مهتم"), true);
});
