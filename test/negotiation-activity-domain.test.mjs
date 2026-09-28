import test from "node:test";
import assert from "node:assert/strict";
import {
  NEGOTIATION_ACTIVITY_KIND,
  appendNegotiationActivity,
  buildNegotiationActivityEntry,
  negotiationActivityLogRow,
  parseNegotiationActivity,
  partyNegotiationChoices,
  summarizeNegotiationActivity
} from "../public/js/negotiation-activity-domain.js";

const at = (minute) => new Date(Date.UTC(2026, 8, 29, 10, minute));
const entry = (input, minute, context = { propertyType: "شقة" }) => {
  const built = buildNegotiationActivityEntry(input, { ...context, now: at(minute), id: `na_${minute}` });
  assert.equal(built.ok, true, JSON.stringify(built));
  return built.entry;
};

test("party options keep interest plus the property-type topics", () => {
  const apartment = partyNegotiationChoices({ propertyType: "شقة" }).map((choice) => choice.label);
  for (const label of ["مهتم", "غير مهتم", "السعر", "التجهيزات", "شرط آخر", "معاينة أخرى"]) {
    assert.ok(apartment.includes(label), label);
  }
  const land = partyNegotiationChoices({ propertyType: "أرض" }).map((choice) => choice.label);
  assert.ok(land.includes("شروط الصفقة"));
  assert.ok(!land.includes("التجهيزات"));
  assert.ok(land.includes("مهتم") && land.includes("غير مهتم"));
});

test("repeated client and owner sends are all logged and never lock", () => {
  let log = [];
  for (const [party, minute] of [["client", 1], ["client", 2], ["owner", 3], ["owner", 4]]) {
    log = appendNegotiationActivity(log, entry({ kind: "party_send", party }, minute));
  }
  const summary = summarizeNegotiationActivity(log);
  assert.equal(summary.clientSendCount, 2);
  assert.equal(summary.ownerSendCount, 2);
  assert.equal(log.length, 4);
});

test("party option: latest choice per party wins; labels come from the catalog", () => {
  let log = [];
  log = appendNegotiationActivity(log, entry({ kind: "party_choice", party: "client", choiceId: "interested", label: "HACK" }, 1));
  log = appendNegotiationActivity(log, entry({ kind: "party_choice", party: "client", choiceId: "not_interested" }, 2));
  log = appendNegotiationActivity(log, entry({ kind: "party_choice", party: "owner", choiceId: "equipment" }, 3));
  const summary = summarizeNegotiationActivity(log);
  assert.deepEqual([summary.clientChoice.id, summary.clientChoice.label], ["not_interested", "غير مهتم"]);
  assert.deepEqual([summary.ownerChoice.id, summary.ownerChoice.label], ["equipment", "التجهيزات"]);
  assert.equal(log[0].label, "مهتم");
  assert.equal(buildNegotiationActivityEntry({ kind: "party_choice", party: "client", choiceId: "equipment" }, { propertyType: "أرض" }).error, "choice_invalid");
  assert.equal(buildNegotiationActivityEntry({ kind: "party_choice", party: "both", choiceId: "interested" }).error, "party_invalid");
});

test("broker messages go to client, owner or both; internal notes are separate", () => {
  const client = entry({ kind: "broker_message", party: "client", message: "أولى" }, 1);
  const owner = entry({ kind: "broker_message", audience: "owner", message: "للمالك" }, 2);
  const both = entry({ kind: "broker_message", party: "both", message: "للطرفين" }, 3);
  const note = entry({ kind: "internal_note", party: "client", message: "سرية" }, 4);
  assert.deepEqual([client.party, owner.party, both.party], ["client", "owner", "both"]);
  assert.equal(note.kind, NEGOTIATION_ACTIVITY_KIND.INTERNAL_NOTE);
  assert.equal(note.party, "internal", "an internal note never targets a party");
  assert.equal(buildNegotiationActivityEntry({ kind: "broker_message", party: "internal", message: "x" }).error, "audience_invalid");
  assert.equal(buildNegotiationActivityEntry({ kind: "broker_message", party: "client", message: "   " }).error, "message_required");
  assert.equal(buildNegotiationActivityEntry({ kind: "internal_note", message: "" }).error, "message_required");
  const summary = summarizeNegotiationActivity([client, owner, both, note]);
  assert.equal(summary.messageCount, 3);
  assert.equal(summary.internalNoteCount, 1);
});

test("log rows carry recipient, time and status with no undefined text", () => {
  const rows = [
    entry({ kind: "party_send", party: "client" }, 1),
    entry({ kind: "party_choice", party: "owner", choiceId: "another_viewing" }, 2),
    entry({ kind: "broker_message", party: "both", message: "موعد" }, 3),
    entry({ kind: "internal_note", message: "داخلية" }, 4)
  ].map(negotiationActivityLogRow);
  assert.deepEqual(rows.map((row) => row.recipient), ["العميل", "المالك", "الطرفان", "داخلي"]);
  assert.deepEqual(rows.map((row) => row.statusLabel), ["تم فتح واتساب", "تم التسجيل", "ظاهرة في رابط الطرفين", "داخلية — لا تُرسل لأي طرف"]);
  assert.ok(rows.every((row) => row.createdAt.startsWith("2026-09-29T10:0")));
  assert.equal(JSON.stringify(rows).includes("undefined"), false);
});

test("activity parses from the persisted JSON, de-duplicates and stays bounded", () => {
  let log = [];
  for (let minute = 0; minute < 70; minute += 1) log = appendNegotiationActivity(log, entry({ kind: "party_send", party: "client" }, minute % 60));
  assert.equal(log.length, 60);
  const parsed = parseNegotiationActivity(JSON.stringify(log));
  assert.equal(parsed.length, 60);
  assert.deepEqual(parseNegotiationActivity("not json"), []);
  assert.deepEqual(parseNegotiationActivity([{ kind: "unknown" }]), []);
});
