import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFollowUpLifecycleBody,
  buildQuickFollowUpDateTimeInput,
  followUpActivityText,
  parseFollowUpForSave,
  validateFollowUpSaveIds,
  validateTodayRequiresFutureTime
} from "../public/js/opportunity-followup-domain.js";
import { evaluateMatchingReadiness } from "../public/js/opportunity-readiness-domain.js";
import { buildNeedsCompletionDetailHtml } from "../public/js/opportunity-bank-workspace-ui.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

test("incomplete form has single phone field inside grid when phone missing", () => {
  const record = {
    opportunityKind: "OFFER",
    transactionIntent: "SELL",
    purpose: "SALE",
    propertyType: "دور",
    city: "الرياض",
    district: "الوبرة",
    salePrice: 1500000,
    priceOrBudget: 1500000,
    advertiserRole: "OWNER"
  };
  const readiness = evaluateMatchingReadiness(record);
  const html = buildNeedsCompletionDetailHtml("opp-1", record, readiness);
  assert.equal((html.match(/name="advertiserPhoneLocal"/g) || []).length, 1);
  assert.equal(html.includes("bank-advertiser-edit-form"), false);
  assert.equal(html.includes("bank-incomplete-contact"), false);
  assert.equal(html.includes("اسم أو وصف المعلن"), false);
});

test("incomplete form with complete phone has no phone input", () => {
  const record = {
    opportunityKind: "REQUEST",
    contactType: "buyer",
    propertyType: "دور",
    city: "الرياض",
    district: "الوبرة",
    budget: 5000,
    priceOrBudget: 5000,
    advertiserRole: "CLIENT",
    advertiserPhoneNormalized: "+966512345678"
  };
  const readiness = evaluateMatchingReadiness(record);
  assert.ok(readiness.matchingReadinessMissing.includes("transactionIntent"));
  const html = buildNeedsCompletionDetailHtml("opp-2", record, readiness);
  assert.equal(html.includes("name=\"advertiserPhoneLocal\""), false);
});

test("follow-up save body includes officeId and opportunityId", () => {
  const iso = new Date(Date.now() + 7200000).toISOString();
  const body = buildFollowUpLifecycleBody("office-a", "opp-9", iso);
  assert.equal(body.officeId, "office-a");
  assert.equal(body.opportunityId, "opp-9");
  assert.equal(body.action, "set_followup");
  assert.equal(body.nextFollowUpAt, iso);
});

test("follow-up save rejects missing identifiers", () => {
  assert.equal(validateFollowUpSaveIds("", "opp").ok, false);
  assert.equal(validateFollowUpSaveIds("office", "").ok, false);
  assert.equal(validateFollowUpSaveIds("office", "opp").ok, true);
});

test("quick follow-up today picks a future Riyadh time", () => {
  const now = new Date("2026-08-16T12:00:00.000Z");
  const value = buildQuickFollowUpDateTimeInput(0, now);
  const parsed = parseFollowUpForSave(value);
  assert.ok(parsed);
  const check = validateTodayRequiresFutureTime(parsed, now);
  assert.equal(check.ok, true);
});

test("worker maps follow-up to Firestore timestamp fields", () => {
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("followUpFirestoreFields"));
  assert.ok(worker.includes("firestoreTimestamp(new Date(followUp.at))"));
  assert.ok(worker.includes("compactFields"));
});

test("bank follow-up save guards duplicate submissions", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("bankFollowUpSaveBusy"));
  assert.ok(bank.includes("if (bankFollowUpSaveBusy) return"));
});

test("follow-up activity text is Arabic once", () => {
  const future = new Date(Date.now() + 26 * 3600000).toISOString();
  const text = followUpActivityText(future);
  assert.ok(text.startsWith("تم تحديد موعد متابعة:"));
});

test("bank logs follow-up failures to console", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("[iaqar-bank] followup_save_failed"));
  assert.ok(bank.includes("followup_save_missing_ids"));
});
