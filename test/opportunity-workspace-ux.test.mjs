import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkspaceSummaryStripHtml,
  buildWorkspaceNextStepHtml,
  resolveWorkspaceNextAction,
  buildWorkspaceSectionPreviews,
  wrapWorkspaceCollapsibleSection,
  buildWorkspaceSecondaryActionsHtml
} from "../public/js/opportunity-workspace-ux-ui.js";
import { evaluateMatchingReadiness } from "../public/js/opportunity-readiness-domain.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

test("summary strip uses existing readiness without inventing fields", () => {
  const record = { propertyType: "شقة", purpose: "PURCHASE", city: "مكة" };
  const readiness = evaluateMatchingReadiness(record);
  const html = buildWorkspaceSummaryStripHtml("opp_1", record, readiness);
  assert.match(html, /شقة/);
  assert.match(html, /مكة/);
  assert.match(html, /ينقص/);
  assert.match(html, /data-missing-field="district"/);
});

test("next step reuses buildBestNextAction labels", () => {
  const record = {
    id: "opp_a",
    purpose: "SALE",
    propertyType: "أرض",
    city: "الرياض",
    district: "الوبرة",
    price: 1000000,
    area: 900,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966512345678"
  };
  const matches = [
    { matchId: "m1", score: 82, opportunityId: "opp_a", counterpartOpportunityId: "opp_b", isCurrent: true, status: "active" }
  ];
  const action = resolveWorkspaceNextAction(record, { matches });
  assert.equal(action.action, "review_matches");
  const html = buildWorkspaceNextStepHtml(action);
  assert.match(html, /data-next-action="review_matches"/);
  assert.match(html, /الخطوة التالية/);
});

test("section previews derive from bundle data only", () => {
  const previews = buildWorkspaceSectionPreviews("opp_a", {}, {
    matches: [{ matchId: "m1", score: 91, opportunityId: "opp_a", counterpartOpportunityId: "opp_b", isCurrent: true, status: "active" }],
    cooperationRequests: [{ id: "c1", status: "PENDING" }, { id: "c2", status: "PENDING" }]
  });
  assert.match(previews.matches, /91%/);
  assert.match(previews.coop, /2 مكاتب/);
});

test("collapsible wrapper keeps section id for existing handlers", () => {
  const html = wrapWorkspaceCollapsibleSection({
    id: "bankWorkspaceMatchesSection",
    title: "المطابقة",
    preview: "3 نتائج",
    body: "<p id=\"bankMatchesStatus\"></p>",
    hidden: true
  });
  assert.match(html, /id="bankWorkspaceMatchesSection"/);
  assert.match(html, /bank-workspace-collapsible-toggle/);
  assert.match(html, /is-collapsed/);
});

test("secondary actions preserve workspace action ids", () => {
  const html = buildWorkspaceSecondaryActionsHtml([
    { id: "search_matches", label: "البحث عن مطابقة" },
    { id: "send_and_share", label: "إرسال ومشاركة" }
  ]);
  assert.match(html, /data-workspace-action="search_matches"/);
  assert.match(html, /data-workspace-action="send_and_share"/);
  assert.match(html, /إجراءات أخرى/);
});

test("bank wires UX presentation without backend changes", () => {
  const bank = readRepositoryFile("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("wireWorkspaceUxPresentation"));
  assert.ok(bank.includes("runWorkspaceNextAction"));
  const worker = readRepositoryFile("worker", "src", "index.js");
  assert.doesNotMatch(worker, /wireWorkspaceUxPresentation/);
});

test("ready workspace html includes summary and collapsible sections", () => {
  const ui = readRepositoryFile("public", "js", "opportunity-bank-workspace-ui.js");
  const ux = readRepositoryFile("public", "js", "opportunity-workspace-ux-ui.js");
  assert.ok(ui.includes("buildWorkspaceSummaryStripHtml"));
  assert.ok(ui.includes("wrapWorkspaceCollapsibleSection"));
  assert.ok(ux.includes('id="bankWorkspaceUxSummary"'));
});
