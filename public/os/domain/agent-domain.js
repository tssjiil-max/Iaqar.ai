/**
 * «مدير المكتب الذكي» — pure rules shared by the office app and the Worker.
 *
 *   • Where each Daily Task stands (one task, one id, three lanes):
 *       NEEDS_YOU   needs the broker's decision or action;
 *       FOLLOWING   a known wait: the office manager (bot) asked a side, or a reply is awaited;
 *       DONE        finished today (from the task's own completedAt).
 *   • The agent's tools and the approval gate: every tool has one category —
 *       AUTO       read or prepare, run by the agent itself;
 *       APPROVAL   runs only after the broker presses the button the agent shows;
 *       FORBIDDEN  money, contracts, signatures, final price, closing a deal, deleting data:
 *                  never run by the agent; it explains who decides and opens the right page.
 *   • The language rules handed to the model, and a rules-only fallback when the model is not
 *     available, so a question always gets a real answer built from the office's own data.
 */

import { filterTasks, isActiveTask, isWaitingTask, taskTypeOf } from "./task-domain.js";
import { toDate } from "./format-domain.js";
import { groupDealTasks } from "./deal-card-domain.js";

export const LANE = Object.freeze({ NEEDS_YOU: "NEEDS_YOU", FOLLOWING: "FOLLOWING", DONE: "DONE" });

/** Bot question states in which the office manager (not the broker) is the one waiting for a side. */
export const AGENT_WAITING_STATES = Object.freeze(["CLIENT_ASKED", "OWNER_ASKED"]);

export function laneLabels(agentActive) {
  return {
    NEEDS_YOU: "تحتاج تدخلك",
    FOLLOWING: agentActive ? "يتابعها مدير المكتب" : "بانتظار رد",
    DONE: "تم إنجازها اليوم"
  };
}

/** The lane of one task. A task the broker must act on is never hidden in another lane. */
export function taskLane(task = {}) {
  const status = String(task.status || "").toUpperCase();
  if (status === "COMPLETED") return LANE.DONE;
  if (!isActiveTask(task)) return null;
  if (AGENT_WAITING_STATES.includes(String(task.agentState || "").toUpperCase())) return LANE.FOLLOWING;
  if (isWaitingTask(task)) return LANE.FOLLOWING;
  return LANE.NEEDS_YOU;
}

/** Why a NEEDS_YOU task needs the broker, in one short line (from the task's own data). */
export function needsYouReason(task = {}) {
  const type = String(task.type || "").toUpperCase();
  const state = String(task.agentState || "").toUpperCase();
  if (state === "OWNER_NOT_LINKED") return "العميل وافق، والمالك غير مرتبط بالبوت — يحتاج تواصلك";
  if (state === "HANDED_TO_BROKER") return "وصل رد بعد إيقاف البوت — القرار لك";
  if (state === "FAILED") return "تعذر إرسال سؤال البوت — تواصل بنفسك";
  if (type === "SESSION_INTERVENTION") return "طرف طلب تدخل الوسيط";
  if (type === "SESSION_PRIVATE_PRICE") return "سعر خاص وصل للوسيط فقط";
  if (type === "MATCH_REVIEW") return "مطابقة جديدة تنتظر قرارك";
  if (type === "PROPOSAL_REPLY") return "وصل رد يحتاج مراجعتك";
  if (/VIEWING/.test(type)) return "موعد معاينة يحتاج تأكيدك";
  if (type === "DEAL_ACTION") return "إجراءات اتفاق تحتاج متابعتك";
  if (type === "MISSING_DATA") return "بيانات ناقصة تحتاج استكمالًا";
  return taskTypeOf(task).badge;
}

/** Real priority: overdue/near appointment first, then sensitive decisions, then waiting time. */
export function priorityScore(task = {}, now = new Date()) {
  let score = 0;
  const due = toDate(task.dueAt) || toDate(task.appointmentAt) || toDate(task.viewingAt);
  if (due) {
    const hours = (due.getTime() - now.getTime()) / 3600000;
    if (hours < 0) score += 100;
    else if (hours <= 24) score += 60;
    else if (hours <= 72) score += 25;
  }
  const type = String(task.type || "").toUpperCase();
  if (["SESSION_INTERVENTION", "SESSION_PRIVATE_PRICE", "DEAL_ACTION"].includes(type)) score += 40;
  if (String(task.priority || "").toUpperCase() === "HIGH" || String(task.priority || "").toUpperCase() === "URGENT") score += 20;
  const since = toDate(task.updatedAt) || toDate(task.createdAt);
  if (since) score += Math.min(30, Math.floor((now.getTime() - since.getTime()) / 86400000) * 5);
  return score;
}

