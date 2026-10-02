import test from "node:test";
import assert from "node:assert/strict";
import { cardActions, communitySummary, communityViews, directActionFor } from "../public/os/domain/community-domain.js";
import { cooperationNeedsMyAction, visibleToActor } from "../public/os/domain/task-domain.js";
import { COOPERATION_STAGE, buildCooperationDailyTaskView, livingCooperationTaskId } from "../public/js/cooperation-workflow-domain.js";

const ME = "office-a";
const row = (over) => ({
  id: "coop-1", originatingOfficeId: "office-b", originatingOfficeName: "مكتب الأفق", targetOfficeId: ME, targetOfficeName: "مكتبي",
  propertyOfficeId: "office-b", clientOfficeId: ME,
  status: "PENDING", currentStage: "WAITING_PARTNER", originListing: { propertyType: "شقة", purpose: "sale", district: "الوبرة", priceOrBudget: 900000 },
  updatedAt: "2026-10-01T10:00:00.000Z", ...over
});

test("an incoming request waits for my answer and offers accept / not suitable", () => {
  const tabs = communityViews([row()], ME);
  assert.equal(tabs.waiting.length, 1);
  assert.equal(tabs.waiting[0].requiresAction, true);
  const a = cardActions(tabs.waiting[0]);
  assert.equal(a.primary.action, "ACCEPT");
  assert.equal(a.secondary[0].action, "REJECT");
});

test("a suggested match offers «طلب التعاون» to the office that reviewed it", () => {
  const tabs = communityViews([row({ originatingOfficeId: ME, targetOfficeId: "office-b", status: "SUGGESTED", currentStage: COOPERATION_STAGE.MATCH_FOUND, propertyOfficeId: ME, clientOfficeId: "office-b" })], ME);
  assert.equal(cardActions(tabs.waiting[0]).primary.action, "REQUEST");
});

test("my own outgoing request waits for the other office and has no buttons", () => {
  const tabs = communityViews([row({ originatingOfficeId: ME, targetOfficeId: "office-b", originatingOfficeName: "مكتبي", targetOfficeName: "مكتب الأفق" })], ME);
  assert.equal(tabs.waiting.length, 1);
  assert.equal(tabs.waiting[0].requiresAction, false);
  assert.equal(cardActions(tabs.waiting[0]).primary, null);
});

test("accepted cooperation is نشط; finished or declined goes to السجل; duplicates merge", () => {
  const tabs = communityViews([
    row({ id: "a", status: "ACCEPTED", currentStage: "CUSTOMER_ACTION" }),
    row({ id: "b", status: "ACCEPTED", currentStage: "COMPLETED" }),
    row({ id: "c", status: "REJECTED", currentStage: "REJECTED" }),
    row({ id: "c", status: "REJECTED", currentStage: "REJECTED" })
  ], ME);
  assert.deepEqual([tabs.active.length, tabs.waiting.length, tabs.history.length], [1, 0, 2]);
  assert.equal(communitySummary(tabs), "1 نشط");
});

test("steps owned by the negotiation / viewing / deal are handed off, not faked", () => {
  assert.equal(directActionFor({ id: "follow_customer", label: "متابعة العميل" }), null);
  assert.equal(directActionFor({ id: "confirm_completion", label: "تأكيد إتمام الصفقة" }), null);
  assert.equal(directActionFor({ id: "confirm_appointment", label: "تأكيد الموعد" }), null);
  const tabs = communityViews([row({ status: "ACCEPTED", currentStage: "CUSTOMER_ACTION", clientOfficeId: ME })], ME);
  assert.equal(cardActions(tabs.active[0]).followUp, true);
});

test("the cooperation task keeps one identity across stages", () => {
  const ids = Object.values(COOPERATION_STAGE).map((stage) => buildCooperationDailyTaskView(row({ currentStage: stage }), { officeId: ME }).id);
  assert.equal(new Set(ids).size, 1);
  assert.equal(ids[0], livingCooperationTaskId("coop-1"));
});

test("Daily Tasks shows a cooperation task only when I have something to do", () => {
  const task = (over) => ({ id: "t", type: "COOPERATION_MATCH", status: "OPEN", metadata: { cooperationTaskId: "coop-1", originatingOfficeId: "office-b", targetOfficeId: ME, clientOfficeId: ME, propertyOfficeId: "office-b", ...over } });
  const incoming = task({ currentStage: "WAITING_PARTNER", status: "PENDING" });
  assert.equal(cooperationNeedsMyAction(incoming, ME), true);
  assert.equal(visibleToActor(incoming, { uid: "u", isManager: true, officeId: ME }), true);
  const waiting = task({ originatingOfficeId: ME, targetOfficeId: "office-b", currentStage: "WAITING_PARTNER", status: "PENDING" });
  assert.equal(cooperationNeedsMyAction(waiting, ME), false);
  assert.equal(visibleToActor(waiting, { uid: "u", isManager: true, officeId: ME }), false);
  assert.equal(visibleToActor({ id: "x", type: "MATCH_REVIEW" }, { uid: "u", isManager: false, officeId: ME }), true, "other task types are untouched");
  assert.equal(cooperationNeedsMyAction({ id: "y", type: "COOPERATION_MATCH", metadata: {} }, ME), true, "unknown facts are never hidden");
});
