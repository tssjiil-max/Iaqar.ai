// Office OS — viewing outcomes and deal documents through the real Worker (in-memory Firestore).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { VIEWING_RESULTS, effectOfViewingResult, viewingResultOf } from "../public/os/domain/journey-domain.js";
import { PHASE, journeyPhase, phaseInfo } from "../public/os/domain/deal-flow-domain.js";
import {
  DOC_STATUS, MAX_CUSTOM_DOCUMENTS, dealKindOf, documentChecklist, documentSummary, documentSummaryText, documentTemplate, prepareDocumentChange
} from "../public/os/domain/deal-documents-domain.js";
import { VIEWING_REMINDER_KIND, dueViewingReminders, viewingReminderCopy, viewingReminderSchedule } from "../worker/src/viewing-reminder-domain.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OWNER_A, BROKER_A2, OWNER_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());

async function call(route, body, uid) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const ACTIVE = ["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"];
const ops = (journeyId) => h.store.list(`offices/${OFFICE_A}/operations`).filter((op) => op.journeyId === journeyId && ACTIVE.includes(String(op.status)));
const journeyDoc = (id) => h.store.get(`offices/${OFFICE_A}/journeys/${id}`);
const events = (id) => h.store.list(`offices/${OFFICE_A}/journeys/${id}/events`);
let seq = 0;

/** A real approved deal (offer + request → match → approve), then a confirmed viewing in the past. */
async function dealWithPastViewing({ purpose = "SALE" } = {}) {
  seq += 1;
  const district = `حي الاختبار ${seq}`;
  const rent = purpose === "RENT";
  const offer = await call("/os/records/save", { officeId: OFFICE_A, requestKey: `vd-offer-${seq}`, record: { kind: "OFFER", purpose, propertyType: "شقة", city: "الرياض", district, price: rent ? 60000 : 900000, contactName: "مالك المعاينة", contactPhone: `05510${String(seq).padStart(5, "0")}` } }, OWNER_A);
  const request = await call("/os/records/save", { officeId: OFFICE_A, requestKey: `vd-req-${seq}`, record: { kind: "REQUEST", purpose: rent ? "LEASE_REQUEST" : "PURCHASE", propertyType: "شقة", city: "الرياض", district, price: rent ? 65000 : 950000, contactName: "عميل المعاينة", contactPhone: `05520${String(seq).padStart(5, "0")}` } }, OWNER_A);
  const review = h.store.list(`offices/${OFFICE_A}/operations`).find((op) => op.type === "MATCH_REVIEW" && op.offerId === offer.body.recordId && op.requestId === request.body.recordId && op.status === "OPEN");
  assert.ok(review, "match review task exists");
  const approved = await call("/os/review/decide", { officeId: OFFICE_A, matchId: review.matchId, decision: "approve" }, OWNER_A);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const journeyId = approved.body.journeyId;
  const at = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  h.store.patch(`offices/${OFFICE_A}/journeys/${journeyId}`, { stage: "VIEWING", viewing: { state: "CONFIRMED", at, confirmedAt: at, confirmedBy: OWNER_A } });
  return { journeyId, at, offerId: offer.body.recordId, requestId: request.body.recordId };
}

test("six viewing answers, each with a fixed effect", () => {
  assert.deepEqual(VIEWING_RESULTS.map((r) => r.label), ["مناسب", "يحتاج تفاوض", "معاينة أخرى", "لم يحضر", "لا يوجد رد", "غير مناسب"]);
  assert.equal(new Set(VIEWING_RESULTS.map((r) => r.id)).size, 6);
  assert.equal(effectOfViewingResult("interested").next, "AGREEMENT_FOLLOW_UP");
  assert.equal(effectOfViewingResult("needs_negotiation").next, "REOPEN_PRICE");
  assert.equal(effectOfViewingResult("not_suitable").next, "CLOSE_MATCH");
  assert.deepEqual(effectOfViewingResult("another_viewing"), { stage: "VIEWING", next: "RESCHEDULE_VIEWING" });
  assert.deepEqual(effectOfViewingResult("no_show"), { stage: "VIEWING", next: "RESCHEDULE_VIEWING" });
  assert.deepEqual(effectOfViewingResult("no_response"), { stage: "VIEWING", next: "FOLLOW_UP_RESULT", followUpInDays: 2 });
  assert.equal(effectOfViewingResult("anything_else"), null);
  assert.equal(viewingResultOf("no_show").label, "لم يحضر");
});

