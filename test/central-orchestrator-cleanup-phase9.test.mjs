import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  ORCHESTRATOR_EVENT,
  ORCHESTRATOR_OWNER,
  aiMayPerform,
  orchestratorBoundaryGuarantees,
  orchestratorRoute
} from "../worker/src/central-orchestrator-domain.js";
import {
  buildOrchestratorEventId,
  dispatchOrchestratorEvent,
  orchestratorRuntimeGuarantees,
  validateOrchestratorEnvelope
} from "../worker/src/central-orchestrator-service.js";

function context(entityId = "opp_1") {
  return { officeId: "office-a", entityId };
}

test("every official event has one deterministic owner and allow-listed next targets", () => {
  const expected = new Map([
    [ORCHESTRATOR_EVENT.INTAKE_PERSISTED, [ORCHESTRATOR_OWNER.INTAKE, [ORCHESTRATOR_OWNER.COMPLETION]]],
    [ORCHESTRATOR_EVENT.OPPORTUNITY_COMPLETED, [ORCHESTRATOR_OWNER.COMPLETION, [ORCHESTRATOR_OWNER.MATCHING]]],
    [ORCHESTRATOR_EVENT.MATCH_CREATED, [ORCHESTRATOR_OWNER.MATCHING, [ORCHESTRATOR_OWNER.TASKS, ORCHESTRATOR_OWNER.NEGOTIATION]]],
    [ORCHESTRATOR_EVENT.COORDINATION_UPDATED, [ORCHESTRATOR_OWNER.NEGOTIATION, [ORCHESTRATOR_OWNER.VIEWING, ORCHESTRATOR_OWNER.TASKS]]],
    [ORCHESTRATOR_EVENT.VIEWING_CONFIRMED, [ORCHESTRATOR_OWNER.VIEWING, [ORCHESTRATOR_OWNER.TASKS]]],
    [ORCHESTRATOR_EVENT.DEAL_CREATED, [ORCHESTRATOR_OWNER.DEAL, [ORCHESTRATOR_OWNER.TASKS]]],
    [ORCHESTRATOR_EVENT.DEAL_STAGE_CHANGED, [ORCHESTRATOR_OWNER.DEAL, [ORCHESTRATOR_OWNER.TASKS]]],
    [ORCHESTRATOR_EVENT.COOPERATION_UPDATED, [ORCHESTRATOR_OWNER.COOPERATION, [ORCHESTRATOR_OWNER.TASKS]]],
    [ORCHESTRATOR_EVENT.NOTIFICATION_REQUESTED, [ORCHESTRATOR_OWNER.NOTIFICATIONS, []]]
  ]);
  for (const [event, [owner, next]] of expected) {
    assert.deepEqual(orchestratorRoute(event), { owner, next });
  }
  assert.equal(orchestratorRoute("DO_ANYTHING").error, "unknown_event");
});

test("AI remains extraction-only and cannot own business decisions", () => {
  for (const action of ["extract_text", "transcribe_audio", "classify_intent", "extract_listing_fields", "summarize"]) {
    assert.equal(aiMayPerform(action), true, action);
  }
  for (const action of ["run_matching", "advance_deal", "sign_contract", "transfer_ownership", "send_notification"]) {
    assert.equal(aiMayPerform(action), false, action);
  }
  const guarantees = orchestratorBoundaryGuarantees();
  assert.equal(guarantees.gptOwnsBusinessState, false);
  assert.equal(guarantees.gptRunsMatchingDecision, false);
  assert.equal(guarantees.gptAdvancesDeal, false);
  assert.equal(guarantees.gptTransfersOwnership, false);
});

test("envelope fails closed for unknown events, missing id and missing office/entity context", () => {
  assert.equal(validateOrchestratorEnvelope({ event: "UNKNOWN", eventId: "x", context: context() }).error, "unknown_event");
  assert.equal(validateOrchestratorEnvelope({ event: ORCHESTRATOR_EVENT.DEAL_CREATED, eventId: "", context: context("deal_1") }).error, "event_id_required");
  assert.equal(validateOrchestratorEnvelope({ event: ORCHESTRATOR_EVENT.DEAL_CREATED, eventId: "x", context: { officeId: "office-a" } }).error, "event_context_required");
});

