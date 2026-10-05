// Office OS — managing a record (pause · resume · archive · restore · delete) through the real
// Worker on the in-memory Firestore double, plus the unified «العروض والطلبات» list rules.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { filterRecords, isPaused, recordState, recordView, RECORD_STATE_LABELS } from "../public/os/domain/records-domain.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());

async function call(route, body, uid) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const doc = (id) => h.store.get(`offices/${OFFICE_A}/opportunities/${id}`);
const audits = () => h.store.list(`offices/${OFFICE_A}/auditLogs`);
const offer = (key, extra = {}) => ({ officeId: OFFICE_A, requestKey: key, record: { kind: "OFFER", purpose: "SALE", propertyType: "فيلا", city: "الرياض", district: "النرجس", price: 2400000, contactName: "مالك الاختبار", contactPhone: "0551110000", ...extra } });

const ctx = {};

test("pause takes a record out of matching without deleting anything; resume brings it back", async () => {
  const saved = await call("/os/records/save", offer("mg-1"), OWNER_A);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  ctx.offerId = saved.body.recordId;
  const request = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "mg-req", record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "فيلا", city: "الرياض", district: "النرجس", price: 2500000, contactName: "عميل الاختبار", contactPhone: "0552220000" } }, OWNER_A);
  ctx.requestId = request.body.recordId;

  const paused = await call("/os/records/pause", { officeId: OFFICE_A, recordId: ctx.offerId }, OWNER_A);
  assert.equal(paused.status, 200, JSON.stringify(paused.body));
  assert.equal(paused.body.mode, "paused");
  const record = doc(ctx.offerId);
  assert.equal(record.lifecycleStatus, "ARCHIVED", "the matching engine already treats this lifecycle as inactive");
  assert.equal(record.archiveKind, "PAUSED");
  assert.ok(record.pausedAt);
  assert.equal(record.price, 2400000, "data untouched");
  assert.equal(recordState(record), "PAUSED");
  assert.equal(recordView(record).lifecycleLabel, "موقوف مؤقتًا");

  const candidates = await call("/os/records/candidates", { officeId: OFFICE_A, recordId: ctx.requestId }, OWNER_A);
  assert.ok(candidates.body.candidates.every((c) => c.recordId !== ctx.offerId), "a paused offer is not offered as a candidate");
  const again = await call("/os/records/pause", { officeId: OFFICE_A, recordId: ctx.offerId }, OWNER_A);
  assert.equal(again.body.duplicate, true, "pausing twice is a no-op");

  const resumed = await call("/os/records/restore", { officeId: OFFICE_A, recordId: ctx.offerId }, OWNER_A);
  assert.equal(resumed.status, 200);
  assert.equal(doc(ctx.offerId).lifecycleStatus, "ACTIVE");
  assert.equal(recordState(doc(ctx.offerId)), "ACTIVE");
  assert.equal(isPaused(doc(ctx.offerId)), false);
  const back = await call("/os/records/candidates", { officeId: OFFICE_A, recordId: ctx.requestId }, OWNER_A);
  assert.ok(back.body.candidates.some((c) => c.recordId === ctx.offerId), "a resumed offer matches again");
});

test("archive keeps the record and its history; restore returns it; delete still works afterwards", async () => {
  const saved = await call("/os/records/save", offer("mg-2", { district: "العارض", contactPhone: "0551110001" }), OWNER_A);
  const id = saved.body.recordId;
  const archived = await call("/os/records/archive", { officeId: OFFICE_A, recordId: id, reason: "المالك طلب التأجيل" }, OWNER_A);
  assert.equal(archived.body.mode, "archived");
  assert.equal(doc(id).archiveKind, "ARCHIVED");
  assert.equal(doc(id).archiveReason, "المالك طلب التأجيل");
  assert.equal(recordState(doc(id)), "ARCHIVED");
  const restored = await call("/os/records/restore", { officeId: OFFICE_A, recordId: id }, OWNER_A);
  assert.equal(restored.status, 200);
  assert.equal(recordState(doc(id)), "ACTIVE");
  await call("/os/records/pause", { officeId: OFFICE_A, recordId: id }, OWNER_A);
  const toArchive = await call("/os/records/archive", { officeId: OFFICE_A, recordId: id }, OWNER_A);
  assert.equal(toArchive.body.mode, "archived", "a paused record can be archived");
  assert.equal(recordState(doc(id)), "ARCHIVED");
  const removed = await call("/os/records/remove", { officeId: OFFICE_A, recordId: id }, OWNER_A);
  assert.equal(removed.body.mode, "deleted");
  assert.ok(doc(id).deletedAt, "soft delete: the document stays");
  const afterDelete = await call("/os/records/pause", { officeId: OFFICE_A, recordId: id }, OWNER_A);
  assert.equal(afterDelete.status, 409, "a deleted record cannot be paused");
});

