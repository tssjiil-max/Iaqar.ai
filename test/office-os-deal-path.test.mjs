import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CLOSED_STEP, PATH_STEP_LABELS, closedDealModel, countTasksByStep, filterTasksByStep, parsePathStep, sortClosedDeals, taskPathStep
} from "../public/os/domain/task-domain.js";

const read = (file) => fs.readFileSync(new URL(`../public/os/${file}`, import.meta.url), "utf8");

test("the deal path keeps the approved six stages in order", () => {
  assert.deepEqual([...PATH_STEP_LABELS], ["تطابق", "تواصل", "تفاوض", "معاينة", "مستندات", "إغلاق"]);
  assert.equal(CLOSED_STEP, 5);
  const layout = read("views/reference-layout.js");
  let cursor = -1;
  for (const label of PATH_STEP_LABELS) {
    const next = layout.indexOf(`["${label}"`, cursor + 1);
    assert.ok(next > cursor, `stage ${label} is on the strip, in order`);
    cursor = next;
  }
});

test("every open task belongs to exactly one stage", () => {
  assert.equal(taskPathStep({ type: "MATCH_REVIEW" }), 0);
  assert.equal(taskPathStep({ type: "AWAITING_REPLY" }), 1);
  assert.equal(taskPathStep({ type: "SEND_PROPOSAL" }), 2);
  assert.equal(taskPathStep({ type: "SESSION_INTERVENTION" }), 2);
  assert.equal(taskPathStep({ type: "VIEWING_CONFIRM" }), 3);
  assert.equal(taskPathStep({ type: "SESSION_VIEWING_COUNTER" }), 3);
  assert.equal(taskPathStep({ type: "DEAL_ACTION" }), 4);
  assert.equal(taskPathStep({ type: "DEAL_JOURNEY", journeyStep: 3 }), 3, "a deal card follows its journey phase");
  assert.equal(taskPathStep({ type: "DEAL_JOURNEY", journeyStep: 4 }), 4);
  assert.equal(taskPathStep({ type: "DEAL_JOURNEY" }), 2, "a deal card without a step defaults to negotiation");
  assert.equal(taskPathStep({ type: "DEAL_JOURNEY", journeyStep: 99 }), 5);
  assert.equal(taskPathStep({}), 2);
});

test("counts and filtering by stage agree with each other", () => {
  const tasks = [
    { id: "a", type: "MATCH_REVIEW" }, { id: "b", type: "MATCH_REVIEW" }, { id: "c", type: "AWAITING_REPLY" },
    { id: "d", type: "DEAL_JOURNEY", journeyStep: 2 }, { id: "e", type: "VIEWING_RESULT" }, { id: "f", type: "DEAL_JOURNEY", journeyStep: 4 }
  ];
  const counts = countTasksByStep(tasks);
  assert.deepEqual(counts, [2, 1, 1, 1, 1]);
  for (let step = 0; step < CLOSED_STEP; step += 1) assert.equal(filterTasksByStep(tasks, step).length, counts[step], `stage ${step}`);
  assert.equal(filterTasksByStep(tasks, null).length, tasks.length, "no stage selected = everything");
  assert.deepEqual(filterTasksByStep(tasks, 0).map((t) => t.id), ["a", "b"]);
  assert.equal(counts.reduce((a, b) => a + b, 0), tasks.length, "no task is counted twice or lost");
});

test("stage route values are validated", () => {
  assert.equal(parsePathStep("0"), 0);
  assert.equal(parsePathStep("5"), 5);
  assert.equal(parsePathStep(3), 3);
  for (const bad of [null, undefined, "", "6", "-1", "1.5", "abc", "2x"]) assert.equal(parsePathStep(bad), null, String(bad));
});

test("closed deals: won and lost are told apart, newest first, with the real outcome only", () => {
  const won = closedDealModel({ journeyId: "jr_1", status: "CLOSED_WON", offerSummary: { propertyType: "فيلا", city: "الرياض", district: "النرجس" }, outcome: { finalPrice: 3000000, closedAt: "2026-10-01T10:00:00Z" } });
  assert.deepEqual([won.id, won.won, won.statusLabel, won.location, won.finalPrice, won.reason], ["jr_1", true, "تمت الصفقة", "الرياض - حي النرجس", 3000000, ""]);
  assert.ok(won.closedAt instanceof Date);
  const lost = closedDealModel({ id: "jr_2", status: "CLOSED_LOST", requestSummary: { propertyType: "شقة", district: "حي الملقا" }, outcome: { reason: "لم يتم الاتفاق على السعر" }, closedAt: "2026-09-01T10:00:00Z" });
  assert.deepEqual([lost.id, lost.won, lost.statusLabel, lost.location, lost.finalPrice, lost.reason], ["jr_2", false, "أُغلقت دون صفقة", "حي الملقا", 0, "لم يتم الاتفاق على السعر"]);
  assert.equal(closedDealModel({}).propertyType, "عقار");
  const sorted = sortClosedDeals([{ id: "old", closedAt: "2026-01-01T00:00:00Z" }, { id: "new", outcome: { closedAt: "2026-10-01T00:00:00Z" } }, { id: "none" }]);
  assert.deepEqual(sorted.map((j) => j.id), ["new", "old", "none"]);
});

test("the strip is interactive: six buttons, a count badge, and the tasks page reads ?step=", () => {
  const layout = read("views/reference-layout.js");
  assert.match(layout, /class: "ref-step"/, "stages are buttons");
  assert.match(layout, /"aria-pressed": String\(selected\)/);
  assert.match(layout, /ref-step-count/);
  const tasks = read("views/tasks.js");
  assert.match(tasks, /parsePathStep\(step\)/);
  assert.match(tasks, /listClosedJourneys\(session\.officeId\)/, "«إغلاق» lists the office's own closed deals");
  assert.match(read("app.js"), /step: query\.get\("step"\)/);
  assert.match(read("core/live.js"), /where\("status", "in", \["CLOSED_WON", "CLOSED_LOST"\]\)/);
});
