import test from "node:test";
import assert from "node:assert/strict";

import {
  POST_MATCH_EVENT,
  POST_MATCH_SOURCE_OF_TRUTH,
  POST_MATCH_STAGE,
  canCreateDeal,
  nextDealStage,
  planPostMatchTransition,
  postMatchBoundaryGuarantees,
  resolvePostMatchStage,
  validateDealTransition
} from "../worker/src/post-match-chain-domain.js";
import {
  DAILY_TASK_SOURCE_MODE,
  dailyTaskSourceBoundaryGuarantees,
  evaluateOperationsOnlyActivation,
  selectDailyTaskSource,
  topHomeDailyTasks
} from "../public/js/daily-tasks-source-policy.js";
import {
  aiMayPerform,
  orchestratorBoundaryGuarantees,
  orchestratorRoute,
  ORCHESTRATOR_EVENT,
  ORCHESTRATOR_OWNER
} from "../worker/src/central-orchestrator-domain.js";
import {
  normalizeTelegramInbound,
  telegramIntakeBoundaryGuarantees,
  TELEGRAM_INTAKE_KIND
} from "../worker/src/telegram-intake-domain.js";
import { phase6BoundaryGuarantees as cooperationBoundaries } from "../worker/src/cooperation-phase6-domain.js";
import { phase7BoundaryGuarantees as messagingBoundaries } from "../worker/src/messaging-domain.js";
import { MAX_TODAY_TASKS } from "../public/js/daily-tasks-domain.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

test("post-match sources of truth are explicit and non-overlapping", () => {
  assert.deepEqual(POST_MATCH_SOURCE_OF_TRUTH, {
    NEGOTIATION: "coordinationSessions",
    VIEWING: "matches",
    DEAL: "deals",
    TASKS: "operations"
  });
  const boundaries = postMatchBoundaryGuarantees();
  assert.equal(boundaries.operationOwnsBusinessState, false);
  assert.equal(boundaries.partyReplyAutoCreatesDeal, false);
  assert.equal(boundaries.viewingConfirmationAutoCreatesDeal, false);
  assert.equal(boundaries.viewingCompletionAutoCreatesDeal, false);
});

test("coordination updates negotiation authoritatively and only projects outward", () => {
  const plan = planPostMatchTransition({ event: POST_MATCH_EVENT.COORDINATION_UPDATED });
  assert.equal(plan.ok, true);
  assert.equal(plan.createsDeal, false);
  assert.deepEqual(plan.writes, [
    { target: "coordinationSessions", mode: "authoritative" },
    { target: "matches", mode: "projection" },
    { target: "operations", mode: "projection" }
  ]);
});