export function groupByLane(tasks = [], now = new Date()) {
  const lanes = { NEEDS_YOU: [], FOLLOWING: [], DONE: [] };
  for (const task of tasks) {
    const lane = taskLane(task);
    if (lane) lanes[lane].push(task);
  }
  lanes.NEEDS_YOU.sort((a, b) => priorityScore(b, now) - priorityScore(a, now));
  return lanes;
}

/**
 * The lane of one Daily Tasks card (a deal card carries all of its open tasks). The deal card's own
 * task is a container: the deal's lane is decided by its working tasks — any task that needs the
 * broker puts the whole card in NEEDS_YOU; otherwise a known wait puts it in FOLLOWING.
 */
export function laneOfGroup(group = {}) {
  if (group.kind !== "deal") return taskLane(group.task);
  const working = (group.subtasks && group.subtasks.length ? group.subtasks : group.tasks || []).map(taskLane).filter(Boolean);
  if (working.includes(LANE.NEEDS_YOU)) return LANE.NEEDS_YOU;
  if (working.includes(LANE.FOLLOWING)) return LANE.FOLLOWING;
  return LANE.NEEDS_YOU;
}

/**
 * The cards Daily Tasks shows by default, exactly as the page builds them: one card per deal from all
 * active tasks, kept when any of its tasks passes the default filter (a postponed task that is not
 * overdue stays hidden). Shared by the page, the home card and the Worker's tools.
 */
export function visibleCards(tasks = [], now = new Date()) {
  const active = tasks.filter(isActiveTask);
  const pass = new Set(filterTasks(active, "all", now).map((task) => task.id));
  return groupDealTasks(active, now).filter((group) => (group.kind === "deal" ? group.tasks.some((task) => pass.has(task.id)) : pass.has(group.task.id)));
}

/** Home card numbers — counted on the same cards Daily Tasks shows, so the two always agree. */
export function agentCounts(activeTasks = [], doneToday = [], now = new Date()) {
  const lanes = visibleCards(activeTasks, now).map(laneOfGroup);
  return {
    needsYou: lanes.filter((lane) => lane === LANE.NEEDS_YOU).length,
    following: lanes.filter((lane) => lane === LANE.FOLLOWING).length,
    doneToday: doneToday.filter((task) => taskLane(task) === LANE.DONE).length
  };
}

/** The task that makes a card need the broker (not one the bot is still waiting on). */
export function needsYouTask(group = {}) {
  if (group.kind !== "deal") return group.task || null;
  return (group.subtasks || []).find((task) => taskLane(task) === LANE.NEEDS_YOU) || group.primary || null;
}

/** Start of today in Riyadh (UTC+3), as a Date — the one definition of «اليوم» on both sides. */
export function riyadhDayStart(now = new Date()) {
  const riyadh = new Date(now.getTime() + 3 * 3600000);
  return new Date(Date.UTC(riyadh.getUTCFullYear(), riyadh.getUTCMonth(), riyadh.getUTCDate()) - 3 * 3600000);
}

/**
 * Agent status shown to the office — never «يعمل» unless it really can work.
 *   status = { enabled, aiConfigured, lastErrorAt }
 */
export function agentStatusView(status = {}, now = new Date()) {
  const error = toDate(status.lastErrorAt);
  const recentError = error && now.getTime() - error.getTime() < 30 * 60 * 1000;
  if (status.loaded !== true) return { state: "UNKNOWN", label: "جارٍ التحقق", tone: "" };
  if (status.enabled !== true) return { state: "OFF", label: "متوقف", tone: "warn" };
  if (recentError) return { state: "ERROR", label: "يوجد عطل", tone: "bad" };
  if (status.aiConfigured !== true) return { state: "SETUP", label: "يعمل بالقواعد", tone: "warn" };
  if (status.aiBudgetReached === true) return { state: "LIMIT", label: "يعمل بالقواعد — اكتمل حد اليوم", tone: "warn" };
  return { state: "ON", label: "يعمل", tone: "ok" };
}

// ------------------------------------------------------------------ tools and the approval gate

export const TOOL_CATEGORY = Object.freeze({ AUTO: "AUTO", APPROVAL: "APPROVAL", FORBIDDEN: "FORBIDDEN" });

