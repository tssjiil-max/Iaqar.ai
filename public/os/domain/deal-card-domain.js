/**
 * «بطاقة الصفقة» — one main card per deal in «المهام اليومية».
 *
 * A deal (journey) can have several open tasks at once (its own deal card, a reply to review, a
 * request from a side, a viewing result…). They are shown together: one card for the deal with
 * the most pressing action as its one main button, and every other task listed inside it.
 * Nothing is merged, changed or dropped — this is only how the same tasks are displayed.
 * Pure rules shared by the tasks list and «متابعة الصفقة».
 */

import { toDate } from "./format-domain.js";
import { dueOf, isOverdue, isSnoozed, isWaitingTask, sortTasks, taskPathStep, taskTypeOf } from "./task-domain.js";

const DEAL_CARD = "DEAL_JOURNEY";

function typeOf(task = {}) {
  return String(task.type || "").toUpperCase();
}

/** The journey a task belongs to ("" when it is not part of an opened deal). */
export function dealIdOf(task = {}) {
  if (task.journeyId) return String(task.journeyId);
  let meta = task.metadata;
  if (!meta && task.metadataJson) { try { meta = JSON.parse(task.metadataJson); } catch { meta = null; } }
  return meta && meta.journeyId ? String(meta.journeyId) : "";
}

/**
 * The task whose action the deal's main button performs:
 *   1. a task that needs the broker now (overdue first, then by due time and priority);
 *   2. otherwise the deal's own card (opens the page of the current phase);
 *   3. otherwise a task that waits for someone else (reminder).
 */
export function primaryTask(tasks = [], now = new Date()) {
  const sorted = sortTasks(tasks, now);
  const acting = sorted.find((task) => typeOf(task) !== DEAL_CARD && !isWaitingTask(task) && !isSnoozed(task, now) && taskTypeOf(task).needsBroker !== false);
  if (acting) return acting;
  const card = sorted.find((task) => typeOf(task) === DEAL_CARD);
  return card || sorted[0] || null;
}

const PRIORITY_LABEL = Object.freeze({ URGENT: "عاجل", HIGH: "مهم" });

/** How pressing a task is, as the broker reads it: متأخرة · عاجل · مهم · "" . */
export function urgencyOf(task = {}, now = new Date()) {
  if (isOverdue(task, now)) return { level: "late", label: "متأخرة" };
  const priority = String(task.priority || "").toUpperCase();
  if (PRIORITY_LABEL[priority]) return { level: priority === "URGENT" ? "urgent" : "high", label: PRIORITY_LABEL[priority] };
  return { level: "", label: "" };
}

const URGENCY_RANK = Object.freeze({ late: 3, urgent: 2, high: 1, "": 0 });

/** The most pressing state among a deal's tasks — a late task is never hidden behind another one. */
export function worstUrgency(tasks = [], now = new Date()) {
  return tasks.map((task) => urgencyOf(task, now)).reduce((worst, next) => (URGENCY_RANK[next.level] > URGENCY_RANK[worst.level] ? next : worst), { level: "", label: "" });
}

/** The task whose time the deal card shows: a late one first, then the main task, then the deal's own appointment. */
export function dueTaskOf(tasks = [], primary = null, card = null, now = new Date()) {
  return tasks.find((task) => isOverdue(task, now)) || [primary, card, ...tasks].find((task) => task && dueOf(task)) || null;
}

export function taskStateLabel(task = {}, now = new Date()) {
  if (isOverdue(task, now)) return "متأخرة";
  if (isSnoozed(task, now)) return "مؤجلة";
  if (isWaitingTask(task)) return "بانتظار رد";
  return String(task.status || "").toUpperCase() === "IN_PROGRESS" ? "قيد التنفيذ" : "مفتوحة";
}

/**
 * Group the given tasks: one entry per deal, one entry per task that belongs to no deal.
 * The order of the list is kept: a deal sits where its most pressing task was.
 *   { kind: "deal", id, tasks, primary, card, subtasks, step, steps, urgency, dueTask }
 *   { kind: "task", id, task, step, steps }
 * `tasks` of a deal = every task given for that journey; `subtasks` = all of them except the deal card.
 * `step` = the stage shown on the card; `steps` = every stage one of its tasks sits in, so a stage
 * filter never hides a task.
 */
export function groupDealTasks(tasks = [], now = new Date()) {
  const byDeal = new Map();
  for (const task of tasks) {
    const id = dealIdOf(task);
    if (!id) continue;
    if (!byDeal.has(id)) byDeal.set(id, []);
    byDeal.get(id).push(task);
  }
  const out = [];
  const placed = new Set();
  for (const task of sortTasks(tasks, now)) {
    const id = dealIdOf(task);
    if (!id) { const step = taskPathStep(task); out.push({ kind: "task", id: String(task.id || ""), task, step, steps: [step] }); continue; }
    if (placed.has(id)) continue;
    placed.add(id);
    const all = sortTasks(byDeal.get(id), now);
    const card = all.find((item) => typeOf(item) === DEAL_CARD) || null;
    const primary = primaryTask(all, now);
    const subtasks = all.filter((item) => typeOf(item) !== DEAL_CARD);
    // The deal's stage is the stage of the deal itself; without a deal card (older deals) it is the stage of its main task.
    const step = card ? taskPathStep(card) : taskPathStep(primary);
    const steps = [...new Set([step, ...all.map((item) => taskPathStep(item))])].sort((a, b) => a - b);
    const dueTask = dueTaskOf(all, primary, card, now);
    out.push({ kind: "deal", id, tasks: all, primary, card, subtasks, step, steps, urgency: worstUrgency(all, now), dueTask, due: toDate(dueTask ? dueOf(dueTask) : null) });
  }
  return out;
}

const stepsOf = (group) => (Array.isArray(group.steps) && group.steps.length ? group.steps : [group.step]);

/** [n0 … n4] — how many cards (deals and single tasks) have work in each open stage. */
export function countGroupsByStep(groups = []) {
  const counts = [0, 0, 0, 0, 0];
  for (const group of groups) for (const step of stepsOf(group)) if (step >= 0 && step < 5) counts[step] += 1;
  return counts;
}

/** The cards with work in a stage: a deal is listed under every stage one of its tasks sits in. */
export function filterGroupsByStep(groups = [], step = null) {
  if (step === null || step === undefined) return groups;
  return groups.filter((group) => stepsOf(group).includes(step));
}

export function cardCountLabel(n) {
  if (n === 0) return "لا مهام";
  if (n === 1) return "بطاقة واحدة";
  if (n === 2) return "بطاقتان";
  if (n <= 10) return `${n} بطاقات`;
  return `${n} بطاقة`;
}

export function subtaskCountLabel(n) {
  if (n === 1) return "مهمة واحدة";
  if (n === 2) return "مهمتان";
  if (n <= 10) return `${n} مهام`;
  return `${n} مهمة`;
}
