/**
 * Regression: matchOperation must forward coordination stamps to the Daily Tasks feed.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readRepositoryFile } from "./helpers/shell.mjs";
import { mapOperationsItemsToDailyTasks } from "../public/js/v2/daily-tasks/domain.js";

const workflowSource = readRepositoryFile("public", "js", "workflow-office.js");

test("matchOperation forwards coordination fields unchanged to feed items", () => {
  const block = workflowSource.slice(
    workflowSource.indexOf("function matchOperation(doc)"),
    workflowSource.indexOf("function dealOperation(doc)")
  );
  assert.match(block, /coordinationBrokerLine:\s*item\.coordinationBrokerLine/);
  assert.match(block, /coordinationClientSummary:\s*item\.coordinationClientSummary/);
  assert.match(block, /coordinationOwnerSummary:\s*item\.coordinationOwnerSummary/);
  assert.match(block, /coordinationOutcome:\s*item\.coordinationOutcome/);
});

test("daily task nextActionLine uses coordinationBrokerLine from match feed item", () => {
  const matchId = "mat_broker_sync_test";
  const requestId = "opp_request_broker_sync";
  const brokerLine = "العميل: موافق مبدئيًا · المالك: العقار متاح · جاهز لتنسيق المعاينة";
  const clientSummary = "موافق مبدئيًا — يريد معاينة غدًا مساءً";
  const ownerSummary = "العقار متاح — أكد السعر";
  const item = {
    id: matchId,
    recordId: matchId,
    recordType: "match",
    matchId,
    clientRequestId: requestId,
    ownerOfferId: "opp_offer_broker_sync",
    livingStage: "APPOINTMENT_COORDINATION",
    coordinationOutcome: "VIEWING_READY",
    coordinationBrokerLine: brokerLine,
    coordinationClientSummary: clientSummary,
    coordinationOwnerSummary: ownerSummary,
    livingTimeline: [],
    propertyType: "شقة",
    district: "السلام",
    city: "المدينة المنورة",
    candidatePropertyType: "شقة",
    candidateDistrict: "السلام",
    candidateCity: "المدينة المنورة",
    candidateSalePrice: 12500,
    candidatePurpose: "RENT",
    clientPhone: "0500000001",
    ownerPhone: "0500000002",
    score: 93,
    status: "open"
  };
  const tasks = mapOperationsItemsToDailyTasks([item], new Date(), { officeId: "2" });
  const task = tasks.find((row) => row.matchId === matchId) || tasks[0];
  assert.ok(task, "expected living daily task for match feed item");
  assert.equal(task.nextActionLine, brokerLine);
  assert.equal(task.livingStage, "APPOINTMENT_COORDINATION");
});
