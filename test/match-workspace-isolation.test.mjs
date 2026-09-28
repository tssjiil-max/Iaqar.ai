import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Match workspace (Bank review_match CTA) shares the Daily Tasks controller.
// Regressions covered:
//  1. Content V2 re-renders (hashchange / navigation-changed / firebase-status call
//     unmount + mount) must not empty an open workspace.
//  2. Closing the workspace restores the main Daily Tasks list it displaced.
//  3. Browser back closes the workspace; closing it pops its history entry.
//  4. A match with no operation item does not spin forever.

function opportunity(id, type) {
  return { id, recordType: "opportunity", opportunityId: id, opportunityType: type, type,
    propertyType: "أرض", purpose: "SALE", district: "عروة", city: "الرياض", status: "active" };
}

const ITEMS = [
  opportunity("r1", "request"), opportunity("o1", "offer"),
  opportunity("r2", "request"), opportunity("o2", "offer"),
  { id: "m1", recordType: "match", matchId: "m1", ownerOfferId: "o1", clientRequestId: "r1", propertyType: "أرض",
    purpose: "SALE", district: "عروة", salePrice: 1, status: "active", createdAt: "2026-08-24T09:21:00.000+03:00" },
  { id: "m2", recordType: "match", matchId: "m2", ownerOfferId: "o2", clientRequestId: "r2", propertyType: "شقة",
    purpose: "SALE", district: "النرجس", salePrice: 2, status: "active", createdAt: "2026-08-24T09:22:00.000+03:00" }
];

async function setup() {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM(`<!doctype html><html><body><div id="contentV2"></div></body></html>`, {
    url: "https://example.test/#/tasks",
    pretendToBeVisual: true
  });
  const { window } = dom;
  const previousCustomEvent = global.CustomEvent;
  global.window = window;
  global.document = window.document;
  global.CustomEvent = window.CustomEvent;
  window.IAQAR = { office: { officeId: "office-test" }, operationsItems: ITEMS };
  const controller = await import("../src/v2/content/daily-tasks/controller.js");
  const main = window.document.getElementById("contentV2");
  const snapshot = () => ({
    open: Boolean(window.document.querySelector(".cv2-match-workspace")),
    workspaceMatchIds: [...window.document.querySelectorAll(".cv2-match-workspace [data-cv2-exec-task]")]
      .map((node) => node.getAttribute("data-match-id")),
    workspaceText: String(window.document.querySelector("[data-match-workspace-content]")?.textContent || "").trim(),
    mainTasks: main.querySelectorAll("[data-cv2-exec-task]").length,
    overflow: window.document.body.style.overflow
  });
  const teardown = () => {
    controller.closeMatchWorkspace({ popHistory: false });
    controller.unmountDailyTasksContentV2();
    dom.window.close();
    delete global.window;
    delete global.document;
    global.CustomEvent = previousCustomEvent;
  };
  return { window, controller, main, snapshot, teardown };
}

test("Content V2 re-render keeps the open match workspace and close restores the main list", async () => {
  const { window, controller, main, snapshot, teardown } = await setup();
  try {
    controller.mountDailyTasksContentV2(main);
    assert.equal(snapshot().mainTasks, 2);

    assert.equal(controller.openMatchWorkspace("m2"), true);
    assert.deepEqual(snapshot().workspaceMatchIds, ["m2"]);
    assert.equal(snapshot().overflow, "hidden");

    // What mount.js does on hashchange / navigation-changed / firebase-status.
    controller.unmountDailyTasksContentV2();
    main.innerHTML = "";
    controller.mountDailyTasksContentV2(main);
    window.dispatchEvent(new window.CustomEvent("iaqar:operations-data", {
      detail: { officeId: "office-test", items: ITEMS }
    }));
    const during = snapshot();
    assert.equal(during.open, true);
    assert.deepEqual(during.workspaceMatchIds, ["m2"]);
    assert.equal(during.mainTasks, 0, "main list must not render filtered workspace data");

    window.history.back = mock.fn();
    window.document.querySelector("[data-close-match-workspace]")
      .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const after = snapshot();
    assert.equal(after.open, false);
    assert.equal(after.overflow, "");
    assert.equal(after.mainTasks, 2, "main Daily Tasks list is restored with all tasks");
    assert.equal(window.history.back.mock.callCount(), 1, "close pops the workspace history entry");
  } finally {
    teardown();
  }
});

test("browser back closes the match workspace without popping history twice", async () => {
  const { window, controller, main, snapshot, teardown } = await setup();
  try {
    controller.mountDailyTasksContentV2(main);
    controller.openMatchWorkspace("m1");
    assert.equal(window.history.state?.iaqarMatchWorkspace, 1);
    window.history.back = mock.fn();
    window.dispatchEvent(new window.PopStateEvent("popstate", { state: null }));
    assert.equal(snapshot().open, false);
    assert.equal(snapshot().mainTasks, 2);
    assert.equal(window.history.back.mock.callCount(), 0);
  } finally {
    teardown();
  }
});

test("match workspace stops the loading state when the match never arrives", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller, snapshot, teardown } = await setup();
  try {
    controller.openMatchWorkspace("missing_match");
    assert.match(snapshot().workspaceText, /جارٍ تحميل بيانات المطابقة/);
    t.mock.timers.tick(10000);
    assert.match(snapshot().workspaceText, /تعذر تحميل بيانات المطابقة/);
  } finally {
    teardown();
  }
});
