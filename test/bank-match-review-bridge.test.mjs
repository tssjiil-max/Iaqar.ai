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

test("review and negotiation actions open the exact living task without legacy bubbling", () => {
  const dom = new JSDOM(`
    <main id="bank">
      <article data-cv2-inbox-item data-opportunity-id="request-1">
        <button data-opportunity-primary-action="review_match" data-operation-id="operation-1" data-match-id="match-1"></button>
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

  const buttons = window.document.querySelectorAll("button");
  assert.equal(bankOperationalNavigationDetail(buttons[0]).actionCode, "review_match");
  assert.equal(bankOperationalNavigationDetail(buttons[1]).actionCode, "open_negotiation");
  buttons[1].click();

  assert.equal(switchedTo, "operations");
  assert.equal(openedDetail.id, "operation-1");
  assert.equal(openedDetail.matchId, "match-1");
  assert.equal(openedDetail.operationId, "operation-1");
  assert.equal(window.IAQAR.pendingDailyTaskOpen.id, "operation-1");
  assert.equal(window.IAQAR.pendingDailyTaskOpen.actionCode, "open_negotiation");
  assert.equal(legacyBubbleHandlerRan, false);
});
