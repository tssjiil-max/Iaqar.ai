/**
 * «مدير المكتب الذكي» — the office's AI agent (Staging).
 *
 * The broker talks to it in plain language (#/agent). It answers from THIS office's own data
 * only, through a fixed set of server tools (public/os/domain/agent-domain.js): the model may
 * only NAME a tool; the Worker runs it with the office id from the verified session, never from
 * the model. Tools that change something run only after the broker presses the button the agent
 * shows (APPROVAL); money, contracts, final prices and closing a deal are FORBIDDEN to the agent.
 * When the model is not configured, fails or is over its daily budget, a rules-only answer is
 * built from the same tools — the broker always gets a real, data-backed reply.
 *
 *   offices/{o}/agentSettings/main     on/off and the office's own instructions (manager only, via the Worker)
 *   offices/{o}/agentChats/{uid}       the last turns of one broker's conversation (Worker only)
 *   offices/{o}/agentStats/{day}       model calls, fallbacks and errors per day (Worker only)
 * Nothing here sends anything to a client or an owner.
 */

import {
  AGENT_LANGUAGE_RULES, AGENT_TOOLS, FORBIDDEN_TEXT, LANE, TOOL_CATEGORY, fallbackIntent, laneOfGroup, needsYouReason, needsYouTask, parseAgentStep, priorityScore,
  riyadhDayStart, taskLane, toolGate, visibleCards
} from "../../../public/os/domain/agent-domain.js";
import { isJourneyOpen, STAGE_LABEL } from "../../../public/os/domain/journey-domain.js";
import { visibleToActor, taskCardModel } from "../../../public/os/domain/task-domain.js";
import { formatDateTime, formatPrice } from "../../../public/os/domain/format-domain.js";
import { AUDIT_ACTIONS, writeAudit } from "./audit-log.js";
import { setJourneyBotPaused } from "./bot-service.js";

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const MAX_TURNS = 16;
const MAX_STEPS = 3;
export const AI_CALLS_PER_DAY = 200;
export const INSTRUCTIONS_MAX = 600;

const settingsPath = (officeId) => ["offices", officeId, "agentSettings", "main"];
const statsPath = (officeId, day) => ["offices", officeId, "agentStats", day];
const dayOf = (date) => date.toISOString().slice(0, 10);
const forbid = (ctx, message) => { throw ctx.deps.appError("forbidden", 403, message); };

function aiConfigured(env = {}) {
  return Boolean(text(env.GEMINI_API_KEY, 300));
}

export async function agentSettings(ctx, officeId) {
  const raw = (await ctx.store.get(settingsPath(officeId))) || {};
  return { enabled: raw.enabled === true, instructions: text(raw.instructions, INSTRUCTIONS_MAX), updatedAt: raw.updatedAt || null, lastErrorAt: raw.lastErrorAt || null };
}

/** What the office may see about its agent. Any member reads it; the numbers come from the office's own tasks. */
export async function agentStatus(ctx, { officeId, actor }) {
  const settings = await agentSettings(ctx, officeId);
  const stats = (await ctx.store.get(statsPath(officeId, dayOf(ctx.now())))) || {};
  const bot = (await ctx.store.get(["offices", officeId, "botSettings", "telegram"])) || {};
  return {
    ok: true,
    enabled: settings.enabled,
    aiConfigured: aiConfigured(ctx.env),
    lastErrorAt: settings.lastErrorAt,
    instructions: actor?.isManager ? settings.instructions : "",
    telegramBotOn: bot.enabled === true,
    aiBudgetReached: Number(stats.aiCalls || 0) >= AI_CALLS_PER_DAY,
    today: { aiCalls: Number(stats.aiCalls || 0), fallbacks: Number(stats.fallbacks || 0), errors: Number(stats.errors || 0), chats: Number(stats.chats || 0) }
  };
}

export async function saveAgentSettings(ctx, { actor, officeId, enabled, instructions }) {
  if (!actor?.isManager) forbid(ctx, "إعدادات مدير المكتب الذكي لمدير المكتب فقط");
  const now = ctx.now();
  const patch = { updatedAt: now, updatedBy: actor.uid };
  if (typeof enabled === "boolean") patch.enabled = enabled;
  if (typeof instructions === "string") patch.instructions = text(instructions.replace(/\s+/g, " "), INSTRUCTIONS_MAX);
  await ctx.store.set(settingsPath(officeId), patch);
  if (typeof enabled === "boolean") {
    await writeAudit(ctx, { officeId, action: enabled ? AUDIT_ACTIONS.AGENT_ENABLED : AUDIT_ACTIONS.AGENT_DISABLED, actorUid: actor.uid, entityType: "agent", entityId: "main", key: now.toISOString() });
  }
  return { ok: true, ...(await agentStatus(ctx, { officeId, actor })) };
}

