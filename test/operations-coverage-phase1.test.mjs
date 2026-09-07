import test from "node:test";
import assert from "node:assert/strict";

import {
  OPERATION_TYPES,
  projectOperationToUiItem,
  sortActiveOperations
} from "../public/js/operations-domain.js";

test("Phase 1 exposes the three coverage operation contracts", () => {
  assert.equal(OPERATION_TYPES.OPPORTUNITY_REVIEW, "OPPORTUNITY_REVIEW");
  assert.equal(OPERATION_TYPES.OPPORTUNITY_FOLLOW_UP, "OPPORTUNITY_FOLLOW_UP");
  assert.equal(OPERATION_TYPES.DEAL_ACTION, "DEAL_ACTION");
});

test("OPPORTUNITY_REVIEW projects as an operation-owned daily task", () => {
  const item = projectOperationToUiItem({
    id: "op_review_1",
    type: OPERATION_TYPES.OPPORTUNITY_REVIEW,
    status: "OPEN",
    priority: "HIGH",
    opportunityId: "opp_1",
    sourceEntityType: "opportunity",
    sourceEntityId: "opp_1",
    titleText: "عرض أو طلب جديد يحتاج مراجعة",
    summaryText: "راجع البيانات قبل الانتقال للمرحلة التالية.",
    recommendedActionText: "مراجعة العرض أو الطلب",
    createdAt: "2026-09-07T03:00:00.000Z"
  });

  assert.equal(item.recordType, "operation");
  assert.equal(item.operationType, "OPPORTUNITY_REVIEW");
  assert.equal(item.opportunityId, "opp_1");
  assert.equal(item.actionLabel, "مراجعة العرض أو الطلب");
});

test("OPPORTUNITY_FOLLOW_UP preserves the canonical follow-up due time", () => {
  const item = projectOperationToUiItem({
    id: "op_follow_1",
    type: OPERATION_TYPES.OPPORTUNITY_FOLLOW_UP,
    status: "OPEN",
    priority: "NORMAL",
    opportunityId: "opp_2",
    sourceEntityType: "opportunity",
    sourceEntityId: "opp_2",
    dueAt: "2026-09-07T14:00:00.000Z",
    metadataJson: JSON.stringify({ followUpAt: "2026-09-07T14:00:00.000Z" }),
    titleText: "متابعة مالك أو عميل",
    recommendedActionText: "فتح المتابعة",
    createdAt: "2026-09-07T03:00:00.000Z"
  });

  assert.equal(item.followUpAt, "2026-09-07T14:00:00.000Z");
  assert.equal(item.opportunityId, "opp_2");
});

test("DEAL_ACTION preserves deal identity and stage", () => {
  const item = projectOperationToUiItem({
    id: "op_deal_1",
    type: OPERATION_TYPES.DEAL_ACTION,
    status: "OPEN",
    priority: "HIGH",
    sourceEntityType: "deal",
    sourceEntityId: "deal_77",
    currentStage: "closing",
    metadataJson: JSON.stringify({ dealId: "deal_77", dealStage: "closing" }),
    titleText: "إجراء مطلوب على الصفقة",
    recommendedActionText: "فتح الصفقة",
    createdAt: "2026-09-07T03:00:00.000Z"
  });

  assert.equal(item.dealId, "deal_77");
  assert.equal(item.currentStage, "closing");
  assert.equal(item.operationType, "DEAL_ACTION");
});

test("operation ordering remains priority-first for shadow comparison", () => {
  const sorted = sortActiveOperations([
    { id: "normal", priority: 2, createdAt: "2026-09-07T05:00:00.000Z" },
    { id: "urgent", priority: 0, createdAt: "2026-09-07T04:00:00.000Z" },
    { id: "high", priority: 1, createdAt: "2026-09-07T06:00:00.000Z" }
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ["urgent", "high", "normal"]);
});
