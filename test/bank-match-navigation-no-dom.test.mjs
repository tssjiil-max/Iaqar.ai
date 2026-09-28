import test from "node:test";
import assert from "node:assert/strict";
import { installBankOperationalActionBridge } from "../public/js/bank-inbox-card-ui.js";

test("matched bank action opens the match workspace before the opportunity detail", async () => {
  const handlers = new Map();
  const doc = {
    addEventListener(name, handler) { handlers.set(name, handler); },
    getElementById() { return null; },
    querySelector() { return null; }
  };
  const opened = [];
  const win = {
    addEventListener() {},
    IAQAR: {
      async openMatchWorkspace(id) { opened.push(["match", id]); },
      async openOpportunityDetail(id) { opened.push(["opportunity", id]); }
    }
  };
  installBankOperationalActionBridge(doc, win);
  const article = { getAttribute(name) { return name === "data-opportunity-id" ? "request-1" : ""; } };
  const button = {
    getAttribute(name) {
      return { "data-opportunity-primary-action": "review_match", "data-match-id": "match-1" }[name] || "";
    },
    closest(selector) {
      return selector.startsWith("[data-cv2-inbox-item]") ? article : button;
    }
  };
  let stopped = false;
  await handlers.get("click")({
    target: { closest() { return button; } },
    preventDefault() {},
    stopImmediatePropagation() { stopped = true; }
  });
  assert.equal(stopped, true);
  assert.deepEqual(opened, [["match", "match-1"]]);
});