test("event ids are deterministic for the same domain occurrence", () => {
  const a = buildOrchestratorEventId({ event: ORCHESTRATOR_EVENT.MATCH_CREATED, officeId: "office-a", entityId: "mat_1", occurrenceId: "created" });
  const b = buildOrchestratorEventId({ event: ORCHESTRATOR_EVENT.MATCH_CREATED, officeId: "office-a", entityId: "mat_1", occurrenceId: "created" });
  const c = buildOrchestratorEventId({ event: ORCHESTRATOR_EVENT.MATCH_CREATED, officeId: "office-a", entityId: "mat_2", occurrenceId: "created" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^orc:match_created:/);
});

test("dispatcher executes only route targets and cannot be redirected by caller context", async () => {
  const calls = [];
  const result = await dispatchOrchestratorEvent({
    event: ORCHESTRATOR_EVENT.DEAL_CREATED,
    eventId: "orc:deal_created:office-a:deal_1:created",
    context: { ...context("deal_1"), target: "matching-engine" },
    adapters: {
      [ORCHESTRATOR_OWNER.TASKS]: async ({ target }) => { calls.push(target); return { ok: true }; },
      [ORCHESTRATOR_OWNER.MATCHING]: async () => { throw new Error("must not run"); }
    }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [ORCHESTRATOR_OWNER.TASKS]);
});

test("missing or failing adapter is an explicit failure, never a fake success", async () => {
  const eventId = "orc:viewing_confirmed:office-a:mat_1:confirmed";
  const missing = await dispatchOrchestratorEvent({
    event: ORCHESTRATOR_EVENT.VIEWING_CONFIRMED,
    eventId,
    context: context("mat_1"),
    adapters: {}
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, "adapter_missing");

  const failed = await dispatchOrchestratorEvent({
    event: ORCHESTRATOR_EVENT.VIEWING_CONFIRMED,
    eventId,
    context: context("mat_1"),
    adapters: { [ORCHESTRATOR_OWNER.TASKS]: async () => ({ ok: false, error: "projection_failed" }) }
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "projection_failed");
});

test("durable claim hook makes repeated event idempotent without repeating effects", async () => {
  let claimed = false;
  let effects = 0;
  const args = {
    event: ORCHESTRATOR_EVENT.DEAL_STAGE_CHANGED,
    eventId: "orc:deal_stage_changed:office-a:deal_1:agreement",
    context: context("deal_1"),
    claimEvent: async () => {
      if (claimed) return false;
      claimed = true;
      return true;
    },
    adapters: { [ORCHESTRATOR_OWNER.TASKS]: async () => { effects += 1; return { ok: true }; } }
  };
  assert.equal((await dispatchOrchestratorEvent(args)).ok, true);
  const duplicate = await dispatchOrchestratorEvent(args);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.idempotent, true);
  assert.equal(effects, 1);
});

test("explicit deferred targets are traced but never fabricated as completed", async () => {
  const result = await dispatchOrchestratorEvent({
    event: ORCHESTRATOR_EVENT.MATCH_CREATED,
    eventId: "orc:match_created:office-a:mat_1:created",
    context: context("mat_1"),
    deferredTargets: [ORCHESTRATOR_OWNER.NEGOTIATION],
    adapters: { [ORCHESTRATOR_OWNER.TASKS]: async () => ({ ok: true }) }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.trace, [
    { target: ORCHESTRATOR_OWNER.TASKS, status: "completed" },
    { target: ORCHESTRATOR_OWNER.NEGOTIATION, status: "deferred" }
  ]);
});

test("runtime guarantees forbid arbitrary targets and false delivery/state ownership", () => {
  const g = orchestratorRuntimeGuarantees();
  assert.equal(g.arbitraryTargetsAllowed, false);
  assert.equal(g.eventIdRequired, true);
  assert.equal(g.adapterFailureClaimsSuccess, false);
  assert.equal(g.duplicateDispatchRepeatsEffects, false);
  assert.equal(g.domainOwnersRemainAuthoritative, true);
});

test("Central Orchestrator is wired into real runtime boundaries, not left as a dead contract", () => {
  const indexSource = fs.readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");
  const intakeSource = fs.readFileSync(new URL("../worker/src/canonical-intake-service.js", import.meta.url), "utf8");
  const partySource = fs.readFileSync(new URL("../worker/src/party-session-service.js", import.meta.url), "utf8");

  assert.ok(indexSource.includes('from "./central-orchestrator-service.js"'), "worker runtime must import orchestrator service");
  assert.ok(indexSource.includes("dispatchOrchestratorEvent("), "worker runtime must dispatch orchestrator events");
  assert.ok(indexSource.includes("ORCHESTRATOR_EVENT.DEAL_CREATED"), "deal creation boundary must emit an orchestrator event");
  assert.ok(indexSource.includes("ORCHESTRATOR_EVENT.DEAL_STAGE_CHANGED"), "deal stage boundary must emit an orchestrator event");
  assert.ok(indexSource.includes("ORCHESTRATOR_EVENT.MATCH_CREATED"), "match creation boundary must emit an orchestrator event");
  assert.ok(indexSource.includes("ORCHESTRATOR_EVENT.COOPERATION_UPDATED"), "cooperation boundary must emit an orchestrator event");
  assert.ok(intakeSource.includes("ORCHESTRATOR_EVENT.INTAKE_PERSISTED"), "canonical intake must emit persisted event");
  assert.ok(intakeSource.includes("ORCHESTRATOR_EVENT.OPPORTUNITY_COMPLETED"), "canonical intake must emit completed event");
  assert.ok(partySource.includes("ORCHESTRATOR_EVENT.COORDINATION_UPDATED"), "coordination boundary must emit event");
  assert.ok(partySource.includes("ORCHESTRATOR_EVENT.VIEWING_CONFIRMED"), "viewing boundary must emit event");
});
