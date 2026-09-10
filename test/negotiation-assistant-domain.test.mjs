import test from "node:test";
import assert from "node:assert/strict";
import { buildNegotiationAssistant, POST_VIEWING_CHOICES } from "../public/js/v2/daily-tasks/negotiation-assistant-domain.js";

test("derives price gap without mutating negotiation", () => {
  const task = { livingStage: "PROPERTY_AVAILABLE", coordinationClientSummary: "أقل 5%", coordinationOwnerSummary: "2%" };
  const before = JSON.stringify(task);
  const vm = buildNegotiationAssistant(task);
  assert.equal(vm.priceGapPct, 3);
  assert.equal(vm.interventionRequired, true);
  assert.match(vm.interventionLine, /3%/);
  assert.equal(JSON.stringify(task), before);
});

test("schedule conflict requests broker intervention", () => {
  const vm = buildNegotiationAssistant({ livingStage: "APPOINTMENT_COORDINATION", coordinationOutcome: "SCHEDULE_CONFLICT" });
  assert.equal(vm.currentStage, "viewing");
  assert.match(vm.smartSummary, /تعارض/);
  assert.match(vm.interventionLine, /نسّق موعدًا موحدًا/);
});

test("both serious moves broker to agreement action", () => {
  const vm = buildNegotiationAssistant({ livingStage: "FOLLOW_UP", coordinationClientSummary: "جدي ونكمل", coordinationOwnerSummary: "موافق نكمل" });
  assert.equal(vm.currentStage, "agreement");
  assert.equal(vm.interventionRequired, true);
  assert.match(vm.interventionLine, /اتفاق الوساطة\/الصفقة/);
});

test("owner approval alone does not advance negotiation to agreement", () => {
  const vm = buildNegotiationAssistant({ livingStage: "FOLLOW_UP", coordinationOwnerSummary: "موافق نكمل" });
  assert.equal(vm.currentStage, "viewing");
  assert.equal(vm.interventionRequired, false);
});

test("client seriousness alone does not advance negotiation to agreement", () => {
  const vm = buildNegotiationAssistant({ livingStage: "FOLLOW_UP", coordinationClientSummary: "جدي ونكمل" });
  assert.equal(vm.currentStage, "viewing");
  assert.equal(vm.interventionRequired, false);
});

test("post-viewing choices use approved wording", () => {
  assert.deepEqual(POST_VIEWING_CHOICES.client.map((x) => x.label), ["جدي ونكمل", "أحتاج تفاوض", "غير مهتم"]);
  assert.deepEqual(POST_VIEWING_CHOICES.owner.map((x) => x.label), ["موافق نكمل", "أحتاج تفاوض", "غير مهتم"]);
});
