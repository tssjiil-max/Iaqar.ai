/**
 * Office collaboration workflow V1 — required regression tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readRepositoryFile } from "./helpers/shell.mjs";
import { opportunityToMatchInput, scoreMatch, MATCH_THRESHOLD } from "../worker/src/matching-engine.js";
import {
  pickCooperationCandidates,
  rankCooperationCandidates,
  shouldSearchCrossOffice
} from "../worker/src/cooperation-ranking-layer.js";
import {
  COOPERATION_ACTION,
  COOPERATION_RECORD_STATUS,
  COOPERATION_ROLE,
  COOPERATION_STAGE,
  SORT_GROUP,
  applyCooperationWorkflowTransition,
  buildCooperationDailyTaskView,
  collaborationEnabled,
  cooperationAuthorizedContacts,
  livingCooperationTaskId,
  sanitizeCooperationView,
  selectBestCooperationOffices,
  shouldSearchCrossOffice as clientShouldSearch,
  sortGroupForCooperation
} from "../public/js/cooperation-workflow-domain.js";
import { mapOperationsItemsToDailyTasks } from "../src/v2/content/daily-tasks/domain.js";
import { buildDailyTaskCardHtml } from "../src/v2/content/daily-tasks/card.js";

const landOffer = opportunityToMatchInput({
  id: "offer_sakb",
  opportunityKind: "OFFER",
  transactionIntent: "SELL",
  purpose: "SALE",
  city: "المدينة المنورة",
  district: "السكب",
  propertyType: "أرض",
  salePrice: 840000,
  priceOrBudget: 840000,
  area: 1175,
  lifecycleStatus: "ACTIVE"
}, { id: "offer_sakb" });

const landRequest = opportunityToMatchInput({
  id: "req_sakb",
  opportunityKind: "REQUEST",
  transactionIntent: "BUY",
  purpose: "PURCHASE",
  city: "المدينة المنورة",
  district: "السكب",
  propertyType: "أرض",
  budget: 850000,
  priceOrBudget: 850000,
  area: 1100,
  lifecycleStatus: "ACTIVE"
}, { id: "req_sakb" });

const villaNearby = opportunityToMatchInput({
  id: "villa_near",
  opportunityKind: "OFFER",
  transactionIntent: "SELL",
  purpose: "SALE",
  city: "المدينة المنورة",
  district: "العزيزية",
  propertyType: "فيلا",
  priceOrBudget: 1800000,
  area: 400,
  lifecycleStatus: "ACTIVE"
}, { id: "villa_near" });

function livingRecord(overrides = {}) {
  return {
    id: "coop_task_1",
    cooperationTaskId: "coop_task_1",
    originatingOfficeId: "office-client",
    targetOfficeId: "office-wadi",
    originatingOfficeName: "مكتب النور العقاري",
    targetOfficeName: "مكتب الوادي العقاري",
    clientOfficeId: "office-client",
    propertyOfficeId: "office-wadi",
    status: COOPERATION_RECORD_STATUS.SUGGESTED,
    currentStage: COOPERATION_STAGE.MATCH_FOUND,
    opportunityId: "req_sakb",
    counterpartOpportunityId: "offer_sakb",
    propertyType: "أرض",
    purpose: "SALE",
    district: "السكب",
    proximityLabel: "نفس الحي",
    compatibilityLabel: "توافق مرتفع",
    matchReasons: ["نفس الحي", "المساحة مناسبة", "فارق السعر ضمن النطاق المقبول"],
    originListing: {
      propertyType: "أرض",
      purpose: "SALE",
      district: "السكب",
      priceOrBudget: 850000
    },
    counterpartListing: {
      propertyType: "أرض",
      purpose: "SALE",
      district: "السكب",
      priceOrBudget: 870000
    },
    ...overrides
  };
}

test("TEST 1 Collaboration OFF: no cross-office search", () => {
  assert.equal(shouldSearchCrossOffice({ internalMatchCount: 0, mode: "DISABLED" }), false);
  assert.equal(collaborationEnabled("DISABLED"), false);
  assert.equal(clientShouldSearch({ internalMatchCount: 0, mode: "DISABLED" }), false);
});

test("TEST 2 Internal match exists: skip cross-office", () => {
  assert.equal(shouldSearchCrossOffice({ internalMatchCount: 1, mode: "APPROVAL_REQUIRED" }), false);
});

test("TEST 3 No internal match + collaboration ON: search eligible offices", () => {
  assert.equal(shouldSearchCrossOffice({ internalMatchCount: 0, mode: "APPROVAL_REQUIRED" }), true);
});

test("TEST 4 Same district compatible office becomes a cooperation candidate", () => {
  const scored = scoreMatch(landRequest, landOffer);
  assert.equal(scored.eligible, true);
  assert.ok(scored.score >= MATCH_THRESHOLD);
  const ranked = rankCooperationCandidates({
    source: landRequest,
    candidates: [{ officeId: "office-wadi", officeName: "مكتب الوادي العقاري", listing: landOffer }],
    proximityScope: "SAME_DISTRICT"
  });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].proximityLabel, "نفس الحي");
});

test("TEST 5 Nearby office with incompatible property is not a match", () => {
  const ranked = rankCooperationCandidates({
    source: landRequest,
    candidates: [{ officeId: "office-near", listing: villaNearby }],
    proximityScope: "NEARBY_DISTRICTS"
  });
  assert.equal(ranked.length, 0);
});

test("TEST 6 Request cooperation creates the partner-facing living task", () => {
  const before = livingRecord();
  const sent = applyCooperationWorkflowTransition(before, COOPERATION_ACTION.REQUEST, {
    actorOfficeId: "office-client"
  });
  assert.equal(sent.ok, true);
  assert.equal(sent.patch.status, "PENDING");
  assert.equal(sent.patch.currentStage, COOPERATION_STAGE.WAITING_PARTNER);
  const partnerTask = buildCooperationDailyTaskView(
    { ...before, ...sent.patch },
    { officeId: "office-wadi" }
  );
  assert.equal(partnerTask.kindLabel, "طلب تعاون جديد");
  assert.equal(partnerTask.primaryAction.id, "accept_cooperation");
  assert.equal(partnerTask.id, "coop_task_1");
});

test("TEST 7 Accepting updates the same living task on the first office", () => {
  const pending = livingRecord({
    status: "PENDING",
    currentStage: COOPERATION_STAGE.WAITING_PARTNER
  });
  const accepted = applyCooperationWorkflowTransition(pending, COOPERATION_ACTION.ACCEPT, {
    actorOfficeId: "office-wadi"
  });
  assert.equal(accepted.ok, true);
  const originTask = buildCooperationDailyTaskView(
    { ...pending, ...accepted.patch },
    { officeId: "office-client" }
  );
  assert.equal(originTask.id, "coop_task_1");
  assert.equal(originTask.cooperationTaskId, livingCooperationTaskId("coop_task_1"));
  assert.match(originTask.kindLabel, /قبول/);
  assert.equal(originTask.primaryAction.id, "follow_customer");
});

test("TEST 8 Reject leaves no active cooperation and allows the next office", () => {
  const pending = livingRecord({ status: "PENDING", currentStage: COOPERATION_STAGE.WAITING_PARTNER });
  const rejected = applyCooperationWorkflowTransition(pending, COOPERATION_ACTION.REJECT, {
    actorOfficeId: "office-wadi"
  });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.patch.status, "REJECTED");
  const ranked = rankCooperationCandidates({
    source: landRequest,
    candidates: [
      { officeId: "office-wadi", listing: landOffer },
      { officeId: "office-next", listing: landOffer }
    ]
  });
  const next = pickCooperationCandidates(ranked.filter((row) => row.officeId !== "office-wadi"), { maxConcurrent: 1 });
  assert.equal(next[0].officeId, "office-next");
});

test("TEST 9 Double click does not duplicate a pending request", () => {
  const pending = livingRecord({ status: "PENDING", currentStage: COOPERATION_STAGE.WAITING_PARTNER });
  const again = applyCooperationWorkflowTransition(pending, COOPERATION_ACTION.REQUEST, {
    actorOfficeId: "office-client"
  });
  assert.equal(again.ok, true);
  assert.equal(again.duplicate, true);
  assert.equal(again.patch, null);
});

test("TEST 10 Reload keeps the persisted stage on the same task id", () => {
  const stored = livingRecord({
    status: "PENDING",
    currentStage: COOPERATION_STAGE.WAITING_PARTNER
  });
  const view = buildCooperationDailyTaskView(stored, { officeId: "office-client" });
  assert.equal(view.currentStage, COOPERATION_STAGE.WAITING_PARTNER);
  assert.equal(view.id, stored.cooperationTaskId);
  assert.match(view.statusLabel, /بانتظار/);
});

test("TEST 11 Partner office never sees the client phone", () => {
  const dirty = livingRecord({
    clientPhone: "0530899289",
    phone: "0530899289",
    originListing: { ...livingRecord().originListing, clientPhone: "0530899289" }
  });
  const view = buildCooperationDailyTaskView(dirty, { officeId: "office-wadi" });
  const html = buildDailyTaskCardHtml(view, { open: true });
  assert.equal(view.clientPhone, "");
  assert.equal(html.includes("0530899289"), false);
  assert.equal(sanitizeCooperationView(dirty).clientPhone, "");
});

test("partner view shows that office listing as own listing", () => {
  const view = buildCooperationDailyTaskView(livingRecord({
    status: "PENDING",
    currentStage: COOPERATION_STAGE.WAITING_PARTNER
  }), { officeId: "office-wadi" });
  assert.equal(view.ownMoney, "870,000 ر.س");
  assert.equal(view.partnerMoney, "850,000 ر.س");
});

test("TEST 12 Client office never sees the owner phone", () => {
  const dirty = livingRecord({
    ownerPhone: "0540000000",
    counterpartListing: { ...livingRecord().counterpartListing, ownerPhone: "0540000000" }
  });
  const view = buildCooperationDailyTaskView(dirty, { officeId: "office-client" });
  const html = buildDailyTaskCardHtml(view, { open: true });
  assert.equal(view.ownerPhone, "");
  assert.equal(html.includes("0540000000"), false);
  assert.equal(html.includes("تواصل مع العميل"), false);
});

test("TEST 13 Waiting state sorts below actionable tasks", () => {
  const waiting = buildCooperationDailyTaskView(
    livingRecord({ status: "PENDING", currentStage: COOPERATION_STAGE.WAITING_PARTNER }),
    { officeId: "office-client" }
  );
  const actionable = buildCooperationDailyTaskView(livingRecord(), { officeId: "office-client" });
  assert.equal(waiting.sortGroup, SORT_GROUP.WAITING_OTHER_OFFICE);
  assert.equal(actionable.sortGroup, SORT_GROUP.NEEDS_ACTION);
  const ordered = mapOperationsItemsToDailyTasks([
    {
      operationType: "COOPERATION_MATCH",
      ...livingRecord({ status: "PENDING", currentStage: COOPERATION_STAGE.WAITING_PARTNER })
    },
    { operationType: "COOPERATION_MATCH", ...livingRecord({ id: "coop_task_2", cooperationTaskId: "coop_task_2" }) }
  ], new Date(), { officeId: "office-client" });
  assert.equal(ordered[0].sortGroup, SORT_GROUP.NEEDS_ACTION);
  assert.equal(ordered[1].sortGroup, SORT_GROUP.WAITING_OTHER_OFFICE);
});

test("TEST 14 New actionable response returns the task to the top", () => {
  const group = sortGroupForCooperation({
    stage: COOPERATION_STAGE.ACCEPTED,
    role: COOPERATION_ROLE.CLIENT_OFFICE,
    record: livingRecord({
      status: "ACCEPTED",
      currentStage: COOPERATION_STAGE.ACCEPTED,
      hasNewResponse: true
    }),
    officeId: "office-client"
  });
  assert.equal(group, SORT_GROUP.NEW_RESPONSE);
});

test("TEST 15 Completion leaves active daily tasks and stays in history identity", () => {
  const both = applyCooperationWorkflowTransition(
    livingRecord({
      status: "ACCEPTED",
      currentStage: COOPERATION_STAGE.PRELIMINARY_AGREEMENT,
      completionConfirmations: { "office-wadi": "2026-08-25T00:00:00.000Z" }
    }),
    COOPERATION_ACTION.CONFIRM_COMPLETION,
    { actorOfficeId: "office-client" }
  );
  assert.equal(both.patch.status, "COMPLETED");
  const active = mapOperationsItemsToDailyTasks([
    {
      operationType: "COOPERATION_MATCH",
      ...livingRecord({ ...both.patch, id: "coop_task_1" })
    }
  ], new Date(), { officeId: "office-client" });
  assert.equal(active.length, 0);
  const archived = buildCooperationDailyTaskView(
    livingRecord({ ...both.patch }),
    { officeId: "office-client" }
  );
  assert.equal(archived.archived, true);
  assert.match(archived.kindLabel, /تمت الصفقة/);
});

test("TEST 16 Old operational page title is no longer rendered", () => {
  const bank = readRepositoryFile("public", "js", "opportunity-bank.js");
  const shell = readRepositoryFile("public", "index.html");
  assert.equal(bank.includes("مشاركات نشطة مع مكاتب أخرى"), false);
  assert.equal(shell.includes("مشاركات نشطة مع مكاتب أخرى"), false);
  assert.ok(shell.includes("التعاون بين المكاتب"));
  assert.ok(shell.includes("id=\"bankOutgoingScopes\""));
});

test("copied daily-task modules resolve cooperation domain in the browser", () => {
  const copiedDomain = readRepositoryFile("public", "js", "v2", "daily-tasks", "domain.js");
  const copiedController = readRepositoryFile("public", "js", "v2", "daily-tasks", "controller.js");
  assert.equal(copiedDomain.includes("../../../../public/js/"), false);
  assert.equal(copiedController.includes("../../../../public/js/"), false);
  assert.match(copiedDomain, /from "\.\.\/\.\.\/cooperation-workflow-domain\.js"/);
  assert.match(copiedController, /from "\.\.\/\.\.\/cooperation-workflow-domain\.js"/);
  assert.match(copiedController, /from "\.\.\/\.\.\/cooperation-phase6-domain\.js"/);
});

test("living task identity never forks across stages", () => {
  let record = livingRecord();
  const stages = [
    [COOPERATION_ACTION.REQUEST, "office-client"],
    [COOPERATION_ACTION.ACCEPT, "office-wadi"],
    [COOPERATION_ACTION.FOLLOW_CUSTOMER, "office-client"],
    [COOPERATION_ACTION.CUSTOMER_INTERESTED, "office-client"],
    [COOPERATION_ACTION.PROPERTY_AVAILABLE, "office-wadi"],
    [COOPERATION_ACTION.CONFIRM_APPOINTMENT, "office-client"]
  ];
  for (const [action, actor] of stages) {
    const next = applyCooperationWorkflowTransition(record, action, { actorOfficeId: actor });
    assert.equal(next.ok, true, action);
    record = { ...record, ...next.patch };
    const view = buildCooperationDailyTaskView(record, { officeId: actor });
    assert.equal(view.id, "coop_task_1");
  }
});

test("no broadcast: at most two partner offices", () => {
  const picked = selectBestCooperationOffices([
    { officeId: "a" }, { officeId: "b" }, { officeId: "c" }
  ], { maxConcurrent: 9 });
  assert.equal(picked.length, 2);
});

test("roles never render office1/office2", () => {
  const html = buildDailyTaskCardHtml(
    buildCooperationDailyTaskView(livingRecord(), { officeId: "office-client" }),
    { open: true }
  );
  assert.equal(/office1|office2|مكتب 1|مكتب 2/i.test(html), false);
  assert.match(html, /مكتب العميل|مكتب العقار/);
});

test("cooperationAuthorizedContacts exposes client phone after accept", () => {
  const contacts = cooperationAuthorizedContacts({
    status: COOPERATION_RECORD_STATUS.ACCEPTED,
    currentStage: COOPERATION_STAGE.ACCEPTED,
    clientOfficeId: "office-client",
    clientPhone: "+966552382937"
  }, "office-client");
  assert.equal(contacts.canSendToClient, true);
  assert.equal(contacts.clientPhone, "+966552382937");
  assert.equal(contacts.canSendToOwner, false);
});

test("cooperationAuthorizedContacts hides phones before accept", () => {
  const contacts = cooperationAuthorizedContacts({
    status: COOPERATION_RECORD_STATUS.PENDING,
    currentStage: COOPERATION_STAGE.WAITING_PARTNER,
    clientOfficeId: "office-client",
    clientPhone: "+966552382937"
  }, "office-client");
  assert.equal(contacts.clientPhone, "");
  assert.equal(contacts.canSendToClient, false);
});
