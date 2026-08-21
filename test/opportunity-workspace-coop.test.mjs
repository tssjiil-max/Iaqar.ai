import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeWorkspaceCooperationRequests,
  activeWorkspaceCooperationRequests,
  mergeUniqueCooperationRequests
} from "../public/js/opportunity-workspace-domain.js";
import {
  buildWorkspaceCoopRowsHtml,
  buildWorkspaceCoopEmptyHintHtml
} from "../public/js/opportunity-bank-workspace-ui.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

test("mergeWorkspaceCooperationRequests prefers bundle rows", () => {
  const merged = mergeWorkspaceCooperationRequests(
    { activeCooperationId: "coop_old" },
    [{ id: "coop_new", status: "PENDING", targetOfficeName: "مكتب ب" }],
    "office-a"
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "coop_new");
});

test("mergeWorkspaceCooperationRequests falls back to activeCooperationId on record", () => {
  const merged = mergeWorkspaceCooperationRequests({
    activeCooperationId: "coop_1",
    cooperationState: "PENDING_APPROVAL",
    cooperationTargetOfficeId: "office-b",
    cooperationTargetOfficeName: "مكتب ب"
  }, [], "office-a");
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, "PENDING");
  assert.equal(merged[0].targetOfficeName, "مكتب ب");
});

test("buildWorkspaceCoopRowsHtml includes open room and cancel actions", () => {
  const html = buildWorkspaceCoopRowsHtml([
    { id: "coop_a", status: "ACCEPTED", originatingOfficeId: "office-a", targetOfficeId: "office-b", targetOfficeName: "مكتب ب" },
    { id: "coop_b", status: "PENDING", originatingOfficeId: "office-a", targetOfficeId: "office-c", targetOfficeName: "مكتب ج" }
  ], { ownOfficeId: "office-a" });
  assert.match(html, /data-open-coop-room="coop_a"/);
  assert.match(html, /data-cancel-coop-request="coop_b"/);
  assert.match(html, /قَبِل المكتب|بانتظار رد المكتب/);
});

test("empty coop hint offers share CTA wired in bank handlers", () => {
  const hint = buildWorkspaceCoopEmptyHintHtml();
  assert.match(hint, /data-workspace-action="goto_office_share"/);
  const bank = readRepositoryFile("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("refreshWorkspaceCoopSection"));
  assert.ok(bank.includes("goto_office_share"));
  assert.ok(bank.includes("applyWorkspaceLifecycleFlow"));
});

test("activeWorkspaceCooperationRequests keeps pending and accepted only", () => {
  const rows = activeWorkspaceCooperationRequests([
    { status: "PENDING" },
    { status: "REJECTED" },
    { status: "ACCEPTED" }
  ]);
  assert.equal(rows.length, 2);
});

test("mergeUniqueCooperationRequests deduplicates by request id", () => {
  const merged = mergeUniqueCooperationRequests(
    [{ id: "coop_a", status: "PENDING" }],
    [{ id: "coop_a", status: "PENDING" }, { id: "coop_b", status: "ACCEPTED" }]
  );
  assert.equal(merged.length, 2);
});
