import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTACT_OUTCOME_ORDER,
  validateContactOutcomeSave,
  contactOutcomeActivityText,
  shouldShowContactOutcomePanel,
  buildContactOutcomeActionKind,
  defaultContactRetryInput
} from "../public/js/opportunity-contact-outcome-domain.js";
import {
  buildContactOutcomeActionHtml,
  buildContactOutcomesSectionHtml,
  buildReadyWorkspaceHtml
} from "../public/js/opportunity-bank-workspace-ui.js";
import { evaluateMatchingReadiness } from "../public/js/opportunity-readiness-domain.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

test("each contact outcome exposes an action panel kind", () => {
  for (const outcome of CONTACT_OUTCOME_ORDER) {
    assert.ok(buildContactOutcomeActionKind(outcome));
    const html = buildContactOutcomeActionHtml(outcome);
    assert.ok(html.length > 0);
    assert.ok(!html.includes("NO_RESPONSE"));
    assert.ok(!html.includes("INTERESTED"));
  }
});

test("NO_RESPONSE requires retry schedule", () => {
  const empty = validateContactOutcomeSave("NO_RESPONSE", { followUpAt: "" });
  assert.equal(empty.ok, false);
  const ok = validateContactOutcomeSave("NO_RESPONSE", { followUpAt: defaultContactRetryInput() });
  assert.equal(ok.ok, true);
  assert.ok(ok.followUpAt);
});

test("REFUSED requires arabic reason", () => {
  const missing = validateContactOutcomeSave("REFUSED", { refusalReason: "" });
  assert.equal(missing.ok, false);
  const ok = validateContactOutcomeSave("REFUSED", { refusalReason: "price" });
  assert.equal(ok.ok, true);
  assert.equal(ok.note, "السعر");
});

test("FOLLOW_UP requires valid appointment", () => {
  const missing = validateContactOutcomeSave("FOLLOW_UP", { followUpAt: "" });
  assert.equal(missing.ok, false);
});

test("INTERESTED allows optional follow-up and note", () => {
  const ok = validateContactOutcomeSave("INTERESTED", { note: "يريد معاينة" });
  assert.equal(ok.ok, true);
  assert.equal(ok.note, "يريد معاينة");
});

test("AGREED defers deal completion to matching workflow", () => {
  const html = buildContactOutcomeActionHtml("AGREED");
  assert.ok(html.includes("إتمام الصفقة"));
  assert.ok(html.includes("لن تُغلق الفرصة تلقائيًا"));
  assert.equal(html.includes("bankContactAgreedDeal"), false);
});

test("REFUSED uses single close path via management modal", () => {
  const html = buildContactOutcomeActionHtml("REFUSED");
  assert.equal(html.includes("bankContactRefusedArchive"), false);
  assert.ok(html.includes("إدارة الفرصة"));
});

test("workspace section has single outcome button row and save button", () => {
  const record = {
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "الرياض",
    district: "حي",
    price: 1,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966512345678",
    lastCallOpenedAt: new Date().toISOString()
  };
  const html = buildContactOutcomesSectionHtml(record, { show: true });
  assert.equal((html.match(/data-contact-outcome=/g) || []).length, 5);
  assert.ok(html.includes("bankSaveContactOutcomeBtn"));
  assert.ok(html.includes("حفظ النتيجة والإجراء القادم"));
  assert.equal(html.includes("bankContactOutcomesWrap"), false);
});

test("ready workspace embeds contact section not legacy wrap", () => {
  const record = {
    opportunityKind: "REQUEST",
    purpose: "PURCHASE",
    propertyType: "شقة",
    city: "الرياض",
    district: "حي",
    budget: 1,
    advertiserRole: "CLIENT",
    advertiserPhoneNormalized: "+966512345678",
    lastWhatsAppOpenedAt: new Date().toISOString()
  };
  const readiness = evaluateMatchingReadiness(record);
  assert.equal(readiness.isReadyForMatching, true);
  const html = buildReadyWorkspaceHtml("opp-1", record, {});
  assert.ok(html.includes("bankWorkspaceContactSection"));
  assert.equal(html.includes("bankContactOutcomesWrap"), false);
});

test("contact outcome activity text is arabic", () => {
  const text = contactOutcomeActivityText("INTERESTED", { note: "مهتم بالمعاينة" });
  assert.ok(text.includes("مهتم"));
  assert.ok(text.includes("مهتم بالمعاينة"));
});

test("panel visibility when contact attempted without outcome", () => {
  assert.equal(shouldShowContactOutcomePanel({ lastCallOpenedAt: new Date().toISOString() }), true);
  assert.equal(shouldShowContactOutcomePanel({ lastContactOutcome: "INTERESTED" }), false);
});

test("bank saves on explicit button not on outcome tap", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("bankSaveContactOutcomeBtn"));
  assert.ok(bank.includes("saveContactOutcomeBundle"));
  assert.ok(bank.includes("bankContactOutcomeSaveBusy"));
});

test("selected outcome style uses site green", () => {
  const html = readRepo("public", "index.html");
  assert.ok(html.includes(".bank-contact-outcome-btn.is-selected"));
  assert.ok(html.includes("background:var(--green)"));
});
