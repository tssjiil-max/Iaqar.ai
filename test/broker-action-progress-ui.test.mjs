import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { applyBrokerActionMarks } from "../public/js/broker-action-progress-ui.js";

test("applyBrokerActionMarks shows one contact outcome checkmark for saved result", () => {
  const dom = new JSDOM(`
    <div id="root">
      <button class="bank-contact-outcome-btn" data-contact-outcome="REFUSED" data-broker-action="contact:outcome:REFUSED">غير مهتم</button>
      <button class="bank-contact-outcome-btn" data-contact-outcome="FOLLOW_UP" data-broker-action="contact:outcome:FOLLOW_UP">طلب متابعة</button>
    </div>
  `);
  const root = dom.window.document.getElementById("root");
  applyBrokerActionMarks(root, {
    lastContactOutcome: "REFUSED",
    brokerActionProgress: {
      "contact:outcome:REFUSED": "2026-08-18T12:00:00.000Z",
      "contact:outcome:FOLLOW_UP": "2026-08-18T13:00:00.000Z"
    }
  });
  const refused = root.querySelector('[data-contact-outcome="REFUSED"]');
  const followUp = root.querySelector('[data-contact-outcome="FOLLOW_UP"]');
  assert.equal(refused.classList.contains("is-action-done"), true);
  assert.equal(followUp.classList.contains("is-action-done"), false);
});

test("applyBrokerActionMarks hides saved checkmark while another outcome is pending", () => {
  const dom = new JSDOM(`
    <div id="root">
      <button class="bank-contact-outcome-btn is-selected" data-contact-outcome="FOLLOW_UP" data-broker-action="contact:outcome:FOLLOW_UP">طلب متابعة</button>
      <button class="bank-contact-outcome-btn" data-contact-outcome="REFUSED" data-broker-action="contact:outcome:REFUSED">غير مهتم</button>
    </div>
  `);
  const root = dom.window.document.getElementById("root");
  applyBrokerActionMarks(root, { lastContactOutcome: "REFUSED" });
  assert.equal(root.querySelector('[data-contact-outcome="REFUSED"]').classList.contains("is-action-done"), false);
  assert.equal(root.querySelector('[data-contact-outcome="FOLLOW_UP"]').classList.contains("is-selected"), true);
});

test("applyBrokerActionMarks toggles is-action-done on matching buttons", () => {
  const dom = new JSDOM(`
    <div id="root">
      <button class="iaqar-workflow-btn whatsapp" data-broker-action="followup:whatsapp:owner">واتساب المالك</button>
      <button class="iaqar-workflow-btn success" data-broker-action="followup:outcome:confirmed">تم التأكيد</button>
      <button class="iaqar-workflow-btn secondary" data-broker-action="followup:outcome:no_response">لم يرد</button>
    </div>
  `);
  const root = dom.window.document.getElementById("root");
  const record = {
    brokerActionProgress: {
      "followup:whatsapp:owner": "2026-08-18T12:00:00.000Z",
      "followup:outcome:confirmed": "2026-08-18T12:05:00.000Z"
    }
  };

  applyBrokerActionMarks(root, record);

  const ownerBtn = root.querySelector('[data-broker-action="followup:whatsapp:owner"]');
  const confirmedBtn = root.querySelector('[data-broker-action="followup:outcome:confirmed"]');
  const noResponseBtn = root.querySelector('[data-broker-action="followup:outcome:no_response"]');

  assert.equal(ownerBtn.classList.contains("is-action-done"), true);
  assert.equal(ownerBtn.getAttribute("aria-pressed"), "true");
  assert.equal(confirmedBtn.classList.contains("is-action-done"), true);
  assert.equal(noResponseBtn.classList.contains("is-action-done"), false);
});

test("applyBrokerActionMarks derives done state from followUp whatsapp roles", () => {
  const dom = new JSDOM(`
    <button data-broker-action="followup:whatsapp:client">واتساب العميل</button>
  `);
  const btn = dom.window.document.querySelector("button");
  applyBrokerActionMarks(dom.window.document.body, {
    followUp: {
      at: "2026-08-19T10:00:00.000Z",
      whatsappRolesOpened: ["client"]
    }
  });
  assert.equal(btn.classList.contains("is-action-done"), true);
});