test("a record inside an open deal cannot be paused or archived", async () => {
  const reviews = h.store.list(`offices/${OFFICE_A}/operations`).filter((op) => op.type === "MATCH_REVIEW" && op.offerId === ctx.offerId && op.status === "OPEN");
  assert.equal(reviews.length, 1, "the resumed offer has a review task");
  const approved = await call("/os/review/decide", { officeId: OFFICE_A, matchId: reviews[0].matchId, decision: "approve" }, OWNER_A);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  for (const route of ["/os/records/pause", "/os/records/archive"]) {
    const blocked = await call(route, { officeId: OFFICE_A, recordId: ctx.offerId }, OWNER_A);
    assert.equal(blocked.status, 409, route);
    assert.equal(blocked.body.error, "record_in_open_journey");
  }
  assert.equal(doc(ctx.offerId).lifecycleStatus, "ACTIVE", "nothing changed");
});

test("record management is office-scoped and needs a signed-in member", async () => {
  for (const route of ["/os/records/pause", "/os/records/archive"]) {
    assert.equal((await call(route, { officeId: OFFICE_A, recordId: ctx.requestId }, OWNER_B)).status, 403, `${route}: other office`);
    assert.equal((await call(route, { officeId: OFFICE_A, recordId: ctx.requestId })).status, 401, `${route}: no token`);
    assert.equal((await call(route, { officeId: OFFICE_B, recordId: ctx.requestId }, OWNER_B)).status, 404, `${route}: record of office A does not exist in office B`);
  }
  assert.equal(doc(ctx.requestId).lifecycleStatus, "ACTIVE");
});

test("every management action leaves an audit entry in the office's own trail", () => {
  const actions = audits().map((entry) => entry.action);
  for (const action of ["RECORD_CREATED", "RECORD_PAUSED", "RECORD_RESTORED", "RECORD_ARCHIVED", "RECORD_DELETED"]) assert.ok(actions.includes(action), action);
  for (const entry of audits()) {
    assert.equal(entry.officeId, OFFICE_A);
    assert.equal(entry.actorUid, OWNER_A);
    assert.equal(entry.entityType, "record");
    assert.ok(entry.entityId);
  }
  assert.equal(h.store.list(`offices/${OFFICE_B}/auditLogs`).length, 0, "nothing leaks into another office");
});

test("unified list: status filter tells paused from archived; deleted is never listed", () => {
  const base = { opportunityKind: "OFFER", purpose: "SALE", propertyType: "شقة", city: "الرياض", district: "العليا", price: 1 };
  const rows = [
    { id: "a", ...base },
    { id: "p", ...base, lifecycleStatus: "ARCHIVED", archiveKind: "PAUSED" },
    { id: "r", ...base, lifecycleStatus: "ARCHIVED", archiveKind: "ARCHIVED" },
    { id: "old", ...base, lifecycleStatus: "ARCHIVED" },
    { id: "d", ...base, lifecycleStatus: "DELETED" },
    { id: "q", ...base, opportunityKind: "REQUEST", purpose: "PURCHASE" }
  ];
  const ids = (status, extra = {}) => filterRecords(rows, { status, ...extra }).map((r) => r.id);
  assert.deepEqual(ids("ACTIVE"), ["a", "q"], "offers and requests are listed together");
  assert.deepEqual(ids("PAUSED"), ["p"]);
  assert.deepEqual(ids("ARCHIVED"), ["r", "old"], "records archived before this change stay archived");
  assert.deepEqual(ids("ALL"), ["a", "p", "r", "old", "q"]);
  assert.deepEqual(ids("ACTIVE", { kind: "REQUEST" }), ["q"]);
  assert.deepEqual(Object.keys(RECORD_STATE_LABELS), ["ACTIVE", "PAUSED", "ARCHIVED", "DELETED"]);
});

test("the repository screen has no section tabs; kind and «بلا مطابقة» are filters; the record page offers every action", () => {
  const repo = fs.readFileSync(path.join(ROOT, "public/os/views/repository.js"), "utf8");
  assert.doesNotMatch(repo, /جميع السجلات/, "no «جميع السجلات | العروض | الطلبات» sections");
  assert.doesNotMatch(repo, /class: "os-seg"/, "no segmented section control on the list");
  assert.match(repo, /"data-kind-label":view\.kind/, "each card carries its «عرض/طلب» label");
  assert.match(repo, /"data-repo-filters"/);
  assert.match(repo, /"data-tab": "UNMATCHED"/);
  const detail = fs.readFileSync(path.join(ROOT, "public/os/views/record-detail.js"), "utf8");
  for (const name of ["edit", "pause", "resume", "archive", "restore", "delete"]) assert.match(detail, new RegExp(`"${name}"`), `record action: ${name}`);
  const actions = fs.readFileSync(path.join(ROOT, "public/os/views/record-actions.js"), "utf8");
  assert.equal((actions.match(/await confirmDialog\(/g) || []).length, 3, "pause, archive and delete each ask for confirmation");
});
