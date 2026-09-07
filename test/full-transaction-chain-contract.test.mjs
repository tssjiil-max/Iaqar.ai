import test from "node:test";
import assert from "node:assert/strict";

import { evaluateCompletionSubmission } from "../public/js/data-completion-domain.js";
import { evaluateMatchingAdmission } from "../worker/src/matching-admission-domain.js";
import { counterpartsEligible } from "../worker/src/matching-engine.js";
import {
  POST_MATCH_EVENT,
  planPostMatchTransition,
  resolvePostMatchStage,
  POST_MATCH_STAGE,
  validateDealTransition
} from "../worker/src/post-match-chain-domain.js";
import { cooperationModeAllowsExplicitRequest, assertOwnershipPreserved } from "../worker/src/cooperation-phase6-domain.js";
import { buildArabicMessageBody, TEMPLATE_CODES } from "../worker/src/messaging-domain.js";

function incompleteRequest() {
  return {
    opportunityKind: "REQUEST",
    purpose: "PURCHASE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العزيزية",
    priceOrBudget: 650000,
    advertiserRole: "CLIENT",
    contactPhone: "",
    lifecycleStatus: "ACTIVE",
    originatingOfficeId: "office-client"
  };
}

function offer() {
  return {
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العزيزية",
    priceOrBudget: 640000,
    advertiserRole: "OWNER",
    contactPhone: "0551111111",
    lifecycleStatus: "ACTIVE",
    originatingOfficeId: "office-owner"
  };
}

test("full chain blocks incomplete intake, admits after completion, then progresses deterministically", () => {
  const raw = incompleteRequest();
  assert.equal(evaluateMatchingAdmission(raw).isReadyForMatching, false);

  const completed = evaluateCompletionSubmission(
    raw,
    { contactPhone: "0552222222" },
    ["contactPhone"]
  );
  assert.equal(completed.isComplete, true);
  assert.equal(completed.isReadyForMatching, true);
  assert.equal(evaluateMatchingAdmission(completed.opportunity).isReadyForMatching, true);
  assert.equal(counterpartsEligible(completed.opportunity, offer()), true);

  const coordinationPlan = planPostMatchTransition({
    event: POST_MATCH_EVENT.COORDINATION_UPDATED,
    coordination: { outcome: "PRICE_NEGOTIATION" }
  });
  assert.equal(coordinationPlan.ok, true);
  assert.equal(coordinationPlan.createsDeal, false);
  assert.equal(
    resolvePostMatchStage({ coordination: { outcome: "PRICE_NEGOTIATION" } }),
    POST_MATCH_STAGE.NEGOTIATION
  );

  const viewing = planPostMatchTransition({
    event: POST_MATCH_EVENT.VIEWING_CONFIRMED,
    payload: { appointmentAt: "2026-09-10T18:00:00+03:00" }
  });
  assert.equal(viewing.ok, true);
  assert.equal(viewing.createsDeal, false);

  const deal = planPostMatchTransition({
    event: POST_MATCH_EVENT.DEAL_CREATED,
    match: {
      appointmentStatus: "CONFIRMED",
      appointmentAt: "2026-09-10T18:00:00+03:00"
    }
  });
  assert.equal(deal.ok, true);
  assert.equal(deal.createsDeal, true);

  assert.equal(validateDealTransition("negotiation", "agreement").ok, true);
  assert.equal(validateDealTransition("agreement", "closing").ok, true);
  assert.equal(validateDealTransition("closing", "closed").ok, true);
});

test("cooperation preserves original ownership while allowing explicit broker-to-broker cooperation", () => {
  assert.equal(cooperationModeAllowsExplicitRequest("APPROVAL_REQUIRED"), true);
  const before = {
    id: "opp_offer_1",
    officeId: "office-owner",
    originatingOfficeId: "office-owner",
    currentOwningOfficeId: "office-owner",
    brokerId: "broker-owner"
  };
  const projection = { ...before, sharedWithOfficeId: "office-client" };
  assert.equal(assertOwnershipPreserved(before, projection).ok, true);
});

test("WhatsApp message is a handoff notification, not negotiation state", () => {
  const body = buildArabicMessageBody({
    templateCode: TEMPLATE_CODES.MATCH_OWNER,
    officeName: "مكتب تجريبي",
    propertyType: "شقة",
    district: "العزيزية"
  });
  assert.match(body, /يوجد عميل مهتم/);
  assert.doesNotMatch(body, /تم قبول الصفقة|تم إغلاق الصفقة/);
});