async function bumpStats(ctx, officeId, field) {
  const path = statsPath(officeId, dayOf(ctx.now()));
  const current = (await ctx.store.get(path)) || {};
  await ctx.store.set(path, { [field]: Number(current[field] || 0) + 1, updatedAt: ctx.now() }).catch(() => {});
  return Number(current[field] || 0) + 1;
}

// ------------------------------------------------------------------ tools (office-scoped, actor-visible)

async function visibleTasks(ctx, officeId, actor) {
  // A larger page than the screens' 300: the agent should not miss active tasks in a busy office.
  const ops = await ctx.store.list(["offices", officeId, "operations"], 1000);
  return ops.filter((task) => String(task.officeId || officeId) === officeId && visibleToActor(task, { uid: actor.uid, isManager: actor.isManager, officeId }));
}

async function visibleJourneys(ctx, officeId, actor) {
  const journeys = await ctx.store.list(["offices", officeId, "journeys"], 300);
  return journeys.filter((j) => String(j.officeId || officeId) === officeId && (actor.isManager || !j.assignedBrokerId || j.assignedBrokerId === actor.uid))
    .map((j) => ({ ...j, journeyId: j.journeyId || j.id }));
}

const taskItem = (task) => {
  const model = taskCardModel(task);
  return { id: model.id, title: model.title || model.badge, sub: needsYouReason(task), route: `task/${model.id}`, tag: model.badge };
};
const journeyTitle = (j) => [j.offerSummary?.propertyType, j.offerSummary?.district].filter(Boolean).join(" — ") || "صفقة";
const journeyItem = (j, sub) => ({ id: j.journeyId, title: journeyTitle(j), sub, route: `deal/${j.journeyId}`, tag: STAGE_LABEL[j.stage] || "" });