/** The only tools the agent may name. Anything else is refused by the Worker. */
export const AGENT_TOOLS = Object.freeze({
  needs_attention: { category: "AUTO", description: "المعاملات التي تحتاج تدخل الوسيط الآن، مرتبة بالأولوية" },
  following: { category: "AUTO", description: "المعاملات التي ينتظر فيها مدير المكتب رد طرف" },
  done_today: { category: "AUTO", description: "ما أُنجز اليوم ومن نفذه" },
  new_matches: { category: "AUTO", description: "أقوى المطابقات الجديدة التي لم يُتخذ فيها قرار" },
  upcoming_viewings: { category: "AUTO", description: "مواعيد المعاينة القادمة خلال 7 أيام" },
  stuck_deals: { category: "AUTO", description: "صفقات مفتوحة بلا حركة منذ 3 أيام أو أكثر" },
  deal_status: { category: "AUTO", description: "حالة صفقة يذكرها الوسيط بالحي أو نوع العقار", args: ["query"] },
  take_over_deal: { category: "APPROVAL", description: "استلام صفقة من البوت (إيقاف رسائله فيها)", args: ["journeyId"] },
  hand_back_deal: { category: "APPROVAL", description: "إعادة صفقة للبوت", args: ["journeyId"] },
  accept_price: { category: "FORBIDDEN", description: "قبول سعر نيابة عن طرف" },
  set_final_price: { category: "FORBIDDEN", description: "تحديد السعر النهائي" },
  close_deal: { category: "FORBIDDEN", description: "إغلاق الصفقة نهائيًا" },
  commission: { category: "FORBIDDEN", description: "الاتفاق على العمولة" },
  deposit_or_payment: { category: "FORBIDDEN", description: "عربون أو دفعات" },
  sign_contract: { category: "FORBIDDEN", description: "توقيع عقد أو إقرار ملزم" },
  delete_data: { category: "FORBIDDEN", description: "حذف بيانات" }
});

export const FORBIDDEN_TEXT = "هذا قرار ملزم لا ينفذه مدير المكتب الذكي نيابة عن أحد. يتخذه صاحبه بنفسه من صفحة الصفقة، ودوري أجهز لك المعلومات فقط.";

export function toolGate(name) {
  const tool = AGENT_TOOLS[String(name || "")];
  if (!tool) return { allowed: false, category: null, reason: "unknown_tool" };
  if (tool.category === TOOL_CATEGORY.FORBIDDEN) return { allowed: false, category: tool.category, reason: "forbidden" };
  return { allowed: true, category: tool.category };
}

// ------------------------------------------------------------------ language and the model

export const AGENT_LANGUAGE_RULES = [
  "اللغة الافتراضية العربية، واللهجة الافتراضية للمحادثات العربية غير المحددة هي اللهجة السعودية الطبيعية المحترمة.",
  "إذا كتب المتحدث بلهجة عربية أخرى فتكيّف معها بلطف دون تصنع؛ وإذا كتب بالإنجليزية أو الأردية أو غيرها فرد بلغته.",
  "إذا تغيرت لغته أثناء المحادثة فتكيّف معها. إذا كانت اللغة غير واضحة فاستوضح بسؤال قصير.",
  "احفظ الأرقام والأسعار والمواقع والأسماء كما هي دون تغيير معناها.",
  "كن مختصرًا ولبقًا، واسأل سؤالًا واحدًا عند الحاجة، ولا تكرر ما قاله المتحدث."
].join(" ");

/** A short reply built without the model — used when the model is unavailable or fails. */
export function fallbackIntent(text = "") {
  const t = String(text || "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase();
  if (/(اقبل|اعتمد|وافق).*(سعر|عرض)|سعر نهائي|عمول|عربون|دفع|توقيع|وقع العقد|اغلق الصفقه|سكر الصفقه|احذف/.test(t)) return { tool: "forbidden" };
  if (/تدخل|يحتاج.*(ني|ك)|وش علي|ايش علي|قراراتي|ينتظرني|اولوي/.test(t)) return { tool: "needs_attention" };
  if (/ما ردوا|ما رد|بانتظار|تتابع|يتابع/.test(t)) return { tool: "following" };
  if (/انجز|خلصت|اليوم.*(تم|منجز)|وش سويت/.test(t)) return { tool: "done_today" };
  if (/مطابق/.test(t)) return { tool: "new_matches" };
  if (/معاين/.test(t)) return { tool: "upcoming_viewings" };
  if (/توقف|متعطل|واقف|ليش.*(وقف|توقف)|متاخر/.test(t)) return { tool: "stuck_deals" };
  if (/صفق|ارض|شقه|فيلا|عماره|محل/.test(t)) return { tool: "deal_status", args: { query: text } };
  return { tool: "" };
}

/** Parse the model's JSON answer: either one tool call or a final reply. Anything else is rejected. */
export function parseAgentStep(raw) {
  if (!raw || typeof raw !== "object") return { kind: "invalid" };
  if (typeof raw.tool === "string" && raw.tool.trim()) {
    const args = raw.args && typeof raw.args === "object" && !Array.isArray(raw.args) ? raw.args : {};
    return { kind: "tool", tool: raw.tool.trim().slice(0, 40), args };
  }
  if (typeof raw.reply === "string" && raw.reply.trim()) return { kind: "reply", reply: raw.reply.trim().slice(0, 2000) };
  return { kind: "invalid" };
}
