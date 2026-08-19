/**
 * Daily tasks (المهام اليومية) — category domain + shell wiring tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  OPERATIONS_CATEGORIES,
  categoryKey,
  groupItems,
  categoryCounts,
  filterBrokerVisibleItems,
  isSavedOpportunityFeedback,
  sortIncompleteItems,
  missingFieldCount,
  bestActionHint,
  extractOpportunityId,
  primaryActionLabel
} from "../public/js/operations-center-domain.js";
import { loadShell, readRepositoryFile } from "./helpers/shell.mjs";

const shellSource = readRepositoryFile("public", "index.html");

test("shell shows المهام اليومية and not مركز العمليات in visible UI", () => {
  assert.ok(shellSource.includes("المهام اليومية"));
  assert.ok(shellSource.includes('aria-label="المهام اليومية"'));
  assert.equal(shellSource.includes(">مركز العمليات<"), false);
  assert.equal(shellSource.includes(">مركز العمليات "), false);
});

test("shell includes daily task panel and ui module", () => {
  assert.ok(shellSource.includes("id=\"operationsTaskPanel\""));
  assert.ok(shellSource.includes("js/operations-center-ui.js"));
  assert.equal(shellSource.includes("data-id].operation"), false);
});

test("manifest PWA shortcut uses المهام اليومية", () => {
  const manifest = readRepositoryFile("public", "manifest.webmanifest");
  assert.ok(manifest.includes("المهام اليومية"));
  assert.equal(manifest.includes("مركز العمليات"), false);
});

test("six category definitions exist with Arabic labels in spec order", () => {
  assert.equal(OPERATIONS_CATEGORIES.length, 6);
  const labels = OPERATIONS_CATEGORIES.map((c) => c.label);
  assert.deepEqual(labels, [
    "تحتاج استكمال",
    "جاهزة للمطابقة",
    "تحتاج متابعة",
    "تمت المطابقة",
    "تم الرد عليها",
    "منتهية ومؤرشفة"
  ]);
  const keys = OPERATIONS_CATEGORIES.map((c) => c.key);
  assert.deepEqual(keys, [
    "incomplete",
    "ready",
    "follow_up",
    "matched",
    "responded",
    "archived"
  ]);
});

test("categoryKey maps operation types to expected buckets", () => {
  assert.equal(categoryKey({ operationType: "MISSING_DATA" }), "incomplete");
  assert.equal(categoryKey({ operationType: "ADVERTISER_FOLLOWUP" }), "follow_up");
  assert.equal(categoryKey({ matchingReadiness: "READY_FOR_MATCHING", title: "فرصة" }), "ready");
  assert.equal(categoryKey({ operationType: "MATCH_REVIEW", recordType: "operation" }), "matched");
  assert.equal(categoryKey({ recordType: "match", title: "مطابقة" }), "matched");
  assert.equal(categoryKey({ operationType: "COOPERATION_RESPONSE" }), "responded");
  assert.equal(categoryKey({ lifecycleStatus: "ARCHIVED" }), "archived");
});

test("sortIncompleteItems orders by missing field count then age", () => {
  const items = [
    { id: "a", matchingReadinessMissing: ["purpose", "city", "district"], createdAt: "2026-01-02" },
    { id: "b", matchingReadinessMissing: ["purpose"], createdAt: "2026-01-03" },
    { id: "c", matchingReadinessMissing: ["purpose", "city"], createdAt: "2026-01-01" }
  ];
  const sorted = sortIncompleteItems(items);
  assert.deepEqual(sorted.map((row) => row.id), ["b", "c", "a"]);
});

test("missingFieldCount and bestActionHint use readiness metadata", () => {
  const item = {
    matchingReadinessMissing: ["contactPhone"],
    matchingReadiness: "NEEDS_COMPLETION"
  };
  assert.equal(missingFieldCount(item), 1);
  assert.equal(bestActionHint(item), "أكمل رقم الجوال");
  assert.equal(primaryActionLabel(item), "حفظ الفرصة");
});

test("extractOpportunityId resolves opportunity records", () => {
  assert.equal(extractOpportunityId({ recordType: "opportunity", recordId: "abc123" }), "abc123");
  assert.equal(extractOpportunityId({ id: "opp-xyz", recordType: "opportunity", recordId: "xyz" }), "xyz");
  assert.equal(extractOpportunityId({
    id: "opp-opp_lifecycle_verify_1",
    recordType: "opportunity",
    recordId: "opp_lifecycle_verify_1",
    opportunityId: "opp_lifecycle_verify_1"
  }), "opp_lifecycle_verify_1");
  assert.equal(extractOpportunityId({ operationType: "MISSING_DATA", opportunityId: "opp99" }), "opp99");
});

test("groupItems and categoryCounts tally real items", () => {
  const items = [
    { id: "a", operationType: "MISSING_DATA", priority: 1 },
    { id: "b", operationType: "MATCH_REVIEW", recordType: "operation", priority: 0 },
    { id: "c", operationType: "ADVERTISER_FOLLOWUP", priority: 2 },
    { id: "d", lifecycleStatus: "ARCHIVED", priority: 3 }
  ];
  const groups = groupItems(items);
  assert.equal(groups.incomplete.length, 1);
  assert.equal(groups.matched.length, 1);
  assert.equal(groups.follow_up.length, 1);
  assert.equal(groups.archived.length, 1);
  const counts = categoryCounts(items);
  assert.equal(counts.incomplete, 1);
  assert.equal(counts.matched, 1);
  assert.equal(counts.follow_up, 1);
  assert.equal(counts.archived, 1);
  assert.equal(counts.ready, 0);
});

test("saved opportunity feedback is excluded from broker-visible counts", () => {
  const items = [
    { id: "save", operationType: "OPPORTUNITY_SAVED", title: "فرصة محفوظة مسبقًا" },
    { id: "real", operationType: "MISSING_DATA" }
  ];
  assert.equal(isSavedOpportunityFeedback(items[0]), true);
  assert.equal(filterBrokerVisibleItems(items).length, 1);
  assert.equal(categoryCounts(items).incomplete, 1);
});

test("shell renders six category cards after opening categories view", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document } = context;
    document.getElementById("operationsShowCategories").click();
    assert.equal(document.querySelectorAll("[data-ops-category]").length, 6);
    assert.equal(document.getElementById("opsViewCategories").hidden, false);
    assert.equal(document.getElementById("opsViewTodayList").hidden, true);
    assert.equal(document.getElementById("opsViewCategoryList").hidden, true);
    assert.equal(document.getElementById("opsViewOpportunityDetail").hidden, true);
    assert.equal(document.getElementById("operationsCategoryGrid").hidden, false);
  } finally {
    context.close();
  }
});

test("clicking a category shows only its records as task cards", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document, window } = context;
    document.getElementById("operationsShowCategories").click();
    window.dispatchEvent(new window.CustomEvent("iaqar:operations-data", {
      detail: {
        authoritative: true,
        items: [
          {
            id: "match-1", main: "opportunities", priority: 0, isAlert: true, icon: "i-match",
            title: "مطابقة بنسبة 88%", subtitle: "طلب عميل", time: "الآن",
            detailsLines: ["تفاصيل"], recordType: "match", recordId: "match-1"
          },
          {
            id: "op-md", operationType: "MISSING_DATA", recordType: "operation", priority: 1,
            icon: "i-clipboard-list", title: "استكمال بيانات", subtitle: "ناقص", time: "الآن",
            detailsLines: ["ناقص"], actionLabel: "استكمال",
            matchingReadinessMissing: ["purpose"]
          }
        ]
      }
    }));

    const incompleteBtn = document.querySelector("[data-ops-category=\"incomplete\"]");
    incompleteBtn.click();
    assert.equal(document.getElementById("opsViewCategories").hidden, true);
    assert.equal(document.getElementById("opsViewCategoryList").hidden, false);
    assert.equal(document.getElementById("opsViewOpportunityDetail").hidden, true);
    assert.equal(document.getElementById("operationsCategoryGrid").hidden, true);
    assert.equal(document.getElementById("operationsCategoryDetailHead").hidden, false);
    const titles = Array.from(document.querySelectorAll(".ops-task-body h4")).map((n) => n.textContent.trim());
    assert.deepEqual(titles, ["استكمال بيانات"]);
    assert.equal(document.querySelectorAll(".ops-task-card").length, 1);

    document.getElementById("operationsCategoryClose").click();
    assert.equal(document.getElementById("opsViewCategories").hidden, false);
    assert.equal(document.getElementById("opsViewCategoryList").hidden, true);
    assert.equal(document.getElementById("operationsCategoryGrid").hidden, false);
    assert.equal(document.getElementById("opsViewCategories").querySelectorAll(".ops-task-card").length, 0);
  } finally {
    context.close();
  }
});

test("empty shell shows today list empty state and category grid after toggle", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document } = context;
    assert.equal(document.querySelectorAll(".ops-task-card").length, 0);
    assert.equal(document.getElementById("operationList").innerHTML.trim(), "");
    assert.equal(document.getElementById("total").textContent, "0");
    const todayEmpty = document.getElementById("operationsTodayEmpty");
    assert.ok(todayEmpty);
    assert.equal(todayEmpty.hidden, false);
    document.getElementById("operationsShowCategories").click();
    assert.equal(document.querySelectorAll("[data-ops-category]").length, 6);
    const empty = document.getElementById("operationsEmpty");
    assert.ok(empty);
    assert.equal(empty.hidden, false);
    assert.ok(empty.textContent.includes("لا توجد مهام تحتاج انتباهك حاليًا"));
  } finally {
    context.close();
  }
});

test("opportunity bank exposes renderDailyTaskOpportunity", () => {
  const bankSource = readRepositoryFile("public", "js", "opportunity-bank.js");
  assert.ok(bankSource.includes("renderDailyTaskOpportunity"));
});

function dispatchOpsData(window, items) {
  window.dispatchEvent(new window.CustomEvent("iaqar:operations-data", {
    detail: { authoritative: true, items }
  }));
}

const incompleteOpItem = {
  id: "op-md",
  operationType: "MISSING_DATA",
  recordType: "operation",
  priority: 1,
  icon: "i-clipboard-list",
  title: "استكمال بيانات",
  subtitle: "ناقص",
  time: "الآن",
  detailsLines: ["ناقص"],
  actionLabel: "استكمال",
  opportunityId: "opp_test_incomplete",
  matchingReadinessMissing: ["purpose"]
};

const readyOpItem = {
  id: "opp-ready-1",
  recordType: "opportunity",
  recordId: "opp_ready_1",
  opportunityId: "opp_ready_1",
  priority: 0,
  icon: "i-clipboard-list",
  title: "فرصة جاهزة",
  subtitle: "جاهزة للمطابقة",
  time: "الآن",
  matchingReadiness: "READY_FOR_MATCHING"
};

test("daily task stage navigation hides categories when list is open", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document, window } = context;
    document.getElementById("operationsShowCategories").click();
    dispatchOpsData(window, [incompleteOpItem]);
    document.querySelector("[data-ops-category=\"incomplete\"]").click();

    assert.equal(document.getElementById("opsViewCategories").hidden, true);
    assert.equal(document.getElementById("opsViewCategoryList").hidden, false);
    assert.equal(document.getElementById("opsViewOpportunityDetail").hidden, true);
    assert.equal(document.querySelectorAll("[data-ops-category]").length, 6);
    assert.ok(document.getElementById("opsViewCategories").contains(
      document.querySelector("[data-ops-category=\"incomplete\"]")
    ));
  } finally {
    context.close();
  }
});

test("daily task stage navigation hides list when opportunity detail opens", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document, window } = context;
    document.getElementById("operationsShowCategories").click();
    window.IAQAR.renderDailyTaskOpportunity = async (panelId) => {
      const panel = document.getElementById(panelId);
      panel.innerHTML = `
        <div class="bank-detail-head">
          <h3>تفاصيل الفرصة</h3>
          <button type="button" class="settings-close" id="bankDetailClose" aria-label="إغلاق">×</button>
        </div>
        <section class="bank-unified-form"><p>نموذج الاستكمال</p></section>`;
      panel.hidden = false;
      return true;
    };

    dispatchOpsData(window, [incompleteOpItem]);
    document.querySelector("[data-ops-category=\"incomplete\"]").click();
    document.querySelector("[data-ops-open-task]").click();
    await new Promise((resolve) => {
      const raf = window.requestAnimationFrame || ((cb) => window.setTimeout(cb, 0));
      raf(() => resolve());
    });

    assert.equal(document.getElementById("opsViewCategoryList").hidden, true);
    assert.equal(document.getElementById("opsViewOpportunityDetail").hidden, false);
    assert.equal(document.getElementById("opsViewCategories").hidden, true);
    assert.equal(document.querySelectorAll(".ops-task-card").length, 1);
    assert.ok(document.getElementById("opsViewCategoryList").contains(
      document.querySelector(".ops-task-card")
    ));
    assert.ok(document.getElementById("operationsTaskPanel").textContent.includes("تفاصيل الفرصة"));

    document.getElementById("operationsDetailBack").click();
    assert.equal(document.getElementById("opsViewCategoryList").hidden, false);
    assert.equal(document.getElementById("opsViewOpportunityDetail").hidden, true);
    assert.equal(document.getElementById("operationsTaskPanel").innerHTML.trim(), "");
  } finally {
    context.close();
  }
});

test("daily task back navigation restores categories without reload", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document, window } = context;
    document.getElementById("operationsShowCategories").click();
    dispatchOpsData(window, [incompleteOpItem, readyOpItem]);
    document.querySelector("[data-ops-category=\"incomplete\"]").click();
    document.getElementById("operationsCategoryClose").click();

    assert.equal(document.getElementById("opsViewCategories").hidden, false);
    assert.equal(document.getElementById("opsViewCategoryList").hidden, true);
    assert.equal(document.getElementById("total").textContent, "2");
    assert.equal(document.querySelectorAll("[data-ops-category]").length, 6);
  } finally {
    context.close();
  }
});

test("shell mobile CSS keeps daily task detail panel full width up to 768px", () => {
  assert.ok(shellSource.includes("@media (max-width: 768px)"));
  assert.ok(shellSource.includes("#workspace .ops-task-panel"));
  assert.ok(shellSource.includes("width:100%"));
  assert.ok(shellSource.includes("ops-daily-stage"));
  assert.ok(shellSource.includes("ops-stage-view"));
});

test("operations ui uses explicit view modes for stage navigation", () => {
  const uiSource = readRepositoryFile("public", "js", "operations-center-ui.js");
  assert.ok(uiSource.includes("today-list"));
  assert.ok(uiSource.includes("categories"));
  assert.ok(uiSource.includes("category-list"));
  assert.ok(uiSource.includes("opportunity-detail"));
  assert.ok(uiSource.includes("scrollIntoView"));
  assert.ok(uiSource.includes("aria-hidden"));
});
