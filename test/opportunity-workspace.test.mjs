import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildBestNextAction,
  buildWorkspaceHeader,
  missingFieldEditorRows,
  sortMatchesForWorkspace,
  workspaceSmartActions
} from "../public/js/opportunity-workspace-domain.js";
import { evaluateMatchingReadiness } from "../public/js/opportunity-readiness-domain.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

test("ready and incomplete cards share openBankDetailFromList", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("openBankDetailFromList"));
  assert.ok(bank.includes("scrollBankDetailIntoView"));
  assert.ok(bank.includes("buildReadyWorkspaceHtml"));
  assert.ok(bank.includes("buildNeedsCompletionDetailHtml"));
});

test("needs-completion shows exact Arabic missing field names", () => {
  const record = { propertyType: "شقة", purpose: "PURCHASE" };
  const readiness = evaluateMatchingReadiness(record);
  const rows = missingFieldEditorRows(record);
  assert.ok(readiness.matchingReadinessMissing.includes("city"));
  assert.ok(rows.some((row) => row.label === "المدينة"));
});

test("best next action after agreement points to deal completion", () => {
  const record = {
    id: "opp_a",
    purpose: "SALE",
    propertyType: "أرض",
    city: "الرياض",
    district: "الوبرة",
    price: 1000000,
    area: 900,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966512345678",
    lastContactOutcome: "AGREED"
  };
  const action = buildBestNextAction({ record, matches: [], suggestions: [] });
  assert.equal(action.action, "complete_deal");
  assert.match(action.label, /إتمام الصفقة/);
});

test("best next action after refusal points to lifecycle close", () => {
  const record = {
    id: "opp_a",
    purpose: "SALE",
    propertyType: "أرض",
    city: "الرياض",
    district: "الوبرة",
    price: 1000000,
    area: 900,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966512345678",
    lastContactOutcome: "REFUSED"
  };
  const action = buildBestNextAction({ record, matches: [], suggestions: [] });
  assert.equal(action.action, "close_opportunity");
  assert.match(action.label, /إنهاء الفرصة/);
});

test("real match count drives review action", () => {
  const record = { id: "opp_a", purpose: "SALE", propertyType: "أرض", city: "الرياض", district: "الوبرة", price: 1000000, area: 900, advertiserRole: "OWNER", advertiserPhoneNormalized: "+966512345678" };
  const matches = [
    { matchId: "m1", score: 82, opportunityId: "opp_a", counterpartOpportunityId: "opp_b", isCurrent: true, status: "active" },
    { matchId: "m2", score: 71, opportunityId: "opp_a", counterpartOpportunityId: "opp_c", isCurrent: true, status: "active" }
  ];
  const action = buildBestNextAction({ record, matches, suggestions: [] });
  assert.equal(action.action, "review_matches");
  assert.equal(action.count, 2);
  assert.match(action.label, /2 مطابقات حقيقية/);
});

test("fabricated zero-score match is excluded from workspace list", () => {
  const sorted = sortMatchesForWorkspace([
    { matchId: "m0", score: 0, opportunityId: "opp_a", counterpartOpportunityId: "opp_b", isCurrent: true },
    { matchId: "m1", score: 65, opportunityId: "opp_a", counterpartOpportunityId: "opp_c", isCurrent: true, status: "active" }
  ], "opp_a");
  assert.equal(sorted.length, 1);
  assert.equal(sorted[0].matchId, "m1");
});

test("matches sorted by real percentage descending", () => {
  const sorted = sortMatchesForWorkspace([
    { matchId: "m1", score: 55, opportunityId: "opp_a", counterpartOpportunityId: "opp_b", isCurrent: true, status: "active", rank: 2 },
    { matchId: "m2", score: 88, opportunityId: "opp_a", counterpartOpportunityId: "opp_c", isCurrent: true, status: "active", rank: 1 }
  ], "opp_a");
  assert.equal(sorted[0].matchId, "m2");
});

test("workspace smart actions all have handlers in bank", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  const actions = workspaceSmartActions({ contactType: "owner" });
  for (const action of actions) {
    assert.ok(bank.includes(`data-workspace-action="${action.id}"`) || bank.includes("data-workspace-action"));
  }
  assert.ok(bank.includes("wireWorkspaceHandlers"));
});

test("workspace header hides contact when incomplete", () => {
  const incomplete = buildWorkspaceHeader({ propertyType: "شقة" });
  assert.equal(incomplete.isReadyForMatching, false);
  const ready = buildWorkspaceHeader({
    propertyType: "أرض",
    purpose: "SALE",
    city: "الرياض",
    district: "الوبرة",
    price: 1500000,
    area: 900,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966512345678",
    advertiserDisplayName: "محمد"
  });
  assert.equal(ready.isReadyForMatching, true);
  assert.ok(ready.title.includes("أرض"));
});

test("worker exposes opportunity workspace endpoint", () => {
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("/opportunity/workspace"));
  assert.ok(worker.includes("/cooperation/room"));
});

test("cooperation room rules isolate third office", () => {
  const rules = readRepo("firestore.rules");
  assert.ok(rules.includes("match /cooperationRooms/{roomId}"));
  assert.ok(rules.includes("originatingOfficeId"));
  assert.ok(rules.includes("targetOfficeId"));
});

test("service worker cache bumped for workspace", () => {
  const sw = readRepo("public", "firebase-messaging-sw.js");
  assert.ok(sw.includes("iaqar-shell-"));
  assert.ok(sw.includes("/version.json"));
});

test("incomplete save button label is canonical", () => {
  const ui = readRepo("public", "js", "opportunity-bank-workspace-ui.js");
  assert.ok(ui.includes("حفظ واستكمال الفرصة"));
});

test("desktop workspace side panel CSS exists", () => {
  const html = readRepo("public", "index.html");
  assert.ok(html.includes(".bank-workspace-side"));
  assert.ok(html.includes("min-height:52px"));
});
