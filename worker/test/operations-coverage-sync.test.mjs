import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  COVERAGE_INTENT,
  opportunityCoverageIntent,
  dealCoverageIntent,
  syncMatchViewingCoverage
} from "../src/operations-coverage-sync.js";

test("missing data stays authoritative over review/follow-up coverage", () => {
  const decision = opportunityCoverageIntent({
    opportunityKind: "REQUEST",
    purpose: "SALE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "",
    priceOrBudget: 600000,
    advertiserRole: "CLIENT",
    contactPhone: "+966500000001",
    nextFollowUpAt: "2026-09-08T12:00:00.000Z"
  });

  assert.equal(decision.intent, COVERAGE_INTENT.MISSING_DATA);
  assert.ok(decision.missingFields.includes("district"));
});

test("a complete scheduled opportunity resolves to follow-up coverage", () => {
  const decision = opportunityCoverageIntent({
    opportunityKind: "REQUEST",
    purpose: "SALE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "عروة",
    priceOrBudget: 600000,
    advertiserRole: "CLIENT",
    contactPhone: "+966500000001",
    followUp: {
      status: "scheduled",
      at: "2026-09-08T12:00:00.000Z"
    }
  });

  assert.equal(decision.intent, COVERAGE_INTENT.OPPORTUNITY_FOLLOW_UP);
  assert.equal(decision.dueAt, "2026-09-08T12:00:00.000Z");
});

test("a complete opportunity without follow-up resolves to review coverage", () => {
  const decision = opportunityCoverageIntent({
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "فيلا",
    city: "المدينة المنورة",
    district: "العوالي",
    priceOrBudget: 1500000,
    advertiserRole: "OWNER",
    contactPhone: "+966500000002"
  });

  assert.equal(decision.intent, COVERAGE_INTENT.OPPORTUNITY_REVIEW);
});

test("terminal opportunity creates no coverage intent", () => {
  const decision = opportunityCoverageIntent({ lifecycleStatus: "ARCHIVED" });
  assert.equal(decision.intent, COVERAGE_INTENT.NONE);
});

test("active deal resolves to DEAL_ACTION and preserves due time", () => {
  const decision = dealCoverageIntent({
    status: "open",
    workflowStage: "closing",
    nextFollowUpAt: "2026-09-10T09:00:00.000Z"
  });
  assert.equal(decision.intent, COVERAGE_INTENT.DEAL_ACTION);
  assert.equal(decision.stage, "closing");
  assert.equal(decision.dueAt, "2026-09-10T09:00:00.000Z");
});

test("terminal deal creates no coverage intent", () => {
  assert.equal(dealCoverageIntent({ status: "closed", workflowStage: "closed" }).intent, COVERAGE_INTENT.NONE);
  assert.equal(dealCoverageIntent({ status: "lost", workflowStage: "negotiation" }).intent, COVERAGE_INTENT.NONE);
});

test("shadow observers are wired to the intended persisted event boundaries", () => {
  const indexSource = fs.readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const canonicalSource = fs.readFileSync(new URL("../src/canonical-intake-service.js", import.meta.url), "utf8");

  for (const marker of [
    'source: "whatsapp_intake_persisted"',
    'source: "opportunity_patch_persisted"',
    '"followup_scheduled"',
    'source: "deal_created"',
    'source: "deal_stage_changed"',
    'source: "deal_followup_updated"'
  ]) {
    assert.ok(indexSource.includes(marker), `missing shadow wiring marker: ${marker}`);
  }
  assert.ok(canonicalSource.includes('source: "canonical_intake_complete"'));
  assert.ok(indexSource.includes('event: "operations_coverage_shadow"'));
});

test("viewing projection mirrors only into linked operation", async () => {
  const writes = [];
  const result = await syncMatchViewingCoverage({
    projectId: "demo",
    officeId: "office-1",
    match: {
      operationId: "op-match-1",
      appointmentAt: "2026-09-09T15:30:00.000Z",
      viewingAt: "2026-09-09T15:30:00.000Z",
      appointmentStatus: "CONFIRMED"
    },
    accessToken: "token",
    deps: {
      setFirestoreDocument: async (payload) => writes.push(payload),
      firestoreHelpers: {
        firestoreString: (value) => ({ stringValue: String(value) }),
        firestoreTimestamp: (value) => ({ timestampValue: value.toISOString() })
      }
    }
  });

  assert.equal(result.updated, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].segments, ["offices", "office-1", "operations", "op-match-1"]);
  assert.equal(writes[0].fields.appointmentStatus.stringValue, "CONFIRMED");
  assert.equal(writes[0].fields.viewingAt.stringValue, "2026-09-09T15:30:00.000Z");
});

test("viewing sync does nothing when the match has no linked operation", async () => {
  const result = await syncMatchViewingCoverage({
    projectId: "demo",
    officeId: "office-1",
    match: { appointmentAt: "2026-09-09T15:30:00.000Z" },
    accessToken: "token",
    deps: {
      setFirestoreDocument: async () => { throw new Error("must not write"); },
      firestoreHelpers: {}
    }
  });
  assert.equal(result.updated, false);
  assert.equal(result.reason, "missing_operation_id");
});