export async function runTool(ctx, { officeId, actor, name, args = {} }) {
  const gate = toolGate(name);
  if (!gate.allowed) return { ok: false, refused: gate.reason, text: gate.reason === "forbidden" ? FORBIDDEN_TEXT : "هذا الإجراء غير متاح لمدير المكتب الذكي.", items: [] };
  const now = ctx.now();
  if (name === "needs_attention" || name === "following") {
    // The same cards and lanes as Daily Tasks (one card per deal).
    const wanted = name === "needs_attention" ? LANE.NEEDS_YOU : LANE.FOLLOWING;
    const groups = visibleCards(await visibleTasks(ctx, officeId, actor), now).filter((group) => laneOfGroup(group) === wanted);
    const score = (group) => Math.max(...(group.kind === "deal" ? group.tasks : [group.task]).map((task) => priorityScore(task, now)));
    if (wanted === LANE.NEEDS_YOU) groups.sort((a, b) => score(b) - score(a));
    const itemOf = (group) => {
      if (group.kind !== "deal") return taskItem(group.task);
      const lead = (wanted === LANE.NEEDS_YOU ? needsYouTask(group) : (group.subtasks || []).find((task) => taskLane(task) === wanted)) || group.primary || group.tasks[0];
      return { ...taskItem(lead), id: group.id, route: `deal/${group.id}` };
    };
    return { ok: true, count: groups.length, items: groups.slice(0, 8).map(itemOf) };
  }
  if (name === "done_today") {
    const start = riyadhDayStart(now);
    const done = (await visibleTasks(ctx, officeId, actor)).filter((t) => String(t.status || "").toUpperCase() === "COMPLETED" && new Date(t.completedAt || 0) >= start);
    return { ok: true, count: done.length, items: done.slice(0, 8).map((t) => ({ ...taskItem(t), sub: t.completedBy === "AGENT" ? "نفذه مدير المكتب الذكي" : "" })) };
  }
  if (name === "new_matches") {
    const matches = (await ctx.store.list(["offices", officeId, "matches"], 300))
      .filter((m) => m.isCurrent !== false && String(m.status || "active") === "active" && !m.brokerDecision && Number(m.score || 0) >= 55)
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    return { ok: true, count: matches.length, items: matches.slice(0, 6).map((m) => ({ id: m.id, title: `مطابقة بنسبة ${Math.round(Number(m.score || 0))}%`, sub: text(m.summaryText || m.reasonText || "", 120), route: `review/${m.id}`, tag: "مطابقة" })) };
  }
  if (name === "upcoming_viewings") {
    const week = now.getTime() + 7 * 86400000;
    const list = (await visibleJourneys(ctx, officeId, actor)).filter((j) => isJourneyOpen(j) && j.viewing?.at && new Date(j.viewing.at).getTime() >= now.getTime() - 3600000 && new Date(j.viewing.at).getTime() <= week)
      .sort((a, b) => new Date(a.viewing.at) - new Date(b.viewing.at));
    return { ok: true, count: list.length, items: list.slice(0, 8).map((j) => journeyItem(j, `${formatDateTime(new Date(j.viewing.at), now)} · ${j.viewing.state === "CONFIRMED" ? "مؤكد" : "بانتظار التأكيد"}`)) };
  }
  if (name === "stuck_deals") {
    const limit = now.getTime() - 3 * 86400000;
    const list = (await visibleJourneys(ctx, officeId, actor)).filter((j) => isJourneyOpen(j) && new Date(j.lastEvent?.at || j.updatedAt || 0).getTime() < limit);
    return { ok: true, count: list.length, items: list.slice(0, 8).map((j) => journeyItem(j, `آخر حركة: ${text(j.lastEvent?.text, 80) || "—"}`)) };
  }
  if (name === "deal_status") {
    const words = text(args.query, 120).split(/\s+/).filter((w) => w.length >= 2);
    const list = (await visibleJourneys(ctx, officeId, actor)).filter((j) => isJourneyOpen(j))
      .map((j) => ({ j, hits: words.filter((w) => `${j.offerSummary?.propertyType || ""} ${j.offerSummary?.district || ""} ${j.requestSummary?.district || ""}`.includes(w)).length }))
      .filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits).map((x) => x.j);
    return { ok: true, count: list.length, items: list.slice(0, 5).map((j) => journeyItem(j, [STAGE_LABEL[j.stage], text(j.currentAction?.label, 60), formatPrice(j.offerSummary?.price)].filter(Boolean).join(" · "))) };
  }
  if (gate.category === TOOL_CATEGORY.APPROVAL) {
    // Never run from the model's words: the agent returns a button; the broker's press calls /os/agent/act.
    const journeyId = text(args.journeyId, 120);
    const journey = journeyId ? (await visibleJourneys(ctx, officeId, actor)).find((j) => j.journeyId === journeyId) : null;
    if (!journey) return { ok: false, text: "حدد الصفقة أولًا.", items: [] };
    return { ok: true, pendingAction: { tool: name, journeyId, label: name === "take_over_deal" ? `استلام «${journeyTitle(journey)}» من البوت` : `إعادة «${journeyTitle(journey)}» إلى البوت` }, items: [journeyItem(journey, "")] };
  }
  return { ok: false, text: "هذا الإجراء غير متاح.", items: [] };
}

/** The broker pressed the button the agent showed. The broker's own permissions apply. */
export async function runApprovedAction(ctx, { actor, officeId, tool, journeyId }) {
  const gate = toolGate(tool);
  if (!gate.allowed || gate.category !== TOOL_CATEGORY.APPROVAL) forbid(ctx, FORBIDDEN_TEXT);
  const result = await setJourneyBotPaused(ctx, { actor, officeId, journeyId: text(journeyId, 120), paused: tool === "take_over_deal" });
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.AGENT_ACTION_APPROVED, actorUid: actor.uid, entityType: "journey", entityId: text(journeyId, 120), key: ctx.now().toISOString(), details: { tool } });
  return { ok: true, done: true, journeyId: result?.journeyId || journeyId };
}

// ------------------------------------------------------------------ the conversation

