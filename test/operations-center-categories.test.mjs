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
  isSavedOpportunityFeedback
} from "../public/js/operations-center-domain.js";
import { loadShell, readRepositoryFile } from "./helpers/shell.mjs";

const shellSource = readRepositoryFile("public", "index.html");
const bankSource = readRepositoryFile("public", "js", "opportunity-bank.js");

test("shell shows المهام اليومية and not مركز العمليات in visible UI", () => {
  assert.ok(shellSource.includes("المهام اليومية"));
  assert.ok(shellSource.includes('aria-label="المهام اليومية"'));
  assert.equal(shellSource.includes(">مركز العمليات<"), false);
  assert.equal(shellSource.includes(">مركز العمليات "), false);
});

test("manifest PWA shortcut uses المهام اليومية", () => {
  const manifest = readRepositoryFile("public", "manifest.webmanifest");
  assert.ok(manifest.includes("المهام اليومية"));
  assert.equal(manifest.includes("مركز العمليات"), false);
});

test("six category definitions exist with Arabic labels", () => {
  assert.equal(OPERATIONS_CATEGORIES.length, 6);
  const labels = OPERATIONS_CATEGORIES.map((c) => c.label);
  assert.deepEqual(labels, [
    "غير مكتملة",
    "تحتاج متابعة",
    "جاهزة للمطابقة",
    "تمت المطابقة",
    "تم الرد عليها",
    "منتهية ومؤرشفة"
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

test("shell renders six category cards before opening a category", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document } = context;
    assert.equal(document.querySelectorAll("[data-ops-category]").length, 6);
    assert.equal(document.getElementById("operationList").hidden, true);
    assert.equal(document.getElementById("operationsCategoryGrid").hidden, false);
  } finally {
    context.close();
  }
});

test("clicking a category shows only its records", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document, window } = context;
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
            detailsLines: ["ناقص"], actionLabel: "استكمال"
          }
        ]
      }
    }));

    const incompleteBtn = document.querySelector("[data-ops-category=\"incomplete\"]");
    incompleteBtn.click();
    assert.equal(document.getElementById("operationsCategoryGrid").hidden, true);
    assert.equal(document.getElementById("operationsCategoryDetailHead").hidden, false);
    const titles = Array.from(document.querySelectorAll(".operation h3")).map((n) => n.textContent.trim());
    assert.deepEqual(titles, ["استكمال بيانات"]);

    document.getElementById("operationsCategoryClose").click();
    assert.equal(document.getElementById("operationsCategoryGrid").hidden, false);
    assert.equal(document.querySelectorAll(".operation").length, 0);
  } finally {
    context.close();
  }
});

test("empty shell has no demo operations and shows category grid", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document } = context;
    assert.equal(document.querySelectorAll(".operation").length, 0);
    assert.equal(document.getElementById("operationList").innerHTML.trim(), "");
    assert.equal(document.getElementById("total").textContent, "0");
    assert.equal(document.querySelectorAll("[data-ops-category]").length, 6);
    const empty = document.getElementById("operationsEmpty");
    assert.ok(empty);
    assert.equal(empty.hidden, false);
    assert.ok(empty.textContent.includes("لا توجد مهام تحتاج انتباهك حاليًا"));
  } finally {
    context.close();
  }
});

test("opportunity bank module was not modified for this task", () => {
  assert.equal(bankSource.includes("operations-center-domain"), false);
  assert.ok(bankSource.includes("openOpportunityBank"));
});
