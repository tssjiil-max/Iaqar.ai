// Office OS — unified search and the audit trail (pure rules).
import test from "node:test";
import assert from "node:assert/strict";
import { matchesQuery, normalizeSearch, searchOffice } from "../public/os/domain/search-domain.js";
import { auditEntryView, auditViews, filterAudit } from "../public/os/domain/audit-domain.js";

const records = [
  { id: "r1", opportunityKind: "OFFER", purpose: "SALE", propertyType: "فيلا", city: "الرياض", district: "النرجس", price: 2400000, contactName: "أحمد المالك", contactPhone: "0551112222", lifecycleStatus: "ACTIVE" },
  { id: "r2", opportunityKind: "REQUEST", purpose: "LEASE_REQUEST", propertyType: "شقة", city: "الرياض", district: "الملقا", priceOrBudget: 60000, contactName: "سارة", contactPhone: "0553334444", lifecycleStatus: "ACTIVE" },
  { id: "r3", opportunityKind: "OFFER", purpose: "SALE", propertyType: "أرض", city: "الرياض", district: "النرجس", lifecycleStatus: "DELETED" }
];
const tasks = [
  { id: "t1", type: "DEAL_JOURNEY", journeyId: "j1", journeyPhase: "VIEWING", titleText: "فيلا في حي النرجس", summaryText: "بانتظار المعاينة" },
  { id: "t2", type: "DEAL_JOURNEY", journeyId: "j1", journeyPhase: "VIEWING", titleText: "فيلا في حي النرجس", summaryText: "تذكير" }
];
const closed = [{ journeyId: "j9", status: "CLOSED_WON", offerSummary: { propertyType: "عمارة", city: "الرياض", district: "العليا" }, outcome: { finalPrice: 5200000 } }];
const documents = [{ id: "d1", documentTitle: "عقد وساطة حي النرجس", fileName: "contract.pdf", referenceNumber: "REF-77" }];
const messages = [{ id: "m1", channel: "telegram", messageText: "السلام عليكم هل الفيلا متوفرة", senderName: "خالد", processingState: "kept" }];

test("search normalises Arabic spelling and digits", () => {
  assert.equal(normalizeSearch("الإِيجَار"), normalizeSearch("الايجار"));
  assert.equal(normalizeSearch("شقة"), normalizeSearch("شقه"));
  assert.equal(normalizeSearch("٠٥٥"), "055");
  assert.equal(matchesQuery("فيلا في حي النرجس بالرياض", "النرجس فيلا"), true, "word order does not matter");
  assert.equal(matchesQuery("فيلا في حي النرجس", "النرجس شقة"), false, "every word must be found");
  assert.equal(matchesQuery("055 111 2222", "1112222"), true, "a phone is found whatever its spacing");
  assert.equal(matchesQuery("anything", "  "), false);
});

test("one query searches records, open deals, closed deals, documents and messages", () => {
  assert.equal(searchOffice({ query: "ا", records }).ready, false, "too short to search");
  const found = searchOffice({ query: "النرجس", records, tasks, closed, documents, messages });
  assert.equal(found.ready, true);
  const group = (id) => found.groups.find((g) => g.id === id);
  assert.deepEqual(group("records").items.map((item) => item.id), ["r1"], "a deleted record is not listed");
  assert.equal(group("records").items[0].route, "record/r1");
  assert.equal(group("deals").count, 1, "one deal is listed once even with several tasks");
  assert.equal(group("documents").items[0].route, "library");
  assert.equal(group("closed"), undefined);
  assert.equal(found.total, 3);

  assert.equal(searchOffice({ query: "0553334444", records }).groups[0].items[0].id, "r2");
  assert.equal(searchOffice({ query: "العليا", closed }).groups[0].items[0].route, "journey/j9");
  assert.equal(searchOffice({ query: "REF-77", documents }).total, 1);
  const message = searchOffice({ query: "متوفرة", messages }).groups[0];
  assert.equal(message.id, "messages");
  assert.equal(message.items[0].route, "inbox");
  assert.equal(searchOffice({ query: "لا شيء يطابق هذا", records, tasks, closed, documents, messages }).total, 0);
});

test("the audit trail reads as plain Arabic, newest first, with a link to the thing changed", () => {
  const entries = [
    { id: "a1", action: "RECORD_PAUSED", actorUid: "u1", entityType: "record", entityId: "r1", detailsJson: JSON.stringify({ reason: "المالك مسافر" }), createdAt: "2026-10-05T08:00:00Z" },
    { id: "a2", action: "DEAL_CLOSED", actorUid: "u2", entityType: "journey", entityId: "j9", detailsJson: JSON.stringify({ result: "WON" }), createdAt: "2026-10-05T10:00:00Z" },
    { id: "a3", action: "CHANNEL_UNLINKED", actorUid: "u1", entityType: "channel", entityId: "telegram", detailsJson: "{}", createdAt: "2026-10-05T09:00:00Z" },
    { id: "a4", action: "COOPERATION_REQUEST_ACCEPTED", actorUid: "", createdBySystem: true, detailsJson: "not json", createdAt: "2026-10-04T09:00:00Z" },
    { id: "a5", action: "SOMETHING_NEW", actorUid: "u9", createdAt: "2026-10-03T09:00:00Z" }
  ];
  const views = auditViews(entries, { memberNames: { u1: "سلطان", u2: "نواف" }, recordTitles: { r1: "عرض: فيلا في حي النرجس" } });
  assert.deepEqual(views.map((view) => view.id), ["a2", "a3", "a1", "a4", "a5"]);
  const byId = Object.fromEntries(views.map((view) => [view.id, view]));
  assert.equal(`${byId.a1.actor} ${byId.a1.text}`, "سلطان أوقف سجلًا مؤقتًا");
  assert.match(byId.a1.detail, /فيلا في حي النرجس/);
  assert.match(byId.a1.detail, /المالك مسافر/);
  assert.equal(byId.a1.route, "record/r1");
  assert.equal(byId.a2.detail, "تمت الصفقة");
  assert.equal(byId.a2.route, "journey/j9");
  assert.equal(byId.a3.detail, "تيليجرام");
  assert.equal(byId.a3.route, "settings/channels");
  assert.equal(byId.a4.actor, "النظام");
  assert.equal(byId.a4.group, "cooperation");
  assert.equal(byId.a5.text, "إجراء مسجَّل في النظام", "an unknown action is still listed");
  assert.equal(byId.a5.actor, "عضو في المكتب");
  assert.ok(views.every((view) => !/[A-Z]{3,}_/.test(`${view.text} ${view.detail}`)), "no internal code reaches the screen");
  assert.equal(filterAudit(views, "channel").length, 1);
  assert.equal(filterAudit(views, "deal").length, 1);
  assert.equal(filterAudit(views, "ALL").length, 5);
  assert.equal(auditEntryView({}).text, "إجراء مسجَّل في النظام");
  const deal = auditEntryView({ action: "DEAL_DOCUMENT_UPDATED", entityType: "deal", entityId: "j5", detailsJson: JSON.stringify({ label: "صك الملكية", status: "RECEIVED" }) });
  assert.equal(deal.route, "journey/j5", "deal entries open their deal");
  assert.equal(deal.group, "deal");
  assert.equal(deal.detail, "صك الملكية — موجود");
});