test("phase: a requested re-viewing is «تحديد موعد» in the viewing stage, whatever the price state", () => {
  const base = { status: "ACTIVE", stage: "VIEWING", offerSummary: { priceStatus: "NEGOTIABLE" } };
  assert.equal(journeyPhase({ ...base, viewing: { state: "NONE", rescheduleRequested: true } }), PHASE.VIEWING_SCHEDULING);
  assert.equal(journeyPhase({ ...base, viewing: { state: "NONE" } }), PHASE.PRICE_NEGOTIATION, "without the request nothing changes");
  assert.equal(journeyPhase({ ...base, viewing: { state: "PROPOSED", at: new Date().toISOString() } }), PHASE.VIEWING_SCHEDULING);
  assert.equal(phaseInfo(PHASE.VIEWING_SCHEDULING).step, 3);
  const past = new Date(Date.now() - 3 * 3600e3).toISOString();
  assert.equal(journeyPhase({ ...base, viewing: { state: "CONFIRMED", at: past, followUp: { result: "no_response" } } }), PHASE.VIEWING_RESULT, "«لا يوجد رد» keeps the result pending");
});

test("«لا يوجد رد»: the viewing is not marked done; the result task returns after two days", async () => {
  const deal = await dealWithPastViewing();
  const res = await call("/os/journeys/viewing/result", { officeId: OFFICE_A, journeyId: deal.journeyId, result: "no_response", note: "اتصلت ولم يرد" }, OWNER_A);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const journey = journeyDoc(deal.journeyId);
  assert.equal(journey.status, "ACTIVE");
  assert.equal(journey.viewing.state, "CONFIRMED", "no result was decided");
  assert.equal(journey.viewing.followUp.result, "no_response");
  assert.equal(journey.viewing.followUp.count, 1);
  assert.equal(journey.phase, PHASE.VIEWING_RESULT);
  const task = ops(deal.journeyId).find((op) => op.type === "VIEWING_RESULT");
  assert.ok(task, "the result task stays open");
  const dueIn = new Date(task.dueAt).getTime() - Date.now();
  assert.ok(dueIn > 47 * 3600e3 && dueIn < 49 * 3600e3, `due in ~2 days (${Math.round(dueIn / 3600e3)}h)`);
  assert.ok(events(deal.journeyId).some((e) => e.type === "VIEWING_RESULT" && e.text.includes("لا يوجد رد") && e.text.includes("اتصلت ولم يرد")));
  // The real answer can still be recorded afterwards.
  const final = await call("/os/journeys/viewing/result", { officeId: OFFICE_A, journeyId: deal.journeyId, result: "interested" }, OWNER_A);
  assert.equal(final.status, 200);
  assert.equal(journeyDoc(deal.journeyId).viewing.state, "DONE");
  assert.equal(journeyDoc(deal.journeyId).stage, "AGREEMENT");
  assert.equal(ops(deal.journeyId).filter((op) => op.type === "VIEWING_RESULT").length, 0);
});

for (const [result, reason] of [["another_viewing", "مطلوب معاينة أخرى"], ["no_show", "لم يحضر أحد الطرفين"]]) {
  test(`«${viewingResultOf(result).label}»: the deal stays open in the viewing stage and asks for a new time`, async () => {
    const deal = await dealWithPastViewing();
    const res = await call("/os/journeys/viewing/result", { officeId: OFFICE_A, journeyId: deal.journeyId, result }, OWNER_A);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const journey = journeyDoc(deal.journeyId);
    assert.equal(journey.status, "ACTIVE", "the deal is not closed");
    assert.equal(journey.stage, "VIEWING");
    assert.equal(journey.viewing.state, "NONE");
    assert.equal(journey.viewing.rescheduleRequested, true);
    assert.equal(journey.viewing.previous.result, result);
    assert.equal(journey.viewing.previous.at, deal.at, "the previous appointment is kept in the history");
    assert.equal(journey.viewing.attempts, 2);
    assert.equal(journey.phase, PHASE.VIEWING_SCHEDULING);
    const open = ops(deal.journeyId);
    assert.equal(open.filter((op) => op.type === "VIEWING_RESULT").length, 0, "the old result task is finished");
    const next = open.find((op) => op.type === "SEND_PROPOSAL");
    assert.ok(next, "a task asks for the new time");
    assert.ok(JSON.stringify(next).includes(reason));
    const card = open.find((op) => op.type === "DEAL_JOURNEY");
    assert.equal(card.journeyStep, 3, "the deal card shows the viewing stage");
    assert.equal(card.journeyPhase, PHASE.VIEWING_SCHEDULING);
    const replay = await call("/os/journeys/viewing/result", { officeId: OFFICE_A, journeyId: deal.journeyId, result }, OWNER_A);
    assert.equal(replay.body.changed, false, "a repeated press changes nothing");
    assert.equal(events(deal.journeyId).filter((e) => e.type === "VIEWING_RESULT").length, 1);
    for (const id of [deal.offerId, deal.requestId]) assert.equal(h.store.get(`offices/${OFFICE_A}/opportunities/${id}`).lifecycleStatus, "ACTIVE", "the records stay available");
  });
}

