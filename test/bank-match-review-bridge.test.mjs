import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  bankInboxStatusLine,
  bankOperationalNavigationDetail,
  installBankOperationalActionBridge
} from "../public/js/bank-inbox-card-ui.js";

test("matched opportunity status line replaces pending-matching copy", () => {
  const line = bankInboxStatusLine({}, {
    action: { category: "matches", badge: "تطابق جديد", matchCount: 2 }
  }, {});
  assert.equal(line, "تطابق جديد — 2");
  assert.doesNotMatch(line, /قيد المطابقة/);
});

test("review_match opens the exact match directly without resolving through a possibly stale operation", () => {
  const dom = new JSDOM(`
    <main id="bank">
      <article data-cv2-inbox-item data-opportunity-id="request-1">
        <button data-opportunity-primary-action="review_match" data-operation-id="operation-1" data-match-id="match-1"></button>
      </article>
    </main>
  `, { url: "https://staging.example/" });
  const { window } = dom;
  let switchedTo = "";
  let openedOperation = null;
  let workflowDetail = null;
  let legacyBubbleHandlerRan = false;
  window.IAQAR = { homeTabs: { switchTo(tab) { switchedTo = tab; } } };
  window.addEventListener("iaqar:open-operation", (event) => { openedOperation = event.detail; });
  window.addEventListener("iaqar:workflow-action", (event) => { workflowDetail = event.detail; });
  window.document.getElementById("bank").addEventListener("click", () => { legacyBubbleHandlerRan = true; });
  assert.equal(installBankOperationalActionBridge(window.document, window), true);

  const button = window.document.querySelector("button");
  assert.equal(bankOperationalNavigationDetail(button).actionCode, "review_match");
  button.click();

  assert.equal(switchedTo, "");
  assert.equal(openedOperation, null);
  assert.equal(workflowDetail.id, "match-1");
  assert.equal(workflowDetail.recordId, "match-1");
  assert.equal(workflowDetail.recordType, "match");
  assert.equal(workflowDetail.matchId, "match-1");
  assert.equal(workflowDetail.operationId, "operation-1");
  assert.equal(workflowDetail.opportunityId, "request-1");
  assert.equal(workflowDetail.actionMode, "primary");
  assert.equal(workflowDetail.returnTarget, "bank_matches");
  assert.equal(legacyBubbleHandlerRan, false);
});

test("negotiation still opens its exact living task without legacy bubbling", () => {
  const dom = new JSDOM(`
    <main id="bank">
      <article data-cv2-inbox-item data-opportunity-id="request-1">
        <button data-opportunity-primary-action="open_negotiation" data-operation-id="operation-1" data-match-id="match-1"></button>
      </article>
    </main>
  `, { url: "https://staging.example/" });
  const { window } = dom;
  let switchedTo = "";
  let openedDetail = null;
  let legacyBubbleHandlerRan = false;
  window.IAQAR = { homeTabs: { switchTo(tab) { switchedTo = tab; } } };
  window.addEventListener("iaqar:open-operation", (event) => { openedDetail = event.detail; });
  window.document.getElementById("bank").addEventListener("click", () => { legacyBubbleHandlerRan = true; });
  assert.equal(installBankOperationalActionBridge(window.document, window), true);

  const button = window.document.querySelector("button");
  assert.equal(bankOperationalNavigationDetail(button).actionCode, "open_negotiation");
  button.click();

  assert.equal(switchedTo, "operations");
  assert.equal(openedDetail.id, "operation-1");
  assert.equal(openedDetail.matchId, "match-1");
  assert.equal(openedDetail.operationId, "operation-1");
  assert.equal(openedDetail.returnTarget, "bank_matches");
  assert.equal(window.IAQAR.pendingDailyTaskOpen.id, "operation-1");
  assert.equal(window.IAQAR.pendingDailyTaskOpen.actionCode, "open_negotiation");
  assert.equal(window.IAQAR.pendingDailyTaskOpen.returnTarget, "bank_matches");
  assert.equal(legacyBubbleHandlerRan, false);
});
