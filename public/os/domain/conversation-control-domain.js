/**
 * Who answers a WhatsApp conversation: the office's agent, or a person.
 *
 * One controller per conversation, kept on the conversation itself (Worker-written only):
 *   handoff         — true stops every automated reply in THIS conversation, and only in it
 *   heldBy          — the broker answering instead (uid), or HELD_BY_APP when a person replied from the
 *                     WhatsApp Business app on the office's number (coexistence); '' = waiting for a person
 *   controlVersion  — taking over and handing back are first-wins: a stale screen gets 409, never a silent overwrite
 *
 * The same pure helpers decide what the Worker returns and what the office screen shows.
 */

export const HELD_BY_APP = "whatsapp_app";

export const CONTROL_MODE = Object.freeze({ AI: "AI", HUMAN: "HUMAN", WAITING: "WAITING", OPTED_OUT: "OPTED_OUT" });

export const CONTROL_MODE_LABEL = Object.freeze({
  AI: "يرد الموظف الذكي",
  HUMAN: "يرد الوسيط",
  WAITING: "بانتظار وسيط",
  OPTED_OUT: "العميل أوقف الرسائل"
});

/** The three office employees, as the conversation shows which one holds it now. */
export const EMPLOYEE = Object.freeze({ SEARCH: "SEARCH", NEGOTIATION: "NEGOTIATION", FOLLOW_UP: "FOLLOW_UP" });
export const EMPLOYEE_LABEL = Object.freeze({ SEARCH: "موظف البحث والمطابقة", NEGOTIATION: "موظف التفاوض", FOLLOW_UP: "موظف المتابعة والمعاينات" });

/** Why the agent stopped, in the office's words. */
export const HANDOFF_REASON_LABEL = Object.freeze({
  BROKER_TAKEOVER: "استلمها وسيط من لوحة المكتب",
  BROKER_REPLIED_IN_APP: "رد شخص من تطبيق واتساب للأعمال",
  CLIENT_ASKED: "العميل طلب موظفًا",
  REVIEW: "تحتاج مراجعة بشرية"
});

export const CONTROL_EVENT_LABEL = Object.freeze({
  TAKEN: "استلم الوسيط المحادثة — توقف الرد الآلي هنا",
  RELEASED: "أُعيدت المحادثة للموظف الذكي",
  TAKEN_IN_APP: "رد شخص من تطبيق واتساب للأعمال — توقف الرد الآلي هنا"
});

export const ROLE_LABEL = Object.freeze({ customer: "العميل", assistant: "الموظف الذكي", broker: "الوسيط" });

export function controlMode(c = {}) {
  if (c.optedOut) return CONTROL_MODE.OPTED_OUT;
  if (!c.handoff) return CONTROL_MODE.AI;
  return c.heldBy ? CONTROL_MODE.HUMAN : CONTROL_MODE.WAITING;
}

/** Which employee is working the thread, read from where the conversation stands. */
export function employeeOf(c = {}) {
  if (c.awaiting === "offer_price") return EMPLOYEE.NEGOTIATION;
  if (c.awaiting === "viewing_time" || c.awaiting === "followup" || c.awaitingReschedule === true) return EMPLOYEE.FOLLOW_UP;
  return EMPLOYEE.SEARCH;
}

export const DAY_MS = 86_400_000;
const millis = (v) => new Date(v?.toDate ? v.toDate() : v || 0).getTime() || 0;

/** A free-text reply from the API is possible only inside the 24-hour customer-service window. */
export function windowOpen(c = {}, now = Date.now()) {
  const last = millis(c.lastInboundAt);
  return last > 0 && now - last < DAY_MS;
}

/**
 * May this member see the conversation? The manager sees all. A broker sees what they hold, and what nobody
 * holds as long as every property case in it is unassigned or theirs.
 */
export function mayView(c = {}, { uid = "", isManager = false } = {}, caseBrokers = []) {
  if (isManager) return true;
  if (!uid) return false;
  if (c.heldBy === uid) return true;
  if (c.heldBy && c.heldBy !== HELD_BY_APP) return false;
  return caseBrokers.every((b) => !b || b === uid);
}

/** May this member take the conversation now? */
export function mayTake(c = {}, { uid = "", isManager = false } = {}) {
  if (c.optedOut) return false;
  if (!c.handoff || !c.heldBy || c.heldBy === HELD_BY_APP) return true;
  return c.heldBy !== uid && isManager;
}

/** May this member hand it back to the agent? */
export function mayRelease(c = {}, { uid = "", isManager = false } = {}) {
  if (c.optedOut || !c.handoff) return false;
  return isManager || !c.heldBy || c.heldBy === uid || c.heldBy === HELD_BY_APP;
}

const ROLE = { customer: "customer", assistant: "assistant", broker: "broker" };

/** Messages and control events in time order (old turns had no time: they keep their place first). */
export function timeline(c = {}) {
  const turns = (Array.isArray(c.turns) ? c.turns : []).map((t, i) => ({ kind: "message", role: ROLE[t.role] || "assistant", text: String(t.text || ""), at: t.at || "", via: t.via || "", state: t.state || "", by: t.by || "", order: i }));
  const control = (Array.isArray(c.controlLog) ? c.controlLog : []).map((e, i) => ({ kind: "control", type: String(e.type || ""), by: e.by || "", at: e.at || "", order: 1000 + i }));
  return [...turns, ...control].sort((a, b) => (millis(a.at) || 0) - (millis(b.at) || 0) || a.order - b.order);
}

/** What the Worker returns for one conversation. The full phone only to whoever answers it (or the manager). */
export function conversationView(c = {}, actor = {}, now = Date.now()) {
  const phone = String(c.senderPhone || "");
  const answers = actor.isManager || (c.heldBy && c.heldBy === actor.uid);
  return {
    id: c.id,
    senderName: String(c.senderName || "").slice(0, 80),
    phone: answers ? phone : "",
    phoneTail: phone.slice(-4),
    mode: controlMode(c),
    employee: employeeOf(c),
    heldBy: c.heldBy || "",
    heldByApp: c.heldBy === HELD_BY_APP,
    heldByMe: Boolean(actor.uid) && c.heldBy === actor.uid,
    handoffReason: c.handoffReason || "",
    controlVersion: Number(c.controlVersion || 0),
    stage: c.stage || "",
    waiting: (Array.isArray(c.pending) ? c.pending : []).length,
    windowOpen: windowOpen(c, now),
    lastInboundAt: c.lastInboundAt ? new Date(millis(c.lastInboundAt)).toISOString() : "",
    updatedAt: c.updatedAt ? new Date(millis(c.updatedAt)).toISOString() : "",
    canTake: mayTake(c, actor),
    canRelease: mayRelease(c, actor),
    canReply: controlMode(c) === CONTROL_MODE.HUMAN && Boolean(actor.uid) && c.heldBy === actor.uid && windowOpen(c, now),
    timeline: timeline(c).slice(-40)
  };
}
