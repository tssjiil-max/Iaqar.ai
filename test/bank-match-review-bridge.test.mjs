import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  bankInboxStatusLine,
  bankOperationalNavigationDetail,
  installBankOperationalActionBridge,
  installLegacyOpportunityWorkflowRetirement
} from "../public/js/bank-inbox-card-ui.js";

test("matched opportunity status line replaces pending-matching copy", () => {
  const line = bankInboxStatusLine({}, {
    action: { category: "matches", badge: "تطابق جديد", matchCount: 2 }
  }, {});
  assert.equal(line, "تطابق جديد — 2");
  assert.doesNotMatch(line, /قيد المطابقة/);
});

test("review_match opens the source opportunity detail and never enters legacy workflow overlay", async () => {
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
  let openedOpportunityId = "";
  let legacyBubbleHandlerRan = false;
  window.IAQAR = {
    homeTabs: { switchTo(tab) { switchedTo = tab; } },
    async openOpportunityDetail(id) { openedOpportunityId = id; }
  };
  window.addEventListener("iaqar:open-operation", (event) => { openedOperation = event.detail; });
  window.addEventListener("iaqar:workflow-action", (event) => { workflowDetail = event.detail; });
  window.document.getElementById("bank").addEventListener("click", () => { legacyBubbleHandlerRan = true; });
  assert.equal(installBankOperationalActionBridge(window.document, window), true);

  const button = window.document.querySelector("button");
  assert.equal(bankOperationalNavigationDetail(button).actionCode, "review_match");
  button.click();
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  assert.equal(openedOpportunityId, "request-1");
  assert.equal(workflowDetail, null);
  assert.equal(openedOperation, null);
  assert.equal(switchedTo, "");
  assert.equal(legacyBubbleHandlerRan, false);
});

test("all bank operational actions open the source opportunity instead of the retired opportunity manager", async () => {
  for (const actionCode of ["record_viewing_result", "view_appointment", "open_follow_up", "view_waiting", "open_negotiation"]) {
    const dom = new JSDOM(`
      <main id="bank">
        <article data-cv2-inbox-item data-opportunity-id="request-1">
          <button data-opportunity-primary-action="${actionCode}" data-operation-id="operation-1" data-match-id="match-1"></button>
        </article>
      </main>
    `, { url: "https://staging.example/" });
    const { window } = dom;
    let switchedTo = "";
    let openedOperation = null;
    let openedOpportunityId = "";
    let legacyBubbleHandlerRan = false;
    window.IAQAR = {
      homeTabs: { switchTo(tab) { switchedTo = tab; } },
      async openOpportunityDetail(id) { openedOpportunityId = id; }
    };
    window.addEventListener("iaqar:open-operation", (event) => { openedOperation = event.detail; });
    window.document.getElementById("bank").addEventListener("click", () => { legacyBubbleHandlerRan = true; });
    assert.equal(installBankOperationalActionBridge(window.document, window), true);

    window.document.querySelector("button").click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    assert.equal(openedOpportunityId, "request-1", actionCode);
    assert.equal(openedOperation, null, actionCode);
    assert.equal(switchedTo, "", actionCode);
    assert.equal(legacyBubbleHandlerRan, false, actionCode);
  }
});

test("legacy match workflow event is intercepted and redirected to its linked opportunity", async () => {
  const dom = new JSDOM(`<div id="toast"></div>`, { url: "https://staging.example/" });
  const { window } = dom;
  let openedOpportunityId = "";
  let legacyHandlerRan = false;
  window.IAQAR = {
    async openOpportunityDetail(id) { openedOpportunityId = id; }
  };
  assert.equal(installLegacyOpportunityWorkflowRetirement(window.document, window), true);
  window.addEventListener("iaqar:workflow-action", () => { legacyHandlerRan = true; });

  window.dispatchEvent(new window.CustomEvent("iaqar:workflow-action", {
    detail: {
      recordType: "match",
      matchId: "match-1",
      clientRequestId: "request-1",
      ownerOfferId: "offer-1"
    }
  }));
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  assert.equal(openedOpportunityId, "request-1");
  assert.equal(legacyHandlerRan, false);
});
