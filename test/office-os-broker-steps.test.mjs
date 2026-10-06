// Fewer steps for the broker — one card per deal, «متابعة الصفقة», notifications list, and a
// library file linked to a deal document. Display rules are pure; the document link goes
// through the real Worker on the in-memory Firestore double.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { countGroupsByStep, dealIdOf, filterGroupsByStep, groupDealTasks, primaryTask, taskStateLabel, urgencyOf, worstUrgency } from "../public/os/domain/deal-card-domain.js";
import { FOLLOW_SECTIONS, activeSection, communicationLog, communicationOptions, followRoute, followSections, followSummary } from "../public/os/domain/deal-follow-domain.js";
import { notificationTarget, notificationViews, visibleNotifications } from "../public/os/domain/notifications-domain.js";
import { documentChecklist, linkedFile, prepareDocumentChange } from "../public/os/domain/deal-documents-domain.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());

const NOW = new Date("2026-10-06T09:00:00Z");
const iso = (minutes) => new Date(NOW.getTime() + minutes * 60000).toISOString();
const task = (id, type, extra = {}) => ({ id, type, status: "OPEN", createdAt: iso(-60), updatedAt: iso(-60), ...extra });

const TASKS = [
  task("card-1", "DEAL_JOURNEY", { journeyId: "j1", journeyStep: 2, journeyPhase: "PRICE_NEGOTIATION" }),
  task("reply-1", "PROPOSAL_REPLY", { journeyId: "j1", priority: "HIGH" }),
  task("ask-1", "SESSION_INTERVENTION", { journeyId: "j1", priority: "HIGH", updatedAt: iso(-5) }),
  task("wait-1", "AWAITING_REPLY", { journeyId: "j1", status: "WAITING_EXTERNAL_RESPONSE" }),
  task("card-2", "DEAL_JOURNEY", { journeyId: "j2", journeyStep: 3, journeyPhase: "VIEWING_RESULT" }),
  task("result-2", "VIEWING_RESULT", { journeyId: "j2", dueAt: iso(-120) }),
  task("card-3", "DEAL_JOURNEY", { journeyId: "j3", journeyStep: 3 }),
  task("wait-3", "AWAITING_REPLY", { metadataJson: JSON.stringify({ journeyId: "j3" }), status: "WAITING_EXTERNAL_RESPONSE" }),
  task("match-9", "MATCH_REVIEW", { matchId: "m9" }),
  task("record-8", "MISSING_DATA", { opportunityId: "o8" })
];

test("one card per deal; every task is kept and nothing is dropped", () => {
  const untouched = JSON.stringify(TASKS);
  const groups = groupDealTasks(TASKS, NOW);
  const deals = groups.filter((group) => group.kind === "deal");
  assert.deepEqual(deals.map((group) => group.id).sort(), ["j1", "j2", "j3"]);
  assert.equal(groups.filter((group) => group.kind === "task").length, 2, "tasks outside a deal keep their own card");
  const all = groups.flatMap((group) => (group.kind === "deal" ? group.tasks : [group.task]));
  assert.equal(all.length, TASKS.length, "every task is still there");
  assert.equal(new Set(all.map((item) => item.id)).size, TASKS.length, "and none is listed twice");
  const j1 = deals.find((group) => group.id === "j1");
  assert.equal(j1.tasks.length, 4);
  assert.deepEqual(j1.subtasks.map((item) => item.id).sort(), ["ask-1", "reply-1", "wait-1"], "the deal's other tasks stay inside its card");
  assert.equal(j1.card.id, "card-1");
  assert.equal(dealIdOf(TASKS[7]), "j3", "older tasks that carry the deal only in their metadata are grouped too");
  assert.equal(JSON.stringify(TASKS), untouched, "the tasks themselves are not changed by grouping");
});

