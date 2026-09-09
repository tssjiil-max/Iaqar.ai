import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  brokerNegotiationActions,
  negotiationAgreementSummary,
  negotiationManagementBoundaryGuarantees,
  negotiationPropertyFacts
} from "../public/js/negotiation-management-domain.js";
import { sanitizePartyPublicView } from "../public/js/party-session-domain.js";
import { buildPartyShellHtml } from "../public/js/party-shell-ui.js";
import { evaluateDealCreation, planDealClosure, planDealStageTransition } from "../worker/src/deal-contract-domain.js";

test("property information is type-aware, hides empty facts, and never requires area", () => {
  const land = negotiationPropertyFacts({ propertyType: "أرض", district: "عروة", facade: "شمالية", usage: "سكني", priceLabel: "500,000 ر.س" });
  assert.deepEqual(land.map((row) => row.label), ["نوع العقار", "الموقع", "السعر", "الواجهة", "نوع الاستخدام"]);
  assert.equal(land.some((row) => row.label === "المساحة"), false);
  const apartment = negotiationPropertyFacts({ propertyType: "شقة", rooms: 4, bathrooms: 3, elevator: "يوجد" });
  assert.ok(apartment.some((row) => row.label === "الغرف"));
  assert.ok(apartment.some((row) => row.label === "المصعد"));
  const villa = negotiationPropertyFacts({ propertyType: "فيلا", rooms: 6, floors: 2, propertyAge: 5 });
  assert.ok(villa.some((row) => row.label === "الأدوار"));
  assert.ok(villa.some((row) => row.label === "العمر"));
  assert.equal(negotiationManagementBoundaryGuarantees().areaRequired, false);
});

test("agreement summary follows the latest party state", () => {
  const summary = negotiationAgreementSummary({
    coordination: {
      outcome: "PRICE_ALIGNED",
      clientBundle: { negotiationResponse: "accept", requestedDetailKeys: ["rooms"] },
      ownerBundle: { propertyAvailability: "available", negotiationDecision: "accept", detailConfirmations: ["rooms"] }
    },
    appointment: { phase: "confirmed" }
  });
  assert.equal(summary.find((row) => row.id === "availability").key, "agreed");
  assert.equal(summary.find((row) => row.id === "price").key, "agreed");
  assert.equal(summary.find((row) => row.id === "viewing").key, "agreed");
});

test("party shell is mobile-ordered: property, agreement, negotiation; no contact is exposed", () => {
  const view = sanitizePartyPublicView({
    party: "client",
    snapshot: { propertyType: "شقة", district: "عروة", rooms: 3 },
    coordination: { id: "match-1", matchId: "match-1", clientBundle: null, ownerBundle: null, brokerNotes: [{ audience: "client", message: "راجع الموعد" }] },
    matchRecord: {}
  });
  const html = buildPartyShellHtml(view);
  const property = html.indexOf("معلومات العقار");
  const agreement = html.indexOf("ما تم الاتفاق عليه");
  const negotiation = html.indexOf(">التفاوض<");
  assert.ok(property >= 0 && property < agreement && agreement < negotiation);
  assert.match(html, /ملاحظات الوسيط/);
  assert.doesNotMatch(JSON.stringify(view), /055\d{7}|\+966/);
});

test("broker controls have contextual actions and persist note/audience wiring", () => {
  assert.ok(brokerNegotiationActions({ stage: "viewing" }).includes("تمت المعاينة"));
  const card = readFileSync(new URL("../src/v2/content/daily-tasks/card.js", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../src/v2/content/daily-tasks/controller.js", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");
  assert.match(card, /data-broker-action="note"/);
  assert.match(card, /data-broker-audience/);
  assert.match(controller, /add_negotiation_note/);
  assert.match(worker, /brokerNotes/);
  assert.match(worker, /BROKER_NOTE/);
});

test("viewing does not close, seriousness gates Deal, and stages cannot be skipped", () => {
  assert.equal(evaluateDealCreation({ match: { livingStage: "VIEWING_COMPLETED" } }).allowed, false);
  assert.equal(evaluateDealCreation({ match: { livingStage: "VIEWING_COMPLETED", seriousIntentConfirmed: true } }).allowed, true);
  assert.equal(planDealStageTransition({ deal: { workflowStage: "negotiation" }, requestedStage: "closing" }).reason, "skipped_stage");
  assert.equal(planDealStageTransition({ deal: { workflowStage: "agreement", brokerageContractStatus: "not_started" }, requestedStage: "closing" }).reason, "brokerage_contract_required");
  assert.equal(planDealClosure({ deal: { workflowStage: "agreement", brokerageContractStatus: "signed" } }).reason, "deal_not_ready_to_close");
});

test("no agreement closes only the match and keeps both opportunities available", () => {
  const worker = readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");
  const start = worker.indexOf('if(action==="close_match")');
  const end = worker.indexOf('if(action==="create_deal")', start);
  const block = worker.slice(start, end);
  assert.match(block, /status:firestoreString\("closed"\)/);
  assert.match(block, /lifecycleStatus:firestoreString\("ACTIVE"\)/);
  assert.match(block, /matchingReadiness:firestoreString\("READY_FOR_MATCHING"\)/);
  assert.doesNotMatch(block, /deleteFirestore|removeFirestore/);
});
