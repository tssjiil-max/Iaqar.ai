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
    action: {
      category: "matches",
      badge: "تطابق جديد",
      matchCount: 2
    }
  }, {});
  assert.equal(line, "تطابق جديد — 2");
  assert.doesNotMatch(line, /قيد المطابقة/);
});

test("review-match primary action opens the exact Daily Task instead of legacy opportunity management", () => {
  const dom = new JSDOM(`
    <main id="bank">
      <article data-cv2-inbox-item data-opportunity-id="request-1">
        <button
          type="button"
          data-opportunity-primary-action="review_match"
          data-operation-id="operation-1"
          data-match-id="match-1">مراجعة التطابق</button>
      </article>
    </main>
  `, { url: "https://staging.example/" });
  const { window } = dom;
  const { document } = window;
  let switchedTo = "";
  let openedDetail = null;
  let legacyBubbleHandlerRan = false;
  window.IAQAR = {
    homeTabs: {
      switchTo(tab) {
        switchedTo = tab;
      }
    }
  };
  window.addEventListener("iaqar:open-daily-task", (event) => {
    openedDetail = event.detail;
  });
  document.getElementById("bank").addEventListener("click", () => {
    legacyBubbleHandlerRan = true;
  });

  assert.equal(installBankOperationalActionBridge(document, window), true);
  const button = document.querySelector("[data-opportunity-primary-action='review_match']");
  assert.deepEqual(bankOperationalNavigationDetail(button), {
    opportunityId: "request-1",
    matchId: "match-1",
    operationId: "operation-1",
    actionCode: "review_match"
  });

  button.click();

  assert.equal(switchedTo, "operations");
  assert.deepEqual(window.IAQAR.pendingDailyTaskOpen, {
    opportunityId: "request-1",
    matchId: "match-1",
    operationId: "operation-1",
    actionCode: "review_match"
  });
  assert.deepEqual(openedDetail, window.IAQAR.pendingDailyTaskOpen);
  assert.equal(legacyBubbleHandlerRan, false);
});

test("appointment and viewing-result actions use the same Daily Task bridge", () => {
  const dom = new JSDOM(`
    <article data-cv2-inbox-item data-opportunity-id="offer-9">
      <button data-opportunity-primary-action="view_appointment" data-operation-id="op-9" data-match-id="match-9"></button>
      <button data-opportunity-primary-action="record_viewing_result" data-operation-id="op-9" data-match-id="match-9"></button>
    </article>
  `);
  const buttons = dom.window.document.querySelectorAll("button");
  assert.equal(bankOperationalNavigationDetail(buttons[0]).actionCode, "view_appointment");
  assert.equal(bankOperationalNavigationDetail(buttons[1]).actionCode, "record_viewing_result");
});
