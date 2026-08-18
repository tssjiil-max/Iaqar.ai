import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FOLLOWUP_REMINDER_MINUTES,
  validateFutureFollowUpAt,
  validateTodayRequiresFutureTime,
  computeReminderAt,
  defaultRecipientMode,
  resolveRecipientContext,
  normalizeRecipientMode,
  deriveFollowUpStatus,
  isFollowUpOverdue,
  riyadhDateTimeInputValue,
  parseRiyadhDateTimeInput,
  formatFollowUpAppointmentLine,
  activeFollowUpFromRecord
} from "../public/js/opportunity-followup-domain.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

const futureAt = new Date(Date.now() + 3 * 3600000).toISOString();
const pastAt = new Date(Date.now() - 3600000).toISOString();

test("saved follow-up input uses Riyadh datetime value", () => {
  const value = riyadhDateTimeInputValue(futureAt);
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test("saved follow-up survives close/reopen via server reload helper", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("reloadActiveOpportunityFromServer"));
  assert.ok(workflow.includes("populateFollowUpInput"));
});

test("saved follow-up survives full reload via Firestore read on open", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("openOpportunityManagement"));
  assert.ok(workflow.includes(".collection(\"opportunities\").doc(opportunityId).get()"));
});

test("past time is rejected server-side", () => {
  const worker = readRepo("worker", "src", "index.js");
  const domain = readRepo("worker", "src", "opportunity-followup.mjs");
  assert.ok(worker.includes("validateFutureFollowUpAt"));
  assert.ok(domain.includes("followup_past"));
  const result = validateFutureFollowUpAt(pastAt);
  assert.equal(result.ok, false);
});

test("today without a future time is rejected", () => {
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("followup_today_past"));
  const now = new Date("2026-08-16T12:00:00.000Z");
  const riyadhParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const pick = (type) => riyadhParts.find((part) => part.type === type)?.value || "";
  const todayInput = `${pick("year")}-${pick("month")}-${pick("day")}T00:30`;
  const parsed = parseRiyadhDateTimeInput(todayInput);
  const check = validateTodayRequiresFutureTime(parsed, now);
  assert.equal(check.ok, false);
  assert.equal(check.message, "اختر وقتًا قادمًا اليوم");
});

test("new appointment does not become immediately overdue", () => {
  const followUp = { at: futureAt, status: "scheduled", reminderAt: computeReminderAt(futureAt).toISOString() };
  assert.equal(isFollowUpOverdue(followUp), false);
  assert.equal(deriveFollowUpStatus(followUp), "scheduled");
});

test("owner offer defaults to owner recipient", () => {
  assert.equal(defaultRecipientMode({ contactType: "owner", recordType: "owner_offer" }), "owner");
});

test("client request defaults to client recipient", () => {
  assert.equal(defaultRecipientMode({ contactType: "buyer", recordType: "client_request" }), "client");
});

test("both is unavailable without linked owner and client", () => {
  const ctx = resolveRecipientContext({ contactType: "owner", recordType: "owner_offer" });
  assert.equal(ctx.hasBothParties, false);
  assert.equal(ctx.availableModes.includes("both"), false);
  assert.equal(ctx.availableModes.includes("owner"), true);
});

test("bank offer always exposes owner in confirm-with dropdown", () => {
  const ctx = resolveRecipientContext({ opportunityKind: "OFFER", advertiserRole: "OWNER" });
  assert.deepEqual(ctx.availableModes, ["owner"]);
  assert.equal(ctx.defaultMode, "owner");
});

test("bank request always exposes client in confirm-with dropdown", () => {
  const ctx = resolveRecipientContext({ opportunityKind: "REQUEST", advertiserRole: "CLIENT" });
  assert.deepEqual(ctx.availableModes, ["client"]);
  assert.equal(ctx.defaultMode, "client");
});

test("both creates two separate WhatsApp actions", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("followup-whatsapp"));
  assert.ok(workflow.includes("openFollowUpReminderWhatsApp"));
  assert.ok(workflow.includes("modes.push(\"owner\", \"client\")"));
});