test("viewing results are office-scoped and validated", async () => {
  const deal = await dealWithPastViewing();
  assert.equal((await call("/os/journeys/viewing/result", { officeId: OFFICE_A, journeyId: deal.journeyId, result: "no_show" }, OWNER_B)).status, 403);
  assert.equal((await call("/os/journeys/viewing/result", { officeId: OFFICE_A, journeyId: deal.journeyId, result: "made_up" }, OWNER_A)).status, 400);
  assert.equal(journeyDoc(deal.journeyId).viewing.state, "CONFIRMED");
});

test("reminders: ten minutes before the viewing, in addition to 2h and 30m", () => {
  const at = "2026-10-10T15:00:00.000Z";
  const schedule = viewingReminderSchedule(at);
  assert.deepEqual(schedule.map((s) => s.kind), ["2h", "30m", "10m", "overdue"]);
  assert.equal(schedule.find((s) => s.kind === VIEWING_REMINDER_KIND.TEN_MINUTES).at, "2026-10-10T14:50:00.000Z");
  const match = { appointmentAt: at, appointmentStatus: "CONFIRMED_BY_BROKER" };
  assert.deepEqual(dueViewingReminders(match, new Date("2026-10-10T14:52:00.000Z"), 5).map((r) => r.kind), ["10m"]);
  assert.deepEqual(dueViewingReminders(match, new Date("2026-10-10T14:40:00.000Z"), 5).map((r) => r.kind), []);
  assert.deepEqual(dueViewingReminders({ ...match, viewingOutcome: "done" }, new Date("2026-10-10T14:52:00.000Z"), 5), []);
  assert.match(viewingReminderCopy("10m").title, /10 دقائق/);
});

test("documents domain: template by purpose, summary over required items only", () => {
  const sale = { offerSummary: { purpose: "SALE" } };
  const rent = { offerSummary: { purpose: "RENT" } };
  assert.equal(dealKindOf(sale), "sale");
  assert.equal(dealKindOf(rent), "rent");
  assert.equal(dealKindOf({ requestSummary: { purpose: "LEASE_REQUEST" } }), "rent");
  assert.ok(documentTemplate(sale).some((d) => d.id === "sale_contract") && !documentTemplate(sale).some((d) => d.id === "lease_contract"));
  assert.ok(documentTemplate(rent).some((d) => d.id === "lease_contract") && !documentTemplate(rent).some((d) => d.id === "sale_contract"));
  const empty = documentSummary(documentChecklist(sale));
  assert.deepEqual([empty.required, empty.present, empty.missing, empty.reviewed, empty.complete], [5, 0, 5, 0, false]);
  const journey = { ...sale, documents: {
    title_deed: { status: "REVIEWED" }, owner_id: { status: "RECEIVED" }, buyer_id: { status: "NOT_REQUIRED" }, deposit_receipt: { status: "RECEIVED" },
    custom_abc123: { status: "MISSING", label: "وكالة شرعية", custom: true }, "bad id": { status: "RECEIVED", label: "x" }
  } };
  const rows = documentChecklist(journey);
  assert.equal(rows.at(-1).label, "وكالة شرعية");
  assert.equal(rows.some((r) => r.id === "bad id"), false, "malformed ids are ignored");
  const summary = documentSummary(rows);
  assert.deepEqual([summary.required, summary.present, summary.missing, summary.reviewed], [5, 2, 3, 1], "optional and not-required items are not counted; the own item is");
  assert.deepEqual(summary.missingLabels, ["عقد الوساطة", "عقد البيع (المبايعة)", "وكالة شرعية"]);
  assert.equal(documentSummaryText(summary), "المطلوب 5 · الموجود 2 · الناقص 3 · تمت مراجعته 1");
  const done = documentSummary(documentChecklist({ ...sale, documents: Object.fromEntries(documentTemplate(sale).map((d) => [d.id, { status: "REVIEWED" }])) }));
  assert.equal(done.complete && done.allReviewed, true);
});