test("the main button is the most pressing action; the rest stay reachable", () => {
  const groups = groupDealTasks(TASKS, NOW);
  const of = (id) => groups.find((group) => group.id === id);
  assert.equal(of("j2").primary.id, "result-2", "an overdue task that needs the broker comes first");
  assert.equal(of("j2").urgency.level, "late");
  assert.equal(of("j2").urgency.label, "متأخرة");
  assert.ok(["reply-1", "ask-1"].includes(of("j1").primary.id), "a task that needs the broker beats the deal card and a waiting task");
  assert.equal(of("j1").urgency.label, "مهم");
  assert.equal(of("j3").primary.id, "card-3", "with only a waiting task the main button opens the deal's current page");
  assert.equal(primaryTask([TASKS[7]], NOW).id, "wait-3", "a deal with nothing but a waiting task still has a button");
  assert.equal(groups[0].id, "j2", "the list keeps its order: the deal with the overdue task is first");
  assert.equal(taskStateLabel(TASKS[5], NOW), "متأخرة");
  assert.equal(taskStateLabel(TASKS[3], NOW), "بانتظار رد");
  assert.equal(taskStateLabel(TASKS[1], NOW), "مفتوحة");
  assert.equal(urgencyOf(TASKS[0], NOW).label, "");
  assert.equal(filterGroupsByStep(groups, null).length, groups.length);
});

test("a stage of the deal path never hides a task: a deal is listed under every stage its tasks sit in", () => {
  const groups = groupDealTasks(TASKS, NOW);
  const of = (id) => groups.find((group) => group.id === id);
  assert.equal(of("j1").step, 2, "the card shows the stage of the deal itself");
  assert.deepEqual(of("j1").steps, [1, 2], "…and also knows the stage of its waiting reply («تواصل»)");
  assert.deepEqual(of("j3").steps, [1, 3]);
  // Every task of the list is reachable from the stage it sits in.
  for (let step = 0; step < 5; step += 1) {
    const ids = new Set(filterGroupsByStep(groups, step).flatMap((group) => (group.kind === "deal" ? group.tasks : [group.task])).map((item) => item.id));
    for (const item of TASKS) if (groupDealTasks([item], NOW)[0].step === step) assert.ok(ids.has(item.id), `task ${item.id} is reachable under stage ${step}`);
  }
  assert.deepEqual(filterGroupsByStep(groups, 1).map((group) => group.id).sort(), ["j1", "j3"], "«تواصل» lists the deals that wait for a reply");
  assert.deepEqual(filterGroupsByStep(groups, 3).map((group) => group.id).sort(), ["j2", "j3"]);
  const counts = countGroupsByStep(groups);
  for (let step = 0; step < 5; step += 1) assert.equal(counts[step], filterGroupsByStep(groups, step).length, `the count of stage ${step} is what opening it shows`);
});

test("a late task or an appointment is never hidden behind another task of the same deal", () => {
  const tasks = [
    task("card-5", "DEAL_JOURNEY", { journeyId: "j5", journeyStep: 3, dueAt: iso(-90) }),
    task("ask-5", "SESSION_INTERVENTION", { journeyId: "j5", priority: "HIGH", updatedAt: iso(-2) })
  ];
  const group = groupDealTasks(tasks, NOW)[0];
  assert.equal(group.primary.id, "ask-5", "the side's request is still the main button");
  assert.equal(group.urgency.level, "late", "but the card says the deal has something late");
  assert.equal(group.dueTask.id, "card-5", "and shows that time");
  assert.equal(group.tasks.length, 2, "both tasks are listed inside the card");
  const calm = groupDealTasks([task("card-6", "DEAL_JOURNEY", { journeyId: "j6", dueAt: iso(600) }), task("ask-6", "SESSION_INTERVENTION", { journeyId: "j6" })], NOW)[0];
  assert.equal(calm.urgency.level, "");
  assert.equal(calm.dueTask.id, "card-6", "the deal's appointment shows even when the main task has no time");
  assert.equal(worstUrgency([task("a", "PROPOSAL_REPLY", { priority: "HIGH" }), task("b", "PROPOSAL_REPLY", { priority: "URGENT" })], NOW).level, "urgent");
});

