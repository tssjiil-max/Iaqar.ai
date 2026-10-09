// «مدير المكتب الذكي» — lanes of Daily Tasks, the approval gate, and the broker's conversation.
// Through the real Worker on the in-memory Firestore double, with seeded realistic deals;
// the model (Gemini) is a double here. Nothing is sent to any client or owner.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  AGENT_TOOLS, FORBIDDEN_TEXT, LANE, agentCounts, agentStatusView, fallbackIntent, laneOfGroup, needsYouTask, parseAgentStep, riyadhDayStart, taskLane, toolGate
} from "../public/os/domain/agent-domain.js";
import { groupDealTasks } from "../public/os/domain/deal-card-domain.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B, BROKER_A2 } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const { seedStates } = await import(path.join(ROOT, "scripts/qa/office-os/seed.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());
const seeded = await seedStates(h);

// ---- Gemini double: scripted answers, one per call.
const script = [];
let geminiCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (!String(url).startsWith("https://generativelanguage.googleapis.com/")) return realFetch(input, init);
  geminiCalls += 1;
  const next = script.shift();
  if (!next || next.fail) return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(next) }] } }] }), { status: 200 });
};
test.after(() => { globalThis.fetch = realFetch; });

async function call(route, body, uid) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const ops = () => h.store.list(`offices/${OFFICE_A}/operations`);

// ------------------------------------------------------------------ pure rules

test("lanes: a broker decision is NEEDS_YOU, a known wait is FOLLOWING, a finished task is DONE", () => {
  assert.equal(taskLane({ type: "MATCH_REVIEW", status: "OPEN" }), LANE.NEEDS_YOU);
  assert.equal(taskLane({ type: "MATCH_REVIEW", status: "OPEN", agentState: "CLIENT_ASKED" }), LANE.FOLLOWING, "the bot is waiting for the client");
  assert.equal(taskLane({ type: "MATCH_REVIEW", status: "OPEN", agentState: "OWNER_NOT_LINKED" }), LANE.NEEDS_YOU, "the broker must continue");
  assert.equal(taskLane({ type: "AWAITING_REPLY", status: "WAITING_EXTERNAL_RESPONSE" }), LANE.FOLLOWING);
  assert.equal(taskLane({ type: "SESSION_INTERVENTION", status: "OPEN" }), LANE.NEEDS_YOU);
  assert.equal(taskLane({ type: "MATCH_REVIEW", status: "COMPLETED" }), LANE.DONE);
  assert.equal(taskLane({ type: "MATCH_REVIEW", status: "DISMISSED" }), null);
  // A deal card is a container: its working tasks decide its lane.
  const waitingDeal = groupDealTasks([{ id: "c", type: "DEAL_JOURNEY", journeyId: "j1", status: "OPEN" }, { id: "w", type: "AWAITING_REPLY", journeyId: "j1", status: "WAITING_EXTERNAL_RESPONSE" }]);
  assert.equal(laneOfGroup(waitingDeal[0]), LANE.FOLLOWING);
  const needDeal = groupDealTasks([{ id: "c", type: "DEAL_JOURNEY", journeyId: "j1", status: "OPEN" }, { id: "w", type: "AWAITING_REPLY", journeyId: "j1", status: "WAITING_EXTERNAL_RESPONSE" }, { id: "i", type: "SESSION_INTERVENTION", journeyId: "j1", status: "OPEN" }]);
  assert.equal(laneOfGroup(needDeal[0]), LANE.NEEDS_YOU, "any task needing the broker puts the whole card first");
});

test("counts follow the cards Daily Tasks shows: a postponed task is hidden, an overdue one is not; «اليوم» is Riyadh's day", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  const later = new Date("2026-10-11T10:00:00Z").toISOString();
  const tasks = [
    { id: "a", type: "MATCH_REVIEW", status: "OPEN", updatedAt: now.toISOString() },
    { id: "b", type: "MATCH_REVIEW", status: "OPEN", snoozedUntil: later, dueAt: later }
  ];
  assert.equal(agentCounts(tasks, [], now).needsYou, 1);
  // 01:00 Riyadh on the 10th is still the 10th, not the 9th (UTC would say the 9th).
  assert.equal(riyadhDayStart(new Date("2026-10-09T22:00:00Z")).toISOString(), "2026-10-09T21:00:00.000Z");
  // The «why» line comes from the task that needs the broker, not one the bot is still waiting on.
  const [deal] = groupDealTasks([
    { id: "c", type: "DEAL_JOURNEY", journeyId: "j9", status: "OPEN" },
    { id: "w", type: "MATCH_REVIEW", journeyId: "j9", status: "OPEN", agentState: "CLIENT_ASKED" },
    { id: "n", type: "SESSION_INTERVENTION", journeyId: "j9", status: "OPEN" }
  ]);
  assert.equal(needsYouTask(deal).id, "n");
  assert.equal(agentStatusView({ loaded: true, enabled: true, aiConfigured: true, aiBudgetReached: true }).state, "LIMIT");
});

