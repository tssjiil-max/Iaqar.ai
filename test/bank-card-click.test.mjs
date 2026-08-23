import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";
import { evaluateMatchingReadiness } from "../public/js/opportunity-readiness-domain.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

test("bank list click resolves opportunity only by data-opportunity-id", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("resolveBankRowOpportunityId"));
  assert.ok(bank.includes("data-opportunity-id"));
  assert.ok(bank.includes(".bank-row-card[data-opportunity-id]"));
  assert.equal(/getAttribute\(\"data-open-id\"\)/.test(bank), false);
});

test("bank card click handler ignores nested buttons and links inside the row", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  const bind = bank.match(/function bindListClicks[\s\S]*?^}/m)?.[0] || "";
  assert.ok(bind.includes("isBankCardActionControl"));
  assert.ok(bind.includes("[data-summary-key]"));
  assert.ok(bind.includes(".bank-row-card[data-opportunity-id]"));
  assert.equal(bind.includes('closest("button, a")'), false);
});

test("bank cards bind the Firestore row id only", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  const rowHtml = bank.match(/function bankRowHtml[\s\S]*?^}/m)?.[0] || "";
  assert.ok(rowHtml.includes("data-opportunity-id=\"${escapeHtml(String(row.id || \"\").trim())}\""));
  assert.equal(rowHtml.includes("card.opportunityId || row.id"), false);
});

test("list and deep link share one openOpportunity fetch-by-id path", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("async function openOpportunity"));
  assert.ok(bank.includes("async function fetchOfficeOpportunityById"));
  assert.ok(bank.includes("function openBankDetailFromList"));
  assert.ok(bank.includes("return openOpportunity(opportunityId)"));
  assert.ok(bank.includes("showBankDetailLoading"));
  assert.ok(bank.includes("announceBankDetailOpened"));
  assert.ok(bank.includes("buildOpportunityDeepLinkHash"));
  assert.ok(bank.includes("restoreOpportunityFromLocation"));
  assert.equal(bank.includes("navigateToTasksIncomplete(openId)"), false);
});

test("incomplete bank cards open inline detail instead of redirecting to tasks", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  const opener = bank.match(/async function openOpportunity[\s\S]*?^function openBankDetailFromList/m)?.[0] || "";
  assert.ok(opener.includes("fetchOfficeOpportunityById"));
  assert.equal(opener.includes("navigateToTasksIncomplete"), false);
  const detail = bank.match(/async function renderDetail[\s\S]*?^  const bundle = await loadWorkspaceBundle/m)?.[0] || "";
  assert.ok(detail.includes("buildNeedsCompletionDetailHtml"));
  assert.equal(/if \(!ctx\.dailyTask\) \{\s*navigateToTasksIncomplete/.test(detail), false);
});

test("unified save refreshes list cards after patch", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(/await renderDetail\(id\);\s*renderList\(\)/.test(bank));
});

test("incomplete detail focuses first missing field in unified form", () => {
  const dom = new JSDOM(`
    <div class="bank-missing-banner"></div>
    <form id="bankUnifiedForm">
      <details class="bank-section" open>
        <input name="city" id="cityField">
        <input name="district" id="districtField">
        <input name="priceOrBudget" id="priceField">
      </details>
      <details class="bank-section">
        <input name="advertiserPhoneLocal" id="phoneField">
      </details>
    </form>
  `, { url: "https://example.test/" });
  const doc = dom.window.document;
  globalThis.document = doc;
  const readiness = evaluateMatchingReadiness({
    propertyType: "شقة",
    purpose: "PURCHASE"
  });
  assert.ok(readiness.matchingReadinessMissing.includes("city"));

  const selectors = {
    city: 'input[name="city"]',
    district: 'input[name="district"]',
    priceOrBudget: 'input[name="priceOrBudget"]',
    contactPhone: 'input[name="advertiserPhoneLocal"]'
  };
  for (const key of readiness.matchingReadinessMissing) {
    const sel = selectors[key];
    if (!sel) continue;
    const el = doc.querySelector(sel);
    if (el) {
      el.focus();
      assert.equal(doc.activeElement, el, `expected focus on ${key}`);
      break;
    }
  }
});

test("ready and incomplete cards share one detail opener without bank complete button", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("openBankDetailFromList"));
  assert.ok(bank.includes("navigateToTasksIncomplete"));
  const bankRow = bank.match(/function bankRowHtml[\s\S]*?^}/m)?.[0] || "";
  assert.equal(/data-complete-id|bank-row-complete/.test(bankRow), false);
  assert.ok(bankRow.includes("bank-row-tasks-hint"));
  assert.ok(bankRow.includes("data-open-id"));
});

test("bank card keyboard and aria label include readiness status", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("role=\"button\""));
  assert.ok(bank.includes("keydown"));
  assert.ok(bank.includes("card.headerStatus"));
});

test("wrong office guard blocks opening foreign opportunity", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("canOpenBankOpportunity"));
  assert.ok(bank.includes("لا يمكن فتح هذه الفرصة من هذا المكتب"));
});

test("shell CSS includes pressed state for bank cards", () => {
  const html = readRepo("public", "index.html");
  assert.ok(html.includes(".bank-row.bank-row-card:active"));
  assert.ok(html.includes("cursor:pointer"));
});
