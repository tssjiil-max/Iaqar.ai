import test from "node:test";
import assert from "node:assert/strict";
import { validateRecordInput, recordFields, filterRecords, missingForMatching, recordTitle } from "../public/os/domain/records-domain.js";
import { compatibilityLevel, compareRecords } from "../public/os/domain/match-review-domain.js";
import { filterTasks, sortTasks, taskCardModel, visibleToActor } from "../public/os/domain/task-domain.js";
import { buildProposalMessage, ensureLinkInMessage, proposalExpiry, validateProposalFields, validateReply, TEMPLATES } from "../public/os/domain/proposal-domain.js";
import { effectOfReply, effectOfViewingResult, stageProgress, allowedStageMoves, suggestNextStep } from "../public/os/domain/journey-domain.js";
import { whatsappDigits, buildWhatsAppUrl, parseRiyadhLocal, toRiyadhLocalInput, toNumber } from "../public/os/domain/format-domain.js";
import { canCloseDeal, canActOn } from "../worker/src/office-os/permissions.js";

const base = { kind: "OFFER", purpose: "SALE", propertyType: "شقة", city: "الرياض", district: "الملقا", price: "1,250,000", contactPhone: "0557654321" };

test("area is optional in validation, persistence and matching completeness", () => {
  const ok = validateRecordInput(base);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.area, null);
  const fields = recordFields(ok.value, { officeId: "o1", brokerId: "u1" });
  assert.equal(fields.area, null);
  assert.equal(fields.salePrice, 1250000);
  assert.equal(fields.advertiserRole, "OWNER");
  assert.equal(fields.contactPhone, "0557654321");
  assert.deepEqual(missingForMatching(fields), []);
  assert.equal(validateRecordInput({ ...base, area: "abc" }).errors.area !== undefined, true);
  assert.equal(validateRecordInput({ ...base, area: "0" }).ok, false);
  assert.equal(validateRecordInput({ ...base, area: "" }).ok, true);
});

test("purpose must fit the record kind; phone must be Saudi mobile; Arabic digits accepted", () => {
  assert.equal(validateRecordInput({ ...base, purpose: "PURCHASE" }).errors.purpose, "اختر الغرض");
  assert.ok(validateRecordInput({ ...base, contactPhone: "12345" }).errors.contactPhone);
  assert.equal(validateRecordInput({ ...base, price: "١٬٢٥٠٬٠٠٠" }).value.price, 1250000);
  assert.equal(toNumber("٨٥٠٠٠٠"), 850000);
  const request = validateRecordInput({ ...base, kind: "REQUEST", purpose: "LEASE_REQUEST", price: 60000 });
  const fields = recordFields(request.value, { officeId: "o1", brokerId: "u1" });
  assert.equal(fields.budget, 60000);
  assert.equal(fields.annualRent, 60000);
  assert.equal(fields.transactionType, "rent");
  assert.equal(recordTitle(fields), "طلب استئجار شقة في حي الملقا");
});

