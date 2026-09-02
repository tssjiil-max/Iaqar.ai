/**
 * Phase 5 — Operations Center + Notifications automated tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  OPERATION_TYPES,
  OPERATION_STATUS,
  OPERATION_PRIORITY,
  NOTIFICATION_TYPES,
  NOTIFICATION_STATUS,
  ACTIVE_OPERATION_STATUSES,
  buildMatchReviewDedupKey,
  buildMissingDataDedupKey,
  buildCooperationDedupKey,
  buildMatchReviewOperation,
  buildMissingDataOperation,
  buildCooperationOperation,
  buildInAppNotification,
  applyOperationLifecycle,
  shouldCreateMatchReview,
  matchReviewPriority,
  phase5BoundaryGuarantees,
  operationDocumentId,
  notificationDocumentId,
  isActiveOperationStatus,
  priorityRank
} from "../worker/src/operations-domain.js";
import {
  listMissingOpportunityFields,
  pushTypeForOperation
} from "../worker/src/operations-service.js";
import {
  projectOperationToUiItem,
  resolveOwnerContactNeeded,
  phase5BoundaryGuarantees as clientBoundaries,
  OPERATIONS_ACTION_PATH,
  requestOperationAction
} from "../public/js/operations-domain.js";
import { firebaseStub, loadShell, readRepositoryFile } from "./helpers/shell.mjs";

test("Phase 5 operation types and statuses are centralized", () => {
  assert.equal(OPERATION_TYPES.MATCH_REVIEW, "MATCH_REVIEW");
  assert.equal(OPERATION_TYPES.MISSING_DATA, "MISSING_DATA");
  assert.equal(OPERATION_STATUS.OPEN, "OPEN");
  assert.deepEqual([...ACTIVE_OPERATION_STATUSES], ["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"]);
});

test("1. valid actionable Match builds one MATCH_REVIEW Operation", async () => {
  assert.equal(shouldCreateMatchReview({ score: 80, threshold: 55 }), true);
  const op = await buildMatchReviewOperation({
    officeId: "office-a",
    matchId: "mat_1",
    opportunityId: "opp_1",
    dataVersion: "dv1",
    score: 80,
    opportunityScore: 85,
    reasons: ["نفس الحي", "تقارب السعر"]
  });
  assert.equal(op.type, OPERATION_TYPES.MATCH_REVIEW);
  assert.equal(op.officeId, "office-a");
  assert.equal(op.matchId, "mat_1");
  assert.equal(op.status, OPERATION_STATUS.OPEN);
  assert.equal(op.createdBySystem, true);
  assert.ok(op.id.startsWith("op_"));
  assert.equal(op.recommendedActionText, "مراجعة المطابقة");
  assert.match(op.titleText, /مطابقة/);
});

test("2. below-threshold Match creates no Operation", () => {
  assert.equal(shouldCreateMatchReview({ score: 40, threshold: 55 }), false);
});

test("3. stale / superseded Match does not create an active Operation", () => {
  assert.equal(shouldCreateMatchReview({ score: 90, isCurrent: false }), false);
  assert.equal(shouldCreateMatchReview({ score: 90, status: "superseded" }), false);
});

test("4. same Match event twice yields the same Operation id (dedupe)", async () => {
  const a = await buildMatchReviewOperation({
    officeId: "office-a", matchId: "mat_x", dataVersion: "v1", score: 70
  });
  const b = await buildMatchReviewOperation({
    officeId: "office-a", matchId: "mat_x", dataVersion: "v1", score: 70
  });
  assert.equal(a.id, b.id);
  assert.equal(a.deduplicationKey, b.deduplicationKey);
});

test("5. concurrent processing uses deterministic document ids", async () => {
  const key = buildMatchReviewDedupKey({ officeId: "o1", matchId: "m1", dataVersion: "d1" });
  const ids = await Promise.all([
    operationDocumentId(key),
    operationDocumentId(key),
    operationDocumentId(key)
  ]);
  assert.equal(ids[0], ids[1]);
  assert.equal(ids[1], ids[2]);
});

test("6. missing-data condition creates one MISSING_DATA Operation", async () => {
  const missing = listMissingOpportunityFields({
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "الرياض"
  });
  assert.ok(missing.includes("district"));
  const op = await buildMissingDataOperation({
    officeId: "office-a",
    opportunityId: "opp_md",
    missingFields: ["الحي", "المساحة"],
    dataVersion: "1"
  });
  assert.equal(op.type, OPERATION_TYPES.MISSING_DATA);
  assert.equal(op.recommendedActionText, "استكمال البيانات");
  assert.match(op.summaryText, /الحقول الناقصة/);
});

test("6b. land opportunities do not treat rooms as missing", () => {
  const missing = listMissingOpportunityFields({
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "أرض تجارية",
    city: "المدينة المنورة",
    district: "أبيار علي",
    priceOrBudget: 500000,
    area: 400
  });
  assert.equal(missing.includes("rooms"), false);
});

test("7. completing missing data closes via COMPLETE lifecycle", () => {
  const result = applyOperationLifecycle(
    { status: OPERATION_STATUS.OPEN },
    "COMPLETE"
  );
  assert.equal(result.ok, true);
  assert.equal(result.patch.status, OPERATION_STATUS.COMPLETED);
  assert.ok(result.patch.completedAt);
});

test("8. Operation routes to correct officeId", async () => {
  const op = await buildMatchReviewOperation({
    officeId: "office-b", matchId: "mat_b", score: 70, dataVersion: "v"
  });
  assert.equal(op.officeId, "office-b");
});

test("9. assigned broker is stored when known", async () => {
  const op = await buildMatchReviewOperation({
    officeId: "office-a",
    assignedBrokerId: "broker-a1",
    matchId: "mat_1",
    score: 70,
    dataVersion: "v"
  });
  assert.equal(op.assignedBrokerId, "broker-a1");
});

test("10. another office cannot share the same Operation document id path semantics", async () => {
  const a = await buildMatchReviewOperation({
    officeId: "office-a", matchId: "mat_same", dataVersion: "v1", score: 70
  });
  const b = await buildMatchReviewOperation({
    officeId: "office-b", matchId: "mat_same", dataVersion: "v1", score: 70
  });
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.deduplicationKey, b.deduplicationKey);
});

test("11. unknown broker assignment falls back to empty assignedBrokerId (office queue)", async () => {
  const op = await buildMatchReviewOperation({
    officeId: "office-a", matchId: "mat_1", score: 70, dataVersion: "v"
  });
  assert.equal(op.assignedBrokerId, "");
});

test("12. cooperation Operation targets the receiving office only for REQUEST", async () => {
  const op = await buildCooperationOperation({
    officeId: "office-target",
    cooperationId: "coop_1",
    opportunityId: "opp_1",
    responseStatus: "PENDING",
    isResponse: false
  });
  assert.equal(op.officeId, "office-target");
  assert.equal(op.type, OPERATION_TYPES.COOPERATION_REQUEST);
});

test("13. OPEN can move to IN_PROGRESS", () => {
  const result = applyOperationLifecycle({ status: "OPEN" }, "START");
  assert.equal(result.ok, true);
  assert.equal(result.patch.status, OPERATION_STATUS.IN_PROGRESS);
});

test("14. IN_PROGRESS can move to COMPLETED", () => {
  const result = applyOperationLifecycle({ status: "IN_PROGRESS" }, "COMPLETE");
  assert.equal(result.ok, true);
  assert.equal(result.patch.status, OPERATION_STATUS.COMPLETED);
});

test("15. explicit dismissal works", () => {
  const result = applyOperationLifecycle({ status: "OPEN" }, "DISMISS", { reason: "not_relevant" });
  assert.equal(result.ok, true);
  assert.equal(result.patch.status, OPERATION_STATUS.DISMISSED);
  assert.equal(result.patch.dismissalReason, "not_relevant");
});

test("16. unauthorized status transition fails", () => {
  const result = applyOperationLifecycle({ status: "COMPLETED" }, "START");
  assert.equal(result.ok, false);
});

test("17. completed Operation is not active", () => {
  assert.equal(isActiveOperationStatus(OPERATION_STATUS.COMPLETED), false);
  assert.equal(isActiveOperationStatus(OPERATION_STATUS.OPEN), true);
});

test("18. EXPIRE closes stale Match Operations", () => {
  const result = applyOperationLifecycle({ status: "OPEN" }, "EXPIRE");
  assert.equal(result.ok, true);
  assert.equal(result.patch.status, OPERATION_STATUS.EXPIRED);
});

test("19. deduplicationKey is deterministic", () => {
  const a = buildMatchReviewDedupKey({ officeId: "o", matchId: "m", dataVersion: "d" });
  const b = buildMatchReviewDedupKey({ officeId: "o", matchId: "m", dataVersion: "d" });
  assert.equal(a, b);
  const md = buildMissingDataDedupKey({
    officeId: "o", opportunityId: "opp", dataVersion: "1", missingFields: ["b", "a"]
  });
  assert.equal(md, buildMissingDataDedupKey({
    officeId: "o", opportunityId: "opp", dataVersion: "1", missingFields: ["a", "b"]
  }));
});

test("20. worker retry uses same Operation id", async () => {
  const key = buildMatchReviewDedupKey({ officeId: "o", matchId: "m", dataVersion: "d" });
  assert.equal(await operationDocumentId(key), await operationDocumentId(key));
});

test("21. relevant source-version change creates a new Operation id", async () => {
  const a = await buildMatchReviewOperation({
    officeId: "o", matchId: "m1", dataVersion: "v1", score: 70
  });
  const b = await buildMatchReviewOperation({
    officeId: "o", matchId: "m2", dataVersion: "v2", score: 70
  });
  assert.notEqual(a.id, b.id);
});

test("22. irrelevant source change (same matchId+version) keeps Operation id", async () => {
  const a = await buildMatchReviewOperation({
    officeId: "o", matchId: "m", dataVersion: "v1", score: 70, reasons: ["a"]
  });
  const b = await buildMatchReviewOperation({
    officeId: "o", matchId: "m", dataVersion: "v1", score: 71, reasons: ["b"]
  });
  assert.equal(a.id, b.id);
});

test("23. actionable Operation creates one in-app Notification", async () => {
  const op = await buildMatchReviewOperation({
    officeId: "office-a", matchId: "mat_n", dataVersion: "v", score: 80
  });
  const n = await buildInAppNotification({ officeId: "office-a", operation: op });
  assert.equal(n.operationId, op.id);
  assert.equal(n.type, NOTIFICATION_TYPES.NEW_MATCH);
  assert.equal(n.status, NOTIFICATION_STATUS.CREATED);
  assert.match(n.title, /مطابقة/);
});

test("24. duplicate Notification event is idempotent by id", async () => {
  const op = await buildMatchReviewOperation({
    officeId: "office-a", matchId: "mat_n2", dataVersion: "v", score: 80
  });
  const a = await buildInAppNotification({ officeId: "office-a", operation: op });
  const b = await buildInAppNotification({ officeId: "office-a", operation: op });
  assert.equal(a.id, b.id);
  assert.equal(await notificationDocumentId(a.deduplicationKey), a.id);
});

test("25. Notification links to the correct Operation", async () => {
  const op = await buildMatchReviewOperation({
    officeId: "office-a", matchId: "mat_link", opportunityId: "opp_request_1",
    matchGroupId: "opp_request_1", dataVersion: "v", score: 80
  });
  const n = await buildInAppNotification({ officeId: "office-a", operation: op });
  assert.equal(n.operationId, op.id);
  assert.equal(n.matchId, "mat_link");
  assert.equal(n.taskId, "mg_opp_request_1");
  assert.equal(n.workflowId, "mg_opp_request_1");
});

test("26. match push type maps to matchNotifications preference category", () => {
  assert.equal(pushTypeForOperation(OPERATION_TYPES.MATCH_REVIEW), "match");
});

test("27. Phase 5 boundaries keep in-app Operation independent of push", () => {
  const g = phase5BoundaryGuarantees();
  assert.equal(g.sendsWhatsApp, false);
  assert.equal(g.createsDeal, false);
  assert.deepEqual(clientBoundaries(), g);
});

test("28. invalid token failure path never claims delivery in domain notification", async () => {
  const op = await buildMatchReviewOperation({
    officeId: "office-a", matchId: "mat_f", dataVersion: "v", score: 80
  });
  const n = await buildInAppNotification({ officeId: "office-a", operation: op });
  assert.notEqual(n.status, NOTIFICATION_STATUS.DELIVERED);
  assert.notEqual(n.providerState.push, "DELIVERED");
});

test("29. real delivery is not claimed without provider confirmation", async () => {
  const op = await buildMatchReviewOperation({
    officeId: "office-a", matchId: "mat_d", dataVersion: "v", score: 80
  });
  const n = await buildInAppNotification({ officeId: "office-a", operation: op });
  assert.equal(n.providerState.pushDeliveredAt, null);
});

test("30. sensitive fields are excluded from push preview", async () => {
  const op = await buildMatchReviewOperation({
    officeId: "office-a", matchId: "mat_s", dataVersion: "v", score: 80,
    reasons: ["نفس الحي"]
  });
  const n = await buildInAppNotification({ officeId: "office-a", operation: op });
  assert.equal(n.sensitivePreview, false);
  assert.equal(n.body.includes("05"), false);
  assert.equal(n.title, "لديك مطابقة جديدة تحتاج مراجعتك.");
});

test("priority rules are deterministic", () => {
  assert.equal(matchReviewPriority({ opportunityScore: 90 }), OPERATION_PRIORITY.HIGH);
  assert.equal(matchReviewPriority({ opportunityScore: 60 }), OPERATION_PRIORITY.NORMAL);
  assert.equal(priorityRank(OPERATION_PRIORITY.URGENT), 0);
});

test("31-35. UI: empty state, active card, no completed in active projector", async () => {
  const shell = await loadShell({ firebase: firebaseStub(), officeRuntime: { officeId: "office-a" } });
  try {
    const { document, window } = shell;
    const todayEmpty = document.getElementById("operationsTodayEmpty");
    assert.ok(todayEmpty.textContent.includes("لا توجد مهام عاجلة اليوم"));

    const ui = {
      ...projectOperationToUiItem({
      id: "op_test",
      type: "MATCH_REVIEW",
      titleText: "مطابقة جديدة تحتاج مراجعتك",
      summaryText: "ظهرت مطابقة جاهزة للمراجعة داخل مكتبكم.",
      recommendedActionText: "مراجعة المطابقة",
      priority: "HIGH",
      status: "OPEN",
      createdAt: new Date().toISOString(),
      metadata: { score: 88, reasonPreview: "نفس الحي" }
    }),
      clientPhone: "0511123456",
      ownerPhone: "0522233344"
    };
    window.dispatchEvent(new window.CustomEvent("iaqar:operations-data", {
      detail: { authoritative: true, items: [ui] }
    }));
    document.getElementById("operationsShowCategories").click();
    document.querySelector("[data-ops-category=\"matched\"]").click();
    assert.equal(document.getElementById("operationsEmpty").hidden, true);
    assert.match(document.querySelector(".ops-task-body h4").textContent, /مطابقة/);
    assert.match(document.querySelector(".ops-task-body p").textContent, /مراجعة/);
    assert.equal(ui.priorityLabel, "مرتفع");

    window.dispatchEvent(new window.CustomEvent("iaqar:operations-data", {
      detail: { authoritative: true, items: [] }
    }));
    document.getElementById("operationsShowCategories").click();
    assert.equal(document.getElementById("operationsEmpty").hidden, false);

    assert.equal(isActiveOperationStatus("COMPLETED"), false);
  } finally {
    shell.close();
  }
});

test("36-42. Phase 5 UI boundaries: no bottom nav or deals page; Phase 7 draft actions only", async () => {
  const shellSource = readRepositoryFile("public", "index.html");
  assert.equal(shellSource.includes('data-main="deals"'), false);
  assert.equal(/bottom-nav|bottom_nav|bottomNav/.test(shellSource), false);

  const shell = await loadShell({ firebase: firebaseStub(), officeRuntime: { officeId: "office-a" } });
  try {
    const { document, window } = shell;
    const ui = {
      ...projectOperationToUiItem({
      id: "op_bound",
      type: "MATCH_REVIEW",
      titleText: "مطابقة جديدة تحتاج مراجعتك",
      summaryText: "ملخص آمن",
      recommendedActionText: "مراجعة المطابقة",
      priority: "NORMAL",
      status: "OPEN",
      createdAt: new Date().toISOString()
    }),
      clientPhone: "0511123456",
      ownerPhone: "0522233344"
    };
    // Phase 7: Match review may offer draft actions; never send claims.
    assert.equal(ui.whatsappOwner, true);
    assert.equal(ui.whatsappClient, true);
    assert.equal(ui.createsSmartMessageDraft, true);
    assert.equal(ui.sendsWhatsApp, false);
    assert.equal(ui.sendsTelegram, false);
    window.dispatchEvent(new window.CustomEvent("iaqar:operations-data", {
      detail: { authoritative: true, items: [ui] }
    }));
    document.getElementById("operationsShowCategories").click();
    document.querySelector("[data-ops-category=\"matched\"]").click();
    const list = document.getElementById("operationList");
    assert.ok(list.querySelectorAll(".ops-task-primary").length >= 1);
    assert.ok(list.textContent.includes("مراجعة المطابقة") || list.textContent.includes("مطابقة"));
    assert.equal(list.textContent.includes("مسودة واتساب"), false);
    assert.equal(list.textContent.includes("مسودة تيليجرام"), false);
    assert.equal(list.textContent.includes("تم التسليم"), false);
    assert.equal(list.innerHTML.includes("mat_"), false);
  } finally {
    shell.close();
  }
});

test("56-65. Phase 5 boundary guarantees and wiring", () => {
  const g = phase5BoundaryGuarantees();
  // Phase 7 supersedes messaging-draft flags; send remains forbidden.
  assert.equal(g.createsWhatsAppMessage, true);
  assert.equal(g.sendsWhatsApp, false);
  assert.equal(g.createsTelegramMessage, true);
  assert.equal(g.sendsTelegram, false);
  assert.equal(g.createsSmartMessageDraft, true);
  assert.equal(g.createsAutomaticCooperation, false);
  assert.equal(g.createsBrokerRecommendation, false);
  assert.equal(g.createsDeal, false);
  assert.equal(g.createsCommission, false);
  assert.equal(g.addsDealsPage, false);
  assert.equal(g.addsBottomNavigation, false);
  assert.deepEqual(clientBoundaries(), g);

  const worker = readRepositoryFile("worker", "src", "index.js");
  assert.ok(worker.includes("/operations/action"));
  assert.ok(worker.includes("/operations/from-cooperation"));
  assert.ok(worker.includes("/operations/missing-data"));
  assert.ok(worker.includes("createMatchReviewBundle"));
  assert.ok(!worker.includes("WHATSAPP_SENT"));
  assert.ok(!worker.includes("TELEGRAM_SENT"));

  const workflow = readRepositoryFile("public", "js", "workflow-office.js");
  assert.ok(workflow.includes('where("status", "in"'));
  assert.ok(workflow.includes("operationItems"));
  assert.equal(OPERATIONS_ACTION_PATH, "/operations/action");
});

test("client operation action request posts to Worker", async () => {
  const calls = [];
  const result = await requestOperationAction({
    workerBase: "https://example.test",
    idToken: "token",
    officeId: "office-a",
    operationId: "op_1",
    action: "START",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({ ok: true, status: "IN_PROGRESS" })
      };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "https://example.test/operations/action");
  assert.equal(JSON.parse(calls[0].init.body).action, "START");
});

test("cooperation dedup key includes status version", () => {
  const pending = buildCooperationDedupKey({
    type: OPERATION_TYPES.COOPERATION_REQUEST,
    officeId: "t",
    cooperationId: "c1",
    status: "PENDING"
  });
  const accepted = buildCooperationDedupKey({
    type: OPERATION_TYPES.COOPERATION_RESPONSE,
    officeId: "o",
    cooperationId: "c1",
    status: "ACCEPTED"
  });
  assert.notEqual(pending, accepted);
});

test("Firestore rules restrict operations and notifications collections", () => {
  const rules = readRepositoryFile("firestore.rules");
  assert.ok(rules.includes("'operations'"));
  assert.ok(rules.includes("'notifications'"));
  assert.ok(rules.includes("match /operations/{operationId}"));
  assert.ok(rules.includes("match /notifications/{notificationId}"));
  assert.match(rules, /match \/operations\/\{operationId\}[\s\S]*allow create, update, delete: if false/);
});

test("required operations indexes are documented in firestore.indexes.json", () => {
  const indexes = JSON.parse(readRepositoryFile("firestore.indexes.json"));
  const ops = indexes.indexes.filter((item) => item.collectionGroup === "operations");
  assert.ok(ops.length >= 1);
  assert.ok(ops.some((item) => item.fields.some((f) => f.fieldPath === "status")));
});

test("ownerContactNeeded resolves from nextActor when metadata is stale", () => {
  assert.equal(resolveOwnerContactNeeded(
    { livingStage: "WAITING_PROPERTY_CONFIRMATION", nextActor: "BROKER" },
    {}
  ), true);
  assert.equal(resolveOwnerContactNeeded(
    { livingStage: "WAITING_PROPERTY_CONFIRMATION", nextActor: "OWNER" },
    {}
  ), false);
  assert.equal(projectOperationToUiItem({
    id: "op_1",
    type: OPERATION_TYPES.MATCH_REVIEW,
    livingStage: "WAITING_PROPERTY_CONFIRMATION",
    nextActor: "BROKER"
  }).ownerContactNeeded, true);
});