test("documents domain: changes are validated", () => {
  const journey = { offerSummary: { purpose: "SALE" }, documents: { custom_abc123: { status: "MISSING", label: "وكالة شرعية", custom: true } } };
  const now = new Date("2026-10-05T10:00:00Z");
  const ok = prepareDocumentChange(journey, { documentId: "title_deed", status: "received", note: "  أصل الصك  " }, { now, actorUid: "u1" });
  assert.deepEqual([ok.ok, ok.entry.status, ok.entry.note, ok.entry.updatedBy, ok.label], [true, "RECEIVED", "أصل الصك", "u1", "صك الملكية"]);
  assert.equal(prepareDocumentChange(journey, { documentId: "title_deed", status: "DONE" }).ok, false);
  assert.equal(prepareDocumentChange(journey, { documentId: "lease_contract", status: "RECEIVED" }).ok, false, "a rent document is not part of a sale");
  assert.equal(prepareDocumentChange(journey, { documentId: "title_deed", remove: true }).ok, false, "template items cannot be removed");
  assert.equal(prepareDocumentChange(journey, { documentId: "custom_abc123", remove: true }).remove, true);
  assert.equal(prepareDocumentChange(journey, { label: "x" }, { newId: "custom_zzzzzz" }).ok, false);
  assert.equal(prepareDocumentChange(journey, { label: "صك الملكية" }, { newId: "custom_zzzzzz" }).ok, false, "no duplicate of a template item");
  assert.equal(prepareDocumentChange(journey, { label: "وكالة شرعية" }, { newId: "custom_zzzzzz" }).ok, false, "no duplicate own item");
  assert.equal(prepareDocumentChange(journey, { label: "مخطط الأرض" }, { newId: "../x" }).ok, false);
  const added = prepareDocumentChange(journey, { label: "مخطط الأرض" }, { now, newId: "custom_zzzzzz" });
  assert.deepEqual([added.ok, added.id, added.entry.status, added.entry.custom], [true, "custom_zzzzzz", "MISSING", true]);
  const full = { offerSummary: { purpose: "SALE" }, documents: Object.fromEntries(Array.from({ length: MAX_CUSTOM_DOCUMENTS }, (_, i) => [`custom_${String(i).padStart(6, "0")}`, { status: "MISSING", label: `م ${i}`, custom: true }])) };
  assert.equal(prepareDocumentChange(full, { label: "زيادة" }, { newId: "custom_zzzzzz" }).ok, false);
  assert.equal(Object.values(DOC_STATUS).length, 4);
});