test("repository filters exclude deleted, respect kind/status/price/search", () => {
  const rows = [
    { id: "a", ...recordFields(validateRecordInput(base).value, { officeId: "o", brokerId: "u" }) },
    { id: "b", ...recordFields(validateRecordInput({ ...base, kind: "REQUEST", purpose: "PURCHASE", contactName: "أحمد" }).value, { officeId: "o", brokerId: "u" }) },
    { id: "c", ...recordFields(validateRecordInput(base).value, { officeId: "o", brokerId: "u" }), lifecycleStatus: "DELETED" },
    { id: "d", ...recordFields(validateRecordInput({ ...base, price: 500000 }).value, { officeId: "o", brokerId: "u" }), lifecycleStatus: "ARCHIVED" }
  ];
  assert.deepEqual(filterRecords(rows, {}).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(filterRecords(rows, { kind: "REQUEST" }).map((r) => r.id), ["b"]);
  assert.deepEqual(filterRecords(rows, { status: "ARCHIVED" }).map((r) => r.id), ["d"]);
  assert.deepEqual(filterRecords(rows, { status: "ALL" }).map((r) => r.id), ["a", "b", "d"]);
  assert.deepEqual(filterRecords(rows, { query: "احمد" }).map((r) => r.id), ["b"], "Arabic alef-normalized search");
  assert.deepEqual(filterRecords(rows, { query: "7654321" }).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(filterRecords(rows, { priceMax: 600000, status: "ALL" }).map((r) => r.id), ["d"]);
});

test("compatibility level comes only from the computed score", () => {
  assert.equal(compatibilityLevel(91).label, "توافق مرتفع");
  assert.equal(compatibilityLevel(72).label, "توافق جيد");
  assert.equal(compatibilityLevel(56).label, "توافق مبدئي");
  assert.equal(compatibilityLevel(10).label, "توافق ضعيف");
  const rows = compareRecords({ propertyType: "شقة", purpose: "SALE", district: "الملقا", price: 1250000 }, { propertyType: "شقة", purpose: "PURCHASE", district: "حي الملقا", budget: 1200000 });
  assert.equal(rows.find((r) => r.key === "location").state, "match");
  assert.equal(rows.find((r) => r.key === "price").state, "differ");
  assert.ok(!rows.some((r) => r.key === "area"), "area row only when someone has it");
});

test("daily tasks: overdue first, waiting separate, snoozed hidden until due, broker visibility", () => {
  const now = new Date("2026-09-30T09:00:00Z");
  const tasks = [
    { id: "wait", type: "AWAITING_REPLY", status: "WAITING_EXTERNAL_RESPONSE", createdAt: "2026-09-29T08:00:00Z", dueAt: "2026-10-01T08:00:00Z" },
    { id: "late", type: "VIEWING_RESULT", status: "OPEN", dueAt: "2026-09-29T12:00:00Z", assignedBrokerId: "u2" },
    { id: "new", type: "MATCH_REVIEW", status: "OPEN", createdAt: "2026-09-30T08:00:00Z" },
    { id: "snooze", type: "MATCH_REVIEW", status: "OPEN", snoozedUntil: "2026-10-03T00:00:00Z", dueAt: "2026-10-03T00:00:00Z" },
    { id: "done", type: "SEND_PROPOSAL", status: "COMPLETED" }
  ];
  assert.deepEqual(sortTasks(filterTasks(tasks, "all", now), now).map((t) => t.id), ["late", "new", "wait"]);
  assert.deepEqual(filterTasks(tasks, "waiting", now).map((t) => t.id), ["wait"]);
  assert.deepEqual(filterTasks(tasks, "today", now).map((t) => t.id).sort(), ["late", "new"]);
  assert.equal(taskCardModel(tasks[1], now).overdue, true);
  assert.equal(taskCardModel(tasks[2], now).button, "مراجعة المطابقة");
  assert.equal(visibleToActor(tasks[1], { uid: "u1", isManager: false }), false);
  assert.equal(visibleToActor(tasks[1], { uid: "u1", isManager: true }), true);
  assert.equal(visibleToActor(tasks[2], { uid: "u1", isManager: false }), true, "unassigned visible");
  for (const t of tasks) assert.notEqual(taskCardModel(t, now).button, "فتح المهمة");
});

test("proposal templates: fields, message, link once, reply validation, expiry", () => {
  for (const kind of Object.keys(TEMPLATES)) assert.ok(TEMPLATES[kind].replies.length >= 2, kind);
  assert.deepEqual(TEMPLATES.VIEWING.replies.map((r) => r.label), ["موافق", "غير مناسب", "اقترح موعدًا آخر"]);
  assert.deepEqual(TEMPLATES.PRICE.replies.map((r) => r.label), ["موافق مبدئيًا", "أقترح سعرًا آخر", "غير مناسب"]);
  const now = new Date("2026-09-30T09:00:00Z");
  assert.equal(validateProposalFields("PRICE", { price: "" }).ok, false);
  assert.equal(validateProposalFields("VIEWING", { viewingAt: "2026-09-01T10:00:00Z" }, { now }).ok, false, "past time rejected");
  const msg = buildProposalMessage({ kind: "PRICE", fields: { price: 1200000 }, recipientRole: "client", recipientName: "أحمد المطيري", officeName: "مكتب", brokerName: "سلطان", property: { propertyType: "شقة", district: "الملقا" } });
  assert.match(msg, /1,200,000 ريال/);
  assert.match(msg, /^مرحبًا أحمد،/);
  const link = "https://x.test/r#abc";
  assert.equal(ensureLinkInMessage(`${msg}\n${link}`, link).split(link).length, 2);
  assert.ok(ensureLinkInMessage("نص معدّل", link).endsWith(link));
  assert.equal(validateReply("PRICE", "counter", "").ok, false);
  assert.equal(validateReply("PRICE", "counter", "1,150,000").value, 1150000);
  assert.equal(validateReply("PRICE", "hack", "").ok, false);
  const viewingEnd = proposalExpiry("VIEWING", { viewingAt: "2026-10-01T15:00:00Z" }, now);
  assert.equal(viewingEnd.toISOString(), "2026-10-01T17:00:00.000Z");
  assert.equal(proposalExpiry("PRICE", {}, now).getTime() - now.getTime(), 7 * 86400000);
});

test("journey rules: accepted viewing ≠ done, results route next step, flexible stages", () => {
  assert.equal(effectOfReply("VIEWING_ACCEPTED", { fields: { viewingAt: "x" }, role: "client" }).next, "CONFIRM_VIEWING");
  assert.equal(effectOfReply("PRICE_ACCEPTED", {}).next, "REVIEW_REPLY");
  assert.equal(effectOfViewingResult("interested").stage, "AGREEMENT");
  assert.equal(effectOfViewingResult("needs_negotiation").stage, "NEGOTIATION");
  assert.equal(effectOfViewingResult("not_suitable").suggestClose, true);
  const skipped = stageProgress({ stage: "AGREEMENT", viewing: { state: "NONE" }, status: "ACTIVE" });
  assert.deepEqual(skipped.map((s) => s.state), ["done", "done", "skipped", "current"]);
  assert.deepEqual(allowedStageMoves({ stage: "AGREEMENT", status: "ACTIVE" }), ["NEGOTIATION", "VIEWING"]);
  assert.deepEqual(allowedStageMoves({ stage: "AGREEMENT", status: "CLOSED_WON" }), []);
  assert.ok(suggestNextStep({ status: "ACTIVE", stage: "NEGOTIATION" }).length > 5);
});

test("deal completion permission and assignment checks", () => {
  const manager = { uid: "m", isManager: true };
  const broker = { uid: "b", isManager: false };
  const journey = { assignedBrokerId: "b" };
  assert.equal(canCloseDeal(manager, journey, {}), true);
  assert.equal(canCloseDeal(broker, journey, {}), false);
  assert.equal(canCloseDeal(broker, journey, { brokerMayClose: true }), true);
  assert.equal(canCloseDeal({ uid: "x", isManager: false }, journey, { brokerMayClose: true }), false);
  assert.equal(canActOn({ uid: "x", isManager: false }, journey), false);
  assert.equal(canActOn({ uid: "x", isManager: false }, {}), true);
});

test("WhatsApp and Riyadh time helpers", () => {
  assert.equal(whatsappDigits("055 123 4567"), "966551234567");
  assert.equal(whatsappDigits("+966551234567"), "966551234567");
  assert.equal(whatsappDigits("0112345678"), "", "landlines are not WhatsApp mobiles");
  assert.equal(buildWhatsAppUrl("0551234567", "مرحبا"), "https://wa.me/966551234567?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7");
  assert.equal(parseRiyadhLocal("2026-10-01T17:00").toISOString(), "2026-10-01T14:00:00.000Z");
  assert.equal(toRiyadhLocalInput("2026-10-01T14:00:00.000Z"), "2026-10-01T17:00");
});