test("viewing confirmation is owned by Match and requires an actual time", () => {
  assert.deepEqual(
    planPostMatchTransition({ event: POST_MATCH_EVENT.VIEWING_CONFIRMED }),
    { ok: false, reason: "viewing_time_required", writes: [] }
  );
  const plan = planPostMatchTransition({
    event: POST_MATCH_EVENT.VIEWING_CONFIRMED,
    payload: { appointmentAt: "2026-09-08T18:00:00+03:00" }
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.writes, [
    { target: "matches", mode: "authoritative" },
    { target: "operations", mode: "projection" }
  ]);
  assert.equal(plan.createsDeal, false);
});

test("viewing completion event remains Match-owned and does not create Deal", () => {
  const missing = planPostMatchTransition({ event: POST_MATCH_EVENT.VIEWING_COMPLETED });
  assert.deepEqual(missing, { ok: false, reason: "viewing_completion_required", writes: [] });
  const plan = planPostMatchTransition({
    event: POST_MATCH_EVENT.VIEWING_COMPLETED,
    payload: { completedAt: "2026-09-08T19:00:00+03:00" }
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.createsDeal, false);
  assert.deepEqual(plan.writes, [
    { target: "matches", mode: "authoritative" },
    { target: "operations", mode: "projection" }
  ]);
});

test("deal cannot be created from a weak match before seriousness", () => {
  assert.deepEqual(canCreateDeal({ match: { livingStage: "MATCH_FOUND" } }), {
    allowed: false,
    reason: "not_serious_yet"
  });
  const rejected = planPostMatchTransition({
    event: POST_MATCH_EVENT.DEAL_CREATED,
    match: { livingStage: "MATCH_FOUND" }
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "not_serious_yet");
});

test("confirmed appointment is not enough; completed serious viewing or explicit serious coordination may open Deal", () => {
  const confirmed = canCreateDeal({
    match: {
      appointmentStatus: "CONFIRMED",
      appointmentAt: "2026-09-08T18:00:00+03:00"
    }
  });
  assert.equal(confirmed.allowed, false);
  assert.equal(confirmed.reason, "not_serious_yet");

  const completedNotSerious = canCreateDeal({
    match: { viewingCompletedAt: "2026-09-08T19:00:00+03:00", livingStage: "VIEWING_COMPLETED" }
  });
  assert.equal(completedNotSerious.allowed, false);

  const completedSerious = canCreateDeal({
    match: {
      viewingCompletedAt: "2026-09-08T19:00:00+03:00",
      livingStage: "VIEWING_COMPLETED",
      seriousIntentConfirmed: true
    }
  });
  assert.equal(completedSerious.allowed, true);
  assert.equal(completedSerious.reason, "viewing_completed_serious");

  assert.equal(canCreateDeal({ coordination: { outcome: "VIEWING_READY" } }).allowed, false);
  assert.equal(canCreateDeal({ coordination: { outcome: "PRICE_ALIGNED" } }).allowed, true);
});

test("post-match stage resolution follows coordination then viewing then Deal", () => {
  assert.equal(resolvePostMatchStage({}), POST_MATCH_STAGE.MATCH_REVIEW);
  assert.equal(resolvePostMatchStage({ coordination: { outcome: "PRICE_NEGOTIATION" } }), POST_MATCH_STAGE.NEGOTIATION);
  assert.equal(resolvePostMatchStage({ match: { viewingCandidateAt: "2026-09-08T18:00:00+03:00" } }), POST_MATCH_STAGE.VIEWING_CANDIDATE);
  assert.equal(resolvePostMatchStage({ match: { appointmentStatus: "CONFIRMED", appointmentAt: "x" } }), POST_MATCH_STAGE.VIEWING_CONFIRMED);
  assert.equal(resolvePostMatchStage({ match: { viewingCompletedAt: "x", livingStage: "VIEWING_COMPLETED" } }), POST_MATCH_STAGE.VIEWING_COMPLETED);
  assert.equal(resolvePostMatchStage({ deal: { workflowStage: "agreement" } }), POST_MATCH_STAGE.DEAL_AGREEMENT);
  assert.equal(resolvePostMatchStage({ deal: { workflowStage: "closed" } }), POST_MATCH_STAGE.CLOSED);
});

test("Deal lifecycle is forward-only, one stage at a time, with explicit lost", () => {
  assert.equal(nextDealStage("contact"), "viewing");
  assert.equal(nextDealStage("viewing"), "negotiation");
  assert.equal(nextDealStage("closing"), "closed");
  assert.equal(nextDealStage("closed"), "closed");
  assert.equal(validateDealTransition("negotiation", "agreement").ok, true);
  assert.equal(validateDealTransition("negotiation", "closing").reason, "skipped_stage");
  assert.equal(validateDealTransition("agreement", "negotiation").reason, "backward_transition");
  assert.equal(validateDealTransition("agreement", "lost").ok, true);
  assert.equal(validateDealTransition("closed", "lost").reason, "terminal_deal");
});

test("Daily Tasks cannot switch to Operations-only before measured 100 percent coverage", () => {
  const blocked = evaluateOperationsOnlyActivation({
    coveragePercent: 99,
    duplicateActiveTasks: 0,
    uncoveredCriticalTypes: [],
    shadowCycles: 1
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.mode, DAILY_TASK_SOURCE_MODE.MIXED_SHADOW);

  const allowed = evaluateOperationsOnlyActivation({
    coveragePercent: 100,
    duplicateActiveTasks: 0,
    uncoveredCriticalTypes: [],
    shadowCycles: 2
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.mode, DAILY_TASK_SOURCE_MODE.OPERATIONS_ONLY);
});

test("Operations-only source excludes duplicate raw business feeds", () => {
  const sources = {
    operations: [{ id: "op_1", recordType: "operation" }, { id: "op_2", recordType: "operation" }],
    opportunities: [{ id: "opp_1", recordType: "opportunity" }],
    matches: [{ id: "mat_1", recordType: "match" }],
    deals: [{ id: "deal_1", recordType: "deal" }]
  };
  const only = selectDailyTaskSource(sources, { mode: DAILY_TASK_SOURCE_MODE.OPERATIONS_ONLY });
  assert.deepEqual(only.map((row) => row.id), ["op_1", "op_2"]);
});

test("home Daily Tasks hard limit remains five", () => {
  assert.equal(MAX_TODAY_TASKS, 5);
  assert.equal(dailyTaskSourceBoundaryGuarantees().homeTopTaskCount, 5);
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: `op_${i + 1}` }));
  assert.equal(topHomeDailyTasks(rows).length, 5);
});

test("central orchestrator owns routing while GPT remains extraction-only", () => {
  assert.deepEqual(orchestratorRoute(ORCHESTRATOR_EVENT.OPPORTUNITY_COMPLETED), {
    owner: ORCHESTRATOR_OWNER.COMPLETION,
    next: [ORCHESTRATOR_OWNER.MATCHING]
  });
  assert.deepEqual(orchestratorRoute(ORCHESTRATOR_EVENT.MATCH_CREATED), {
    owner: ORCHESTRATOR_OWNER.MATCHING,
    next: [ORCHESTRATOR_OWNER.TASKS, ORCHESTRATOR_OWNER.NEGOTIATION]
  });
  assert.equal(aiMayPerform("extract_listing_fields"), true);
  assert.equal(aiMayPerform("advance_deal"), false);
  const boundaries = orchestratorBoundaryGuarantees();
  assert.equal(boundaries.gptOwnsBusinessState, false);
  assert.equal(boundaries.gptRunsMatchingDecision, false);
  assert.equal(boundaries.gptAdvancesDeal, false);
});

test("Telegram bot intake is inbound-only and enters canonical intake instead of negotiation", () => {
  const normalized = normalizeTelegramInbound({
    update_id: 101,
    message: {
      message_id: 33,
      date: 1788760000,
      chat: { id: -100123 },
      from: { id: 7, first_name: "عميل", username: "buyer" },
      text: "أبحث عن شقة في المدينة"
    }
  }, { officeId: "office-a" });
  assert.equal(normalized.source, "telegram");
  assert.equal(normalized.kind, TELEGRAM_INTAKE_KIND.TEXT);
  assert.equal(normalized.createCanonicalOpportunityDirectly, false);
  assert.equal(normalized.negotiationAllowed, false);
  assert.equal(telegramIntakeBoundaryGuarantees().inboundOnly, true);
});

test("cooperation preserves ownership and messaging channels do not auto-send", () => {
  const coop = cooperationBoundaries();
  assert.equal(coop.exposesContactAutomatically, false);
  assert.equal(coop.createsCommission, false);
  assert.equal(coop.sendsWhatsApp, false);
  assert.equal(coop.sendsTelegram, false);

  const messaging = messagingBoundaries();
  assert.equal(messaging.autoSendsMessages, false);
  assert.equal(messaging.sendsWhatsApp, false);
  assert.equal(messaging.sendsTelegram, false);
  assert.equal(messaging.claimsFakeDelivery, false);
});

test("existing worker wiring keeps negotiation, viewing, Deal, cooperation, messaging and admin separated", () => {
  const party = readRepositoryFile("worker", "src", "party-session-service.js");
  const coordination = readRepositoryFile("worker", "src", "coordination-session-service.js");
  const worker = readRepositoryFile("worker", "src", "index.js");
  const cooperation = readRepositoryFile("worker", "src", "cooperation-phase6-domain.js");
  const messaging = readRepositoryFile("worker", "src", "messaging-domain.js");
  const admin = readRepositoryFile("worker", "src", "admin-service.js");
  const adminPage = readRepositoryFile("public", "admin", "index.html");

  assert.match(coordination, /coordinationSessions/);
  assert.match(party, /CONFIRM_VIEWING/);
  assert.match(party, /appointmentStatus/);
  assert.match(worker, /createDealFromMatch/);
  assert.match(worker, /finalizeDealAndCloseSiblings/);
  assert.match(cooperation, /assertOwnershipPreserved/);
  assert.match(messaging, /autoSendsMessages:\s*false/);
  assert.match(admin, /handleAdminOverview/);
  assert.match(adminPage, /admin/i);
});