const RULES_REPLY = {
  needs_attention: (r) => (r.count ? `عندك ${r.count} ${r.count === 1 ? "معاملة تحتاج" : "معاملات تحتاج"} تدخلك، هذي أهمها:` : "جميع المعاملات تحت المتابعة، ولا توجد قرارات تنتظرك حاليًا."),
  following: (r) => (r.count ? `أتابع ${r.count} ${r.count === 1 ? "معاملة" : "معاملات"} بانتظار رد الأطراف:` : "ما فيه معاملات بانتظار رد حاليًا."),
  done_today: (r) => (r.count ? `أُنجز اليوم ${r.count}:` : "ما أُنجز شيء اليوم بعد."),
  new_matches: (r) => (r.count ? `فيه ${r.count} ${r.count === 1 ? "مطابقة" : "مطابقات"} تنتظر قرارك، الأقوى أولًا:` : "ما فيه مطابقات جديدة تنتظر قرارك."),
  upcoming_viewings: (r) => (r.count ? `المعاينات القادمة خلال أسبوع (${r.count}):` : "ما فيه معاينات خلال الأسبوع القادم."),
  stuck_deals: (r) => (r.count ? `هذي صفقات بلا حركة من 3 أيام أو أكثر (${r.count}):` : "كل الصفقات المفتوحة فيها حركة خلال آخر 3 أيام."),
  deal_status: (r) => (r.count ? "هذا اللي لقيته:" : "ما لقيت صفقة مفتوحة بهذا الوصف. اكتب الحي أو نوع العقار.")
};
const HELP = "أقدر أخبرك وش يحتاج تدخلك، ووش أتابعه، ووش انتهى اليوم، وأقوى المطابقات الجديدة، والمعاينات القادمة، والصفقات المتوقفة، وحالة صفقة معينة. وش تبي؟";

function systemPrompt(officeName, instructions) {
  const tools = Object.entries(AGENT_TOOLS).filter(([, t]) => t.category !== TOOL_CATEGORY.FORBIDDEN)
    .map(([name, t]) => `- ${name}${t.args ? ` (args: ${t.args.join(", ")})` : ""}: ${t.description}`).join("\n");
  return [
    `أنت «مدير المكتب الذكي» لمكتب «${officeName}» العقاري — مساعد ذكاء اصطناعي، ولست موظفًا بشريًا.`,
    "تتحدث مع وسيط من المكتب. أجب فقط من نتائج الأدوات؛ لا تخترع أسماء أو أسعار أو مواعيد أو موافقات أو نسب.",
    "قرارات المال والعقود والتوقيع والسعر النهائي والعمولة والعربون وإغلاق الصفقة وحذف البيانات ليست من صلاحيتك: اعتذر ووضح أن صاحب القرار يتخذه بنفسه.",
    AGENT_LANGUAGE_RULES,
    instructions ? `تعليمات المكتب (ضمن القواعد أعلاه فقط): ${instructions}` : "",
    "الأدوات المتاحة:", tools,
    "أعد JSON فقط: إما {\"tool\": \"اسم_الأداة\", \"args\": {...}} لاستدعاء أداة واحدة، أو {\"reply\": \"ردك للوسيط\"} عندما تكون جاهزًا.",
    "لا تطلب أداة غير موجودة في القائمة. لا تضع رقم مكتب في args. لـ take_over_deal و hand_back_deal استخدم id الصفقة كما ظهر في نتائج الأدوات (journeyId)."
  ].filter(Boolean).join("\n");
}

async function loadTurns(ctx, officeId, uid) {
  const doc = await ctx.store.get(["offices", officeId, "agentChats", uid]);
  try { const turns = JSON.parse(doc?.turnsJson || "[]"); return Array.isArray(turns) ? turns.slice(-MAX_TURNS) : []; } catch { return []; }
}

async function saveTurns(ctx, officeId, uid, turns) {
  await ctx.store.set(["offices", officeId, "agentChats", uid], { turnsJson: JSON.stringify(turns.slice(-MAX_TURNS)).slice(0, 60000), updatedAt: ctx.now(), uid });
}

export async function agentHistory(ctx, { officeId, actor }) {
  return { ok: true, turns: await loadTurns(ctx, officeId, actor.uid) };
}

async function rulesAnswer(ctx, { officeId, actor, message }) {
  const intent = fallbackIntent(message);
  if (intent.tool === "forbidden") return { reply: FORBIDDEN_TEXT, items: [], source: "rules" };
  if (!intent.tool) return { reply: HELP, items: [], source: "rules" };
  const result = await runTool(ctx, { officeId, actor, name: intent.tool, args: intent.args || {} });
  return { reply: RULES_REPLY[intent.tool] ? RULES_REPLY[intent.tool](result) : HELP, items: result.items || [], source: "rules", tool: intent.tool };
}

/**
 * One broker message → one answer: { reply, items: [{title, sub, route, tag}], action?: {tool, journeyId, label}, source }.
 * `requestKey` makes a retried send return the same answer instead of a second one.
 */