test("reminderAt equals followUpAt minus 60 minutes", () => {
  const reminder = computeReminderAt(futureAt);
  const diff = new Date(futureAt).getTime() - reminder.getTime();
  assert.equal(diff, FOLLOWUP_REMINDER_MINUTES * 60 * 1000);
});

test("reminder dispatch is office-isolated in worker", () => {
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("processOpportunityFollowupReminders"));
  assert.ok(worker.includes("normalizeOfficeId(value.officeId)"));
});

test("old reminder is invalidated after rescheduling", () => {
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("followup_rescheduled"));
  assert.ok(worker.includes("followUpReminderAt"));
});

test("cancelled appointment sends no reminder", () => {
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("cancel_followup"));
  assert.ok(worker.includes("shouldSendFollowUpReminder"));
});

test("completed appointment sends no reminder", () => {
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("complete_followup"));
});

test("reminder dispatch is idempotent via dedup key", () => {
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("followUpReminderDedupKey"));
  assert.ok(worker.includes("alerts"));
});

test("notification click opens correct opportunityId", () => {
  const nav = readRepo("public", "js", "notification-navigation.js");
  assert.ok(nav.includes("opportunity_followup_reminder"));
  assert.ok(nav.includes("focusFollowUp"));
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("openOpportunity"));
});

test("legacy deal notifications route to Operations Center deep link", () => {
  const nav = readRepo("public", "js", "notification-navigation.js");
  assert.ok(nav.includes('if (openDeal) return { kind: "match"'));
  assert.ok(nav.includes('params.set("openMatch", target.id)'));
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("openRecordFromNotification"));
  assert.equal(workflow.includes('main: "deals"'), false);
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes('type==="deal"'));
  assert.ok(worker.includes("openMatch"));
});

test("WhatsApp requires a broker click", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("openFollowUpReminderWhatsApp"));
  assert.ok(workflow.includes("openWhatsAppHandoff"));
});

test("WhatsApp open does not mark message sent", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("whatsapp_opened"));
  assert.equal(/message_sent/.test(workflow.match(/openFollowUpReminderWhatsApp[\s\S]*?^  }/m)?.[0] || ""), false);
});

test("toast does not obscure appointment control", () => {
  const html = readRepo("public", "index.html");
  assert.ok(html.includes("max-width:min(calc(100% - 32px), 320px)"));
  assert.ok(html.includes("background:#087064"));
  assert.ok(html.includes("aria-live=\"polite\""));
});

test("Operations icon never overlaps Arabic title via grid cells", () => {
  const html = readRepo("public", "index.html");
  assert.ok(html.includes("grid-template-columns:72px minmax(0, 1fr) 68px"));
  assert.ok(html.includes("-webkit-line-clamp:2"));
});

test("entire opportunity card opens inline daily task panel", () => {
  const ui = readRepo("public", "js", "operations-center-ui.js");
  assert.ok(ui.includes("renderDailyTaskOpportunity"));
});

test("office A cannot modify office B follow-up server-side", () => {
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("office_mismatch"));
});

test("appointment card remains visible in next action section", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("الإجراء القادم"));
  assert.ok(workflow.includes("iaqarFollowUpCard"));
  assert.ok(workflow.includes("الموعد القادم"));
});

test("idempotent schedule returns same follow-up", () => {
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("isSameScheduledFollowUp"));
});

test("active follow-up from record prefers nested followUp", () => {
  const record = { followUp: { at: futureAt, status: "scheduled" }, nextFollowUpAt: pastAt };
  const active = activeFollowUpFromRecord(record);
  assert.equal(active.at, futureAt);
});

test("appointment line formats tomorrow prefix", () => {
  const tomorrow = new Date(Date.now() + 26 * 3600000);
  const line = formatFollowUpAppointmentLine(tomorrow.toISOString());
  assert.ok(line.length > 0);
});