test("the gate: only listed tools; money, contracts, final price and closing are forbidden; unknown tools are refused", () => {
  for (const name of ["accept_price", "set_final_price", "close_deal", "commission", "deposit_or_payment", "sign_contract", "delete_data"]) assert.equal(toolGate(name).reason, "forbidden", name);
  assert.equal(toolGate("drop_everything").reason, "unknown_tool");
  assert.equal(toolGate("needs_attention").category, "AUTO");
  assert.equal(toolGate("take_over_deal").category, "APPROVAL");
  assert.equal(fallbackIntent("اقبل السعر عن المالك").tool, "forbidden");
  assert.equal(fallbackIntent("وش يحتاج تدخلي اليوم؟").tool, "needs_attention");
  assert.equal(fallbackIntent("السلام عليكم").tool, "", "a greeting is not turned into an action");
  assert.deepEqual(parseAgentStep({ tool: "new_matches", args: [] }), { kind: "tool", tool: "new_matches", args: {} });
  assert.equal(parseAgentStep({ nothing: true }).kind, "invalid");
  assert.ok(Object.keys(AGENT_TOOLS).every((name) => /^[a-z_]+$/.test(name)));
});

test("status is never «يعمل» when off, failing or not loaded", () => {
  assert.equal(agentStatusView({}).state, "UNKNOWN");
  assert.equal(agentStatusView({ loaded: true, enabled: false }).label, "متوقف");
  assert.equal(agentStatusView({ loaded: true, enabled: true, aiConfigured: true, lastErrorAt: new Date().toISOString() }).state, "ERROR");
  assert.notEqual(agentStatusView({ loaded: true, enabled: true, aiConfigured: false }).label, "يعمل");
  assert.equal(agentStatusView({ loaded: true, enabled: true, aiConfigured: true }).label, "يعمل");
});

// ------------------------------------------------------------------ through the Worker

test("settings are the manager's; status is readable by any member of the office only", async () => {
  assert.equal((await call("/os/agent/settings", { officeId: OFFICE_A, enabled: true }, BROKER_A2)).status, 403);
  assert.equal((await call("/os/agent/status", { officeId: OFFICE_A }, OWNER_B)).status, 403, "another office cannot read it");
  const status = await call("/os/agent/status", { officeId: OFFICE_A }, BROKER_A2);
  assert.equal(status.body.enabled, false);
  assert.equal(status.body.instructions, "", "instructions are shown to the manager only");
});

test("while switched off, the agent says so and does nothing", async () => {
  const r = await call("/os/agent/chat", { officeId: OFFICE_A, message: "وش يحتاج تدخلي؟" }, OWNER_A);
  assert.equal(r.body.source, "off");
  assert.equal(geminiCalls, 0);
});

test("switched on without a model key: real answers from the office's data (rules), same cards as Daily Tasks", async () => {
  const on = await call("/os/agent/settings", { officeId: OFFICE_A, enabled: true, instructions: "  كن مختصرًا  " }, OWNER_A);
  assert.equal(on.body.enabled, true);
  assert.equal(on.body.instructions, "كن مختصرًا");
  const r = await call("/os/agent/chat", { officeId: OFFICE_A, message: "وش يحتاج تدخلي اليوم؟", requestKey: "k-rules-1" }, OWNER_A);
  assert.equal(r.body.source, "rules");
  const active = ops().filter((op) => ["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"].includes(op.status));
  const expected = agentCounts(active, []).needsYou;
  assert.ok(expected > 0, "the seeded office has decisions waiting");
  assert.match(r.body.reply, new RegExp(String(expected)), "the count matches the Daily Tasks lanes");
  assert.ok(r.body.items.length > 0 && r.body.items.every((i) => i.route), "each item opens its record");
  // A retried send returns the same answer, not a second one.
  const again = await call("/os/agent/chat", { officeId: OFFICE_A, message: "وش يحتاج تدخلي اليوم؟", requestKey: "k-rules-1" }, OWNER_A);
  assert.equal(again.body.duplicate, true);
  const history = await call("/os/agent/history", { officeId: OFFICE_A }, OWNER_A);
  assert.equal(history.body.turns.filter((t) => t.role === "agent").length, 1);
  // A forbidden request is refused by the rules too.
  const money = await call("/os/agent/chat", { officeId: OFFICE_A, message: "اقبل السعر عن المالك وسكر الصفقة" }, OWNER_A);
  assert.equal(money.body.reply, FORBIDDEN_TEXT);
});