test("«متابعة الصفقة» gathers the existing pages; it changes no route", () => {
  assert.deepEqual(FOLLOW_SECTIONS.map((section) => section.label), ["التفاوض", "المعاينة", "المستندات", "السجل", "الإغلاق"]);
  assert.equal(followRoute("j1", "negotiation"), "session/j1");
  assert.equal(followRoute("j1", "viewing"), "journey/j1?focus=viewing");
  assert.equal(followRoute("j1", "documents"), "journey/j1?focus=documents");
  assert.equal(followRoute("j1", "timeline"), "journey/j1?focus=timeline");
  assert.equal(followRoute("j1", "close"), "journey/j1?focus=close");
  assert.equal(activeSection("session"), "negotiation");
  assert.equal(activeSection("journey", "documents"), "documents");
  assert.equal(activeSection("journey", "VIEWING_RESULT"), "", "an old task link keeps working and marks no section");
  const journey = {
    journeyId: "j1", status: "ACTIVE", stage: "NEGOTIATION", offerSummary: { propertyType: "شقة", purpose: "SALE", price: 900000 },
    session: { requests: [{ id: "r1", role: "client", kind: "intervention", status: "OPEN" }], intervention: { required: true, by: "client" } },
    currentAction: { label: "فتح التفاوض", reason: "بانتظار رد العميل" }
  };
  const before = JSON.stringify(journey);
  const sections = followSections(journey, { events: [{ id: "e1", type: "MATCH_APPROVED", text: "x", at: iso(-10) }], now: NOW });
  assert.equal(sections.length, 5);
  const by = Object.fromEntries(sections.map((section) => [section.id, section]));
  assert.match(by.negotiation.status, /طلب واحد للوسيط/);
  assert.equal(by.negotiation.attention, true);
  assert.equal(by.viewing.status, "لم يُحدَّد موعد بعد");
  assert.match(by.documents.status, /المطلوب 5 · الموجود 0 · الناقص 5/);
  assert.match(by.timeline.status, /^1 حركة/);
  assert.match(by.close.status, /الصفقة مفتوحة/);
  const summary = followSummary(journey, NOW);
  assert.equal(summary.stage, "تفاوض");
  assert.equal(summary.nextLabel, "فتح التفاوض");
  assert.equal(JSON.stringify(journey), before, "reading the deal for this page changes nothing in it");
  const closed = followSummary({ ...journey, status: "CLOSED_WON" }, NOW);
  assert.equal(closed.open, false);
  assert.equal(closed.stage, "تمت الصفقة");
});