export async function agentChat(ctx, { officeId, actor, message, requestKey = "" }) {
  const body = text(message, 1000);
  if (body.length < 1) throw ctx.deps.appError("empty_message", 400, "اكتب سؤالك");
  const settings = await agentSettings(ctx, officeId);
  const turns = await loadTurns(ctx, officeId, actor.uid);
  const key = text(requestKey, 80);
  if (key) {
    const previous = turns.find((t) => t.role === "agent" && t.requestKey === key);
    if (previous) return { ok: true, duplicate: true, reply: previous.text, items: previous.items || [], action: previous.action || null, source: previous.source || "" };
  }
  if (!settings.enabled) {
    return { ok: true, reply: "مدير المكتب الذكي متوقف في مكتبك. يشغله مدير المكتب من الإعدادات ← مدير المكتب الذكي.", items: [], source: "off" };
  }
  await bumpStats(ctx, officeId, "chats");
  let answer = null;
  const usage = (await ctx.store.get(statsPath(officeId, dayOf(ctx.now())))) || {};
  const canUseAi = aiConfigured(ctx.env) && typeof ctx.deps.callGemini === "function" && Number(usage.aiCalls || 0) < AI_CALLS_PER_DAY;
  if (canUseAi) {
    try {
      answer = await modelAnswer(ctx, { officeId, actor, message: body, turns, settings });
    } catch (error) {
      console.warn("[office-os] agent model failed", error?.code || error?.message);
      await bumpStats(ctx, officeId, "errors");
      await ctx.store.set(settingsPath(officeId), { lastErrorAt: ctx.now() }).catch(() => {});
    }
  }
  if (!answer) {
    answer = await rulesAnswer(ctx, { officeId, actor, message: body });
    await bumpStats(ctx, officeId, "fallbacks");
  }
  const now = ctx.now().toISOString();
  await saveTurns(ctx, officeId, actor.uid, [...turns, { role: "broker", text: body, at: now },
    { role: "agent", text: answer.reply, items: answer.items || [], action: answer.action || null, source: answer.source, requestKey: key, at: now }]);
  return { ok: true, reply: answer.reply, items: answer.items || [], action: answer.action || null, source: answer.source };
}

async function modelAnswer(ctx, { officeId, actor, message, turns, settings }) {
  const office = (await ctx.store.get(["offices", officeId])) || {};
  const officeName = text(office.businessName || office.officeName || office.name, 80) || "المكتب";
  const system = systemPrompt(officeName, settings.instructions);
  const history = turns.slice(-8).map((t) => `${t.role === "broker" ? "الوسيط" : "مدير المكتب"}: ${text(t.text, 400)}`).join("\n");
  const scratch = [];
  let items = [];
  let action = null;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    await bumpStats(ctx, officeId, "aiCalls");
    const result = await Promise.race([
      ctx.deps.callGemini({
        systemInstruction: system,
        userParts: [{ text: [history ? `المحادثة السابقة:\n${history}` : "", `رسالة الوسيط الآن: ${message}`, scratch.length ? `نتائج الأدوات:\n${scratch.join("\n")}` : ""].filter(Boolean).join("\n\n") }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 900, responseMimeType: "application/json" }
      }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "TIMEOUT" }), 12000))
    ]);
    if (!result?.ok) throw Object.assign(new Error(String(result?.error || "AI_FAILED")), { code: String(result?.error || "AI_FAILED") });
    const parsed = parseAgentStep(result.parsed);
    if (parsed.kind === "reply") return { reply: parsed.reply, items, action, source: "ai" };
    if (parsed.kind !== "tool") throw Object.assign(new Error("AI_BAD_OUTPUT"), { code: "AI_BAD_OUTPUT" });
    const gate = toolGate(parsed.tool);
    if (!gate.allowed) {
      // A forbidden or invented tool is answered by the system, not by the model.
      return { reply: gate.reason === "forbidden" ? FORBIDDEN_TEXT : HELP, items: [], action: null, source: "ai" };
    }
    const output = await runTool(ctx, { officeId, actor, name: parsed.tool, args: parsed.args });
    if (output.items?.length) items = output.items;
    if (output.pendingAction) action = output.pendingAction;
    scratch.push(`${parsed.tool}: ${JSON.stringify({ count: output.count ?? null, items: (output.items || []).map((i) => ({ id: i.id, title: i.title, sub: i.sub, tag: i.tag })), note: output.text || "" })}`.slice(0, 3000));
  }
  return { reply: "هذا ملخص ما وجدته:", items, action, source: "ai" };
}

export { LANE };