test("with the model: it may only name listed tools; forbidden or invented tools never run", async () => {
  h.env.GEMINI_API_KEY = "test-key-not-real"; // pragma: allowlist secret
  script.push({ tool: "needs_attention", args: { officeId: OFFICE_B } }, { reply: "عندك قرارات تنتظرك، أهمها المطابقة الجديدة." });
  const r = await call("/os/agent/chat", { officeId: OFFICE_A, message: "what needs me today?" }, OWNER_A);
  assert.equal(r.body.source, "ai");
  assert.ok(r.body.items.length > 0);
  // The office id in the model's args is ignored: every item is office A's.
  const aIds = new Set([...ops().map((o) => o.id), ...h.store.list(`offices/${OFFICE_A}/journeys`).map((j) => j.journeyId || j.id)]);
  assert.ok(r.body.items.every((i) => aIds.has(i.id)), "no item from another office");

  script.push({ tool: "close_deal", args: {} });
  const close = await call("/os/agent/chat", { officeId: OFFICE_A, message: "سكّر صفقة الياسمين" }, OWNER_A);
  assert.equal(close.body.reply, FORBIDDEN_TEXT);
  script.push({ tool: "drop_database", args: {} });
  const invented = await call("/os/agent/chat", { officeId: OFFICE_A, message: "احذف كل شي" }, OWNER_A);
  assert.notEqual(invented.body.source, "");
  assert.doesNotMatch(invented.body.reply, /تم الحذف/);
});

test("the model failing never loses anything: rules answer, error counted, records untouched", async () => {
  const before = ops().length;
  script.push({ fail: true });
  const r = await call("/os/agent/chat", { officeId: OFFICE_A, message: "عطني أقوى المطابقات الجديدة" }, OWNER_A);
  assert.equal(r.body.source, "rules");
  assert.equal(ops().length, before);
  const status = await call("/os/agent/status", { officeId: OFFICE_A }, OWNER_A);
  assert.ok(status.body.today.errors >= 1);
  assert.equal(status.body.lastErrorAt !== null, true);
});

test("approval gate: the model can only propose taking over a deal; it runs when the broker presses, with his permissions", async () => {
  const journeyId = seeded.negotiation.journeyId;
  script.push({ tool: "take_over_deal", args: { journeyId } }, { reply: "جهزت لك زر استلام الصفقة." });
  const r = await call("/os/agent/chat", { officeId: OFFICE_A, message: "استلم صفقة التفاوض بنفسي" }, OWNER_A);
  assert.equal(r.body.action.tool, "take_over_deal");
  const journey = () => h.store.get(`offices/${OFFICE_A}/journeys/${journeyId}`);
  assert.notEqual(journey().bot?.paused, true, "nothing changed before the press");
  assert.equal((await call("/os/agent/act", { officeId: OFFICE_A, tool: "close_deal", journeyId }, OWNER_A)).status, 403, "a forbidden tool cannot be pressed");
  assert.equal((await call("/os/agent/act", { officeId: OFFICE_A, tool: "take_over_deal", journeyId }, OWNER_B)).status, 403, "another office cannot press it");
  const pressed = await call("/os/agent/act", { officeId: OFFICE_A, tool: "take_over_deal", journeyId }, OWNER_A);
  assert.equal(pressed.body.done, true);
  assert.equal(journey().bot.paused, true);
  assert.ok(h.store.list(`offices/${OFFICE_A}/auditLogs`).some((a) => a.action === "AGENT_ACTION_APPROVED"));
});

test("office isolation: office B's agent sees none of office A's deals", async () => {
  await call("/os/agent/settings", { officeId: OFFICE_B, enabled: true }, OWNER_B);
  delete h.env.GEMINI_API_KEY;
  const r = await call("/os/agent/chat", { officeId: OFFICE_B, message: "وش يحتاج تدخلي؟" }, OWNER_B);
  assert.equal(r.body.items.length, 0);
  assert.match(r.body.reply, /لا توجد قرارات تنتظرك/);
  assert.equal((await call("/os/agent/chat", { officeId: OFFICE_A, message: "وش يحتاج تدخلي؟" }, OWNER_B)).status, 403);
});

test("a deal opened by the bot is recorded as done by the office manager; the review task carries the bot's state", async () => {
  // The journey service marks who finished the review task.
  const src = (await import("node:fs")).readFileSync(path.join(ROOT, "worker/src/office-os/journey-service.js"), "utf8");
  assert.match(src, /completedBy: viaBot \? "AGENT" : actor\.uid/);
  const bot = (await import("node:fs")).readFileSync(path.join(ROOT, "worker/src/office-os/bot-service.js"), "utf8");
  assert.match(bot, /agentState: state, agentStateAt/);
  const done = ops().filter((op) => op.status === "COMPLETED" && op.type === "MATCH_REVIEW");
  assert.ok(done.length > 0 && done.every((op) => op.completedBy === OWNER_A), "broker-approved reviews carry the broker's uid");
});