test("both existing ways to reach the sides are named, and the log only claims what the system knows", () => {
  const options = communicationOptions({ journeyId: "j1", sessionLinks: { owner: { hash: "x" } }, session: { opened: { client: "2026-10-06T08:00:00Z" } }, activeProposals: { p1: {} } });
  assert.deepEqual(options.map((option) => option.label), ["غرفة التفاوض", "إرسال مقترح"]);
  assert.equal(options[0].route, "session/j1");
  assert.equal(options[1].route, "journey/j1?focus=compose");
  assert.match(options[0].state, /المالك: الرابط جاهز ولم يُفتح/);
  assert.match(options[0].state, /العميل: فتح رابطه/);
  assert.match(options[1].state, /^يوجد مقترح قائم/);
  assert.match(communicationOptions({ journeyId: "j1" })[1].state, /^لا يوجد مقترح قائم/);
  assert.match(options[0].what, /ترسل الرابط بنفسك/, "the room option says the broker sends the link himself");
  assert.match(options[1].what, /ترسلها أنت/, "the proposal option says the broker sends it himself");
  const log = communicationLog([
    { id: "1", type: "PROPOSAL_CREATED", text: "تم تجهيز مقترح", at: iso(-50) },
    { id: "2", type: "WHATSAPP_OPENED", text: "تم فتح واتساب", at: iso(-40) },
    { id: "3", type: "SESSION_OPENED", text: "فتح العميل الرابط", at: iso(-30) },
    { id: "4", type: "PARTY_REPLY", text: "وصل رد", at: iso(-20) },
    { id: "5", type: "STAGE_CHANGED", text: "تغيّرت المرحلة", at: iso(-10) },
    { id: "6", type: "SESSION_MOVE", actorRole: "client", text: "خفّض العميل عرضه", at: iso(-8) },
    { id: "7", type: "SESSION_MOVE", actorRole: "broker", text: "حركة من الوسيط", at: iso(-7) },
    { id: "8", type: "CALL_OUTCOME", text: "اتصل الوسيط", at: iso(-6) }
  ]);
  assert.deepEqual(log.map((item) => item.type), ["CALL_OUTCOME", "SESSION_MOVE", "PARTY_REPLY", "SESSION_OPENED", "WHATSAPP_OPENED", "PROPOSAL_CREATED"], "only contact steps, newest first");
  assert.equal(log.find((item) => item.type === "SESSION_MOVE").text, "خفّض العميل عرضه", "a side's move in the room is a reply; the broker's own move is not");
  assert.equal(log.find((item) => item.type === "CALL_OUTCOME").certain, false, "what the broker typed after a call is not something the system verified");
  assert.deepEqual(log.filter((item) => !item.certain).map((item) => item.type).sort(), ["CALL_OUTCOME", "WHATSAPP_OPENED"]);
  const whatsapp = log.find((item) => item.type === "WHATSAPP_OPENED");
  assert.equal(whatsapp.label, "فُتح واتساب");
  assert.equal(whatsapp.certain, false, "opening WhatsApp is never shown as «sent»");
  assert.match(whatsapp.note, /لا يؤكد/);
  assert.ok(!log.some((item) => /أُرسل(?!ت داخل الغرفة)|تم الإرسال|وصلت/.test(item.label)), "no label claims delivery to WhatsApp");
  assert.equal(log.find((item) => item.type === "SESSION_OPENED").certain, true);
});

test("a notification opens where its push link opens", () => {
  const tasks = [
    { id: "t-review", type: "MATCH_REVIEW", matchId: "m1" },
    { id: "t-room", type: "SESSION_INTERVENTION", journeyId: "j1" },
    { id: "t-deal", type: "VIEWING_RESULT", journeyId: "j2" },
    { id: "t-record", type: "MISSING_DATA", opportunityId: "o1" }
  ];
  assert.equal(notificationTarget({ route: "session/j9" }, tasks), "session/j9");
  assert.equal(notificationTarget({ route: "javascript:alert(1)" }, tasks), "tasks", "only an in-app route is followed");
  assert.equal(notificationTarget({ operationId: "t-review" }, tasks), "review/m1");
  assert.equal(notificationTarget({ taskId: "t-room" }, tasks), "session/j1");
  assert.equal(notificationTarget({ taskId: "t-deal" }, tasks), "journey/j2");
  assert.equal(notificationTarget({ taskId: "t-record" }, tasks), "record/o1");
  // Real shapes written by the Worker.
  const dealNote = { operationId: "gone", taskId: "gone", workflowId: "jr_0a1b2c", entityType: "journey", entityId: "jr_0a1b2c", matchId: "m3", opportunityId: "o3", route: "" };
  assert.equal(notificationTarget(dealNote, tasks), "journey/jr_0a1b2c", "a finished task of a deal still leads to its deal");
  assert.equal(notificationTarget({ ...dealNote, route: "session/jr_0a1b2c" }, tasks), "session/jr_0a1b2c", "a room notification opens the room");
  const reviewNote = { operationId: "op_gone", taskId: "mg_opp_1", workflowId: "mg_opp_1", entityType: "match", entityId: "m4", matchId: "m4", opportunityId: "o4" };
  assert.equal(notificationTarget(reviewNote, tasks), "review/m4", "«مطابقة جديدة»: a match group id is not a deal — it opens the review");
  assert.equal(notificationTarget({ workflowId: "op_123", opportunityId: "o6" }, tasks), "record/o6", "a task id in workflowId is not a deal either");
  assert.equal(notificationTarget({ workflowId: "op_123" }, tasks), "tasks", "with nothing to open, the tasks list");
  assert.equal(notificationTarget({ workflowId: "jr_77aa" }, tasks), "journey/jr_77aa");
  assert.equal(notificationTarget({ matchId: "m7" }, tasks), "review/m7");
  assert.equal(notificationTarget({}, tasks), "tasks");
  const list = [
    { id: "n1", title: "أ", brokerId: "u1", createdAt: iso(-10) },
    { id: "n2", title: "ب", brokerId: "u2", createdAt: iso(-5) },
    { id: "n3", body: "ج", createdAt: iso(-1) }
  ];
  assert.deepEqual(visibleNotifications(list, { uid: "u1" }).map((n) => n.id), ["n1", "n3"], "a broker sees his own and the unassigned");
  assert.equal(visibleNotifications(list, { uid: "x", isManager: true }).length, 3);
  const views = notificationViews(list, { tasks, seenAt: NOW.getTime() - 7 * 60000 });
  assert.deepEqual(views.map((view) => view.id), ["n3", "n2", "n1"]);
  assert.deepEqual(views.map((view) => view.isNew), [true, true, false]);
  assert.equal(views[0].title, "تنبيه", "a notification without a title still shows");
});

