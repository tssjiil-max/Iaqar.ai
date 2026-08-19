/**
 * Prioritized daily task list — domain + shell wiring tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  TODAY_TASK_SECTIONS,
  todayTaskBucket,
  groupTodayTasks,
  flattenTodayTasks,
  todayTaskCount,
  resolveQuickActions,
  isTaskOverdue,
  isViewingToday,
  isViewingSoon,
  isNewReview,
  isReadyToClose,
  isAwaitingResponse,
  MAX_TODAY_TASKS
} from "../public/js/daily-tasks-domain.js";
import { loadShell, readRepositoryFile } from "./helpers/shell.mjs";

const shellSource = readRepositoryFile("public", "index.html");

test("five today task sections exist in priority order", () => {
  assert.equal(TODAY_TASK_SECTIONS.length, 5);
  assert.deepEqual(TODAY_TASK_SECTIONS.map((section) => section.key), [
    "new_review",
    "overdue",
    "viewing_soon",
    "ready_to_close",
    "awaiting_response"
  ]);
});

test("todayTaskBucket classifies new review and viewing soon", () => {
  const past = new Date(Date.now() - 3600000).toISOString();
  const inTwoHours = new Date(Date.now() + 2 * 3600000).toISOString();
  assert.equal(todayTaskBucket({
    recordType: "opportunity",
    lifecycleStatus: "NEW"
  }), "new_review");
  assert.equal(todayTaskBucket({
    nextFollowUpAt: past,
    viewingAt: inTwoHours,
    status: "active"
  }), "overdue");
  assert.equal(isViewingSoon({ viewingAt: inTwoHours, status: "viewing" }), true);
  assert.equal(isReadyToClose({ closingReadinessScore: 90, status: "active" }), true);
  assert.equal(isAwaitingResponse({ status: "waiting_response" }), true);
});

test("flattenTodayTasks caps visible tasks at five", () => {
  const items = Array.from({ length: 8 }, (_, index) => ({
    id: `new-${index}`,
    recordType: "opportunity",
    lifecycleStatus: "NEW",
    priority: 1,
    title: `طلب ${index}`
  }));
  const flat = flattenTodayTasks(items);
  assert.equal(flat.filter((row) => row.type === "task").length, 5);
});

test("groupTodayTasks and flattenTodayTasks preserve section order", () => {
  const past = new Date(Date.now() - 7200000).toISOString();
  const items = [
    { id: "wait", status: "waiting_response", priority: 2, title: "بانتظار" },
    { id: "late", nextFollowUpAt: past, status: "active", priority: 0, title: "متأخر" },
    { id: "close", closingReadinessScore: 88, status: "negotiation", priority: 1, title: "إغلاق" }
  ];
  const groups = groupTodayTasks(items);
  assert.equal(groups.overdue.length, 1);
  assert.equal(groups.awaiting_response.length, 1);
  assert.equal(groups.ready_to_close.length, 1);
  const flat = flattenTodayTasks(items);
  const sectionKeys = flat.filter((row) => row.type === "section").map((row) => row.key);
  assert.deepEqual(sectionKeys, ["overdue", "ready_to_close", "awaiting_response"]);
  assert.equal(todayTaskCount(items), 3);
});

test("resolveQuickActions offers call followup and schedule viewing", () => {
  const match = {
    id: "m1",
    recordType: "match",
    status: "active",
    priority: 0
  };
  const actions = resolveQuickActions(match, "awaiting_response");
  assert.ok(actions.some((action) => action.actionMode === "call"));
  assert.ok(actions.some((action) => action.actionMode === "followup"));
  assert.ok(actions.some((action) => action.actionMode === "schedule_viewing"));
});

test("shell defaults to today task list view", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document } = context;
    assert.equal(document.getElementById("opsViewTodayList").hidden, false);
    assert.equal(document.getElementById("opsViewCategories").hidden, true);
    assert.ok(document.getElementById("operationsShowCategories"));
    assert.ok(document.getElementById("operationsTodayList"));
  } finally {
    context.close();
  }
});

test("shell renders prioritized tasks with quick action buttons", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document, window } = context;
    const past = new Date(Date.now() - 3600000).toISOString();
    window.dispatchEvent(new window.CustomEvent("iaqar:operations-data", {
      detail: {
        authoritative: true,
        items: [{
          id: "match-late",
          recordType: "match",
          status: "waiting_response",
          nextFollowUpAt: past,
          priority: 0,
          icon: "i-match",
          title: "مطابقة 90%",
          subtitle: "حي النخيل",
          time: "الآن"
        }]
      }
    }));

    assert.ok(document.querySelector(".ops-today-section"));
    assert.equal(document.querySelector(".ops-today-section-head h3")?.textContent, "متأخر");
    assert.ok(document.querySelector("[data-ops-quick=\"followup\"]"));
    assert.ok(document.querySelector("[data-ops-quick=\"schedule_viewing\"]"));
  } finally {
    context.close();
  }
});

test("show categories toggles from today list to category grid", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document } = context;
    document.getElementById("operationsShowCategories").click();
    assert.equal(document.getElementById("opsViewTodayList").hidden, true);
    assert.equal(document.getElementById("opsViewCategories").hidden, false);
    assert.equal(document.querySelectorAll("[data-ops-category]").length, 6);
    document.getElementById("operationsShowTodayList").click();
    assert.equal(document.getElementById("opsViewTodayList").hidden, false);
    assert.equal(document.getElementById("opsViewCategories").hidden, true);
  } finally {
    context.close();
  }
});

test("shell renders opportunity today cards with ad layout and save label", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document, window } = context;
    window.dispatchEvent(new window.CustomEvent("iaqar:operations-data", {
      detail: {
        authoritative: true,
        items: [{
          id: "opp-new-1",
          recordId: "opp_new_1",
          recordType: "opportunity",
          lifecycleStatus: "NEW",
          matchingReadiness: "NEEDS_COMPLETION",
          matchingReadinessMissing: ["contactPhone", "advertiserRole"],
          priority: 1,
          icon: "i-house-check",
          title: "عرض مالك",
          propertyType: "دور",
          purpose: "RENT",
          city: "الرياض",
          district: "الورود",
          annualRent: 50000,
          area: 120,
          time: "الآن"
        }]
      }
    }));

    assert.equal(document.querySelector(".ops-today-section-head h3")?.textContent, "طلبات جديدة");
    assert.ok(document.querySelector(".bank-row-header"));
    assert.ok(document.querySelector(".bank-row-stats"));
    assert.ok(document.querySelector(".listing-field-marks"));
    assert.equal(document.querySelector(".ops-task-primary")?.textContent.trim(), "حفظ الفرصة");
  } finally {
    context.close();
  }
});

test("shell includes today list markup and bridge exposes dailyTasksDomain", () => {
  assert.ok(shellSource.includes("id=\"opsViewTodayList\""));
  assert.ok(shellSource.includes("id=\"operationsTodayList\""));
  const bridgeSource = readRepositoryFile("public", "js", "operations-center-bridge.js");
  assert.ok(bridgeSource.includes("dailyTasksDomain"));
});