test("documents through the Worker: update, own items, history, and the state kept at closing", async () => {
  const deal = await dealWithPastViewing();
  await call("/os/journeys/viewing/result", { officeId: OFFICE_A, journeyId: deal.journeyId, result: "interested" }, OWNER_A);
  const set = (body, uid = OWNER_A) => call("/os/journeys/documents", { officeId: OFFICE_A, journeyId: deal.journeyId, ...body }, uid);
  const first = await set({ documentId: "title_deed", status: "RECEIVED", note: "أصل الصك" });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.summary, { required: 5, present: 1, missing: 4, reviewed: 0, complete: false });
  assert.equal((await set({ documentId: "title_deed", status: "RECEIVED", note: "أصل الصك" })).body.changed, false, "a repeated save changes nothing");
  await set({ documentId: "title_deed", status: "REVIEWED" });
  assert.equal(journeyDoc(deal.journeyId).documents.title_deed.note, "أصل الصك", "the note is kept when only the status changes");
  await set({ documentId: "owner_id", status: "RECEIVED" });
  await set({ documentId: "buyer_id", status: "NOT_REQUIRED" });
  const added = await set({ label: "وكالة شرعية" });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.match(added.body.documentId, /^custom_[a-z0-9]{16}$/);
  assert.equal((await set({ label: "وكالة شرعية" })).status, 400, "the same own item is not added twice");
  const removed = await set({ documentId: added.body.documentId, remove: true });
  assert.equal(removed.status, 200);
  assert.equal(journeyDoc(deal.journeyId).documents[added.body.documentId], undefined);

  assert.equal((await set({ documentId: "title_deed", status: "MISSING" }, OWNER_B)).status, 403, "another office cannot touch the deal");
  assert.equal((await set({ documentId: "nope", status: "RECEIVED" })).status, 400);
  assert.equal((await set({ documentId: "title_deed", status: "WHATEVER" })).status, 400);
  assert.equal((await call("/os/journeys/documents", { officeId: OFFICE_A, journeyId: deal.journeyId, documentId: "title_deed", status: "MISSING" })).status, 401);

  const journey = journeyDoc(deal.journeyId);
  assert.equal(journey.documents.title_deed.status, "REVIEWED");
  assert.equal(journey.documents.title_deed.updatedBy, OWNER_A);
  const summary = documentSummary(documentChecklist(journey));
  assert.deepEqual([summary.required, summary.present, summary.missing, summary.reviewed], [4, 2, 2, 1]);
  const docEvents = events(deal.journeyId).filter((e) => e.type === "DOCUMENT_UPDATED");
  assert.ok(docEvents.length >= 6, "every change is on the deal's timeline");
  assert.ok(docEvents.some((e) => e.text.includes("صك الملكية") && e.text.includes("تمت المراجعة")));
  assert.equal(ops(deal.journeyId).filter((op) => op.type === "DEAL_JOURNEY")[0].journeyStep, 4, "the deal sits in «مستندات»");
  assert.ok(h.store.list(`offices/${OFFICE_A}/auditLogs`).some((e) => e.action === "DEAL_DOCUMENT_UPDATED" && e.entityId === deal.journeyId));

  const won = await call("/os/journeys/close", { officeId: OFFICE_A, journeyId: deal.journeyId, outcome: "WON", finalPrice: 880000 }, OWNER_A);
  assert.equal(won.status, 200, JSON.stringify(won.body));
  const closed = journeyDoc(deal.journeyId);
  assert.equal(closed.status, "CLOSED_WON");
  assert.deepEqual([closed.outcome.documents.required, closed.outcome.documents.present, closed.outcome.documents.missing], [4, 2, 2], "the documents state at closing is kept with the outcome");
  assert.deepEqual(closed.outcome.documents.missingLabels, ["عقد الوساطة", "عقد البيع (المبايعة)"]);
  assert.ok(events(deal.journeyId).some((e) => e.type === "CLOSED_WON" && e.text.includes("مستندات ناقصة عند الإتمام: 2")));
  assert.equal(closed.documents.title_deed.status, "REVIEWED", "the checklist stays with the closed deal");
  assert.equal((await set({ documentId: "owner_id", status: "REVIEWED" })).status, 409, "a closed deal's documents are read-only");
  assert.ok(h.store.list(`offices/${OFFICE_A}/auditLogs`).some((e) => e.action === "DEAL_CLOSED" && e.entityId === deal.journeyId));
});

test("a broker who is not assigned to the deal cannot change its documents", async () => {
  const deal = await dealWithPastViewing({ purpose: "RENT" });
  assert.equal(journeyDoc(deal.journeyId).assignedBrokerId, OWNER_A);
  const other = await call("/os/journeys/documents", { officeId: OFFICE_A, journeyId: deal.journeyId, documentId: "lease_contract", status: "RECEIVED" }, BROKER_A2);
  assert.equal(other.status, 403);
  const mine = await call("/os/journeys/documents", { officeId: OFFICE_A, journeyId: deal.journeyId, documentId: "lease_contract", status: "RECEIVED" }, OWNER_A);
  assert.equal(mine.status, 200, "a rent deal uses the rent template");
  assert.equal((await call("/os/journeys/documents", { officeId: OFFICE_A, journeyId: deal.journeyId, documentId: "sale_contract", status: "RECEIVED" }, OWNER_A)).status, 400);
});

test("screens: the workspace shows the checklist and names missing documents before closing", () => {
  const view = fs.readFileSync(path.join(ROOT, "public/os/views/workspace.js"), "utf8");
  assert.match(view, /documentsCard\(journey\),/);
  assert.match(view, /"\/os\/journeys\/documents"/);
  assert.match(view, /إتمام الصفقة مع مستندات ناقصة؟/);
  assert.match(view, /disabled: open \? null : true/, "read-only once the deal is closed");
  for (const next of ["RESCHEDULE_VIEWING", "FOLLOW_UP_RESULT", "REOPEN_PRICE", "CLOSE_MATCH"]) assert.match(view, new RegExp(`${next}:`), `next-step text for ${next}`);
});