// ------------------------------------------------------------------ a library file linked to a deal document

async function call(route, body, uid) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const deal = {};

test("document link rules: only the link changes; status and note stay", () => {
  const journey = { status: "ACTIVE", offerSummary: { purpose: "SALE" }, documents: { title_deed: { status: "RECEIVED", note: "أصل" } } };
  assert.equal(linkedFile({ libraryId: "lib_123456", title: "صك" }).title, "صك");
  assert.equal(linkedFile({ libraryId: "x" }), null);
  const linked = prepareDocumentChange(journey, { documentId: "title_deed", file: { libraryId: "lib_123456", title: "صك الملكية.pdf" } }, { now: NOW, actorUid: "u1" });
  assert.equal(linked.ok, true);
  assert.equal(linked.entry.status, "RECEIVED", "linking a file does not change the item's status");
  assert.equal(linked.entry.note, "أصل");
  assert.equal(linked.entry.file.libraryId, "lib_123456");
  const next = { ...journey, documents: { title_deed: linked.entry } };
  assert.equal(documentChecklist(next).find((row) => row.id === "title_deed").file.title, "صك الملكية.pdf");
  const status = prepareDocumentChange(next, { documentId: "title_deed", status: "REVIEWED" }, { now: NOW });
  assert.equal(status.entry.file.libraryId, "lib_123456", "changing the status keeps the linked file");
  const unlinked = prepareDocumentChange(next, { documentId: "title_deed", unlinkFile: true }, { now: NOW });
  assert.equal(unlinked.entry.file, null);
  assert.equal(unlinked.entry.status, "RECEIVED");
  assert.equal(prepareDocumentChange(journey, { documentId: "title_deed", unlinkFile: true }, { now: NOW }).ok, false);
  assert.equal(prepareDocumentChange(journey, { documentId: "title_deed", file: { libraryId: "!" } }, { now: NOW }).ok, false);
});

test("the Worker links a library file of the same office only, logs it, and keeps the file in the library", async () => {
  const offer = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "bs-off", record: { kind: "OFFER", purpose: "SALE", propertyType: "شقة", city: "الرياض", district: "حي الخطوات", price: 900000, contactName: "مالك الخطوات", contactPhone: "0551239001" } }, OWNER_A);
  const request = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "bs-req", record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "شقة", city: "الرياض", district: "حي الخطوات", price: 950000, contactName: "عميل الخطوات", contactPhone: "0551239002" } }, OWNER_A);
  const match = h.store.list(`offices/${OFFICE_A}/matches`).find((m) => m.offerId === offer.body.recordId && m.requestId === request.body.recordId);
  const approved = await call("/os/review/decide", { officeId: OFFICE_A, matchId: match.id, decision: "approve" }, OWNER_A);
  deal.journeyId = approved.body.journeyId;
  h.store.seed(`offices/${OFFICE_A}/library/lib_deed_0001`, { officeId: OFFICE_A, fileName: "deed.pdf", documentTitle: "صك شقة الخطوات", mediaPath: `office-library/${OFFICE_A}/deed.pdf`, category: "other" });
  h.store.seed(`offices/${OFFICE_B}/library/lib_other_0001`, { officeId: OFFICE_B, fileName: "secret.pdf", documentTitle: "ملف مكتب آخر", mediaPath: `office-library/${OFFICE_B}/secret.pdf` });
  const journey = () => h.store.get(`offices/${OFFICE_A}/journeys/${deal.journeyId}`);
  const before = journey();

  const foreign = await call("/os/journeys/documents", { officeId: OFFICE_A, journeyId: deal.journeyId, documentId: "title_deed", libraryItemId: "lib_other_0001" }, OWNER_A);
  assert.equal(foreign.status, 404, "a file of another office's library cannot be linked");
  assert.equal(journey().documents?.title_deed?.file ?? null, null, "and nothing was linked");
  assert.equal((await call("/os/journeys/documents", { officeId: OFFICE_A, journeyId: deal.journeyId, documentId: "title_deed", libraryItemId: "lib_deed_0001" }, OWNER_B)).status, 403);

  const linked = await call("/os/journeys/documents", { officeId: OFFICE_A, journeyId: deal.journeyId, documentId: "title_deed", libraryItemId: "lib_deed_0001" }, OWNER_A);
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  const after = journey();
  assert.deepEqual(after.documents.title_deed.file, { libraryId: "lib_deed_0001", title: "صك شقة الخطوات" });
  assert.equal(after.documents.title_deed.status, "MISSING", "the item's status is still the broker's to set");
  assert.equal(after.phase, before.phase, "the deal's phase is untouched");
  assert.equal(after.stage, before.stage);
  assert.equal(after.status, before.status);
  assert.deepEqual(h.store.get(`offices/${OFFICE_A}/library/lib_deed_0001`), { officeId: OFFICE_A, fileName: "deed.pdf", documentTitle: "صك شقة الخطوات", mediaPath: `office-library/${OFFICE_A}/deed.pdf`, category: "other", id: "lib_deed_0001" }, "the library item itself is not changed, copied or moved");
  assert.equal(h.store.list(`offices/${OFFICE_A}/library`).length, 1, "no copy was created");
  assert.ok(h.store.list(`offices/${OFFICE_A}/journeys/${deal.journeyId}/events`).some((event) => event.type === "DOCUMENT_UPDATED" && /أُرفق من المكتبة: صك شقة الخطوات/.test(event.text)));

  assert.equal((await call("/os/journeys/documents", { officeId: OFFICE_A, journeyId: deal.journeyId, documentId: "title_deed", status: "RECEIVED" }, OWNER_A)).status, 200);
  assert.equal(journey().documents.title_deed.file.libraryId, "lib_deed_0001", "the link survives a status change");
  const unlinked = await call("/os/journeys/documents", { officeId: OFFICE_A, journeyId: deal.journeyId, documentId: "title_deed", unlinkFile: true }, OWNER_A);
  assert.equal(unlinked.status, 200, JSON.stringify(unlinked.body));
  assert.equal(journey().documents.title_deed.file, null);
  assert.equal(journey().documents.title_deed.status, "RECEIVED");
  assert.ok(h.store.get(`offices/${OFFICE_A}/library/lib_deed_0001`), "unlinking never deletes the file");

  // A document that sits under this office's path but is marked as another office's is refused too.
  h.store.seed(`offices/${OFFICE_A}/library/lib_misfiled_01`, { officeId: OFFICE_B, fileName: "x.pdf", documentTitle: "ملف في غير مكانه" });
  const misfiled = await call("/os/journeys/documents", { officeId: OFFICE_A, journeyId: deal.journeyId, documentId: "title_deed", libraryItemId: "lib_misfiled_01" }, OWNER_A);
  assert.equal(misfiled.status, 404);
  assert.equal(journey().documents.title_deed.file, null, "nothing was linked");
});
