/**
 * Shared office state: live tasks and records, with a tiny subscribe API so views
 * re-render only what they show.
 */

import { watchRecords, watchTasks } from "./live.js";

const listeners = new Set();

export const state = {
  tasks: [],
  records: [],
  recordsById: new Map(),
  tasksReady: false,
  recordsReady: false,
  error: ""
};

let unsubs = [];

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(kind) {
  for (const fn of listeners) {
    try { fn(kind); } catch (error) { console.warn("[office-os] view update", error); }
  }
}

export function startOfficeData(officeId) {
  stopOfficeData();
  unsubs.push(watchTasks(officeId, (tasks) => {
    state.tasks = tasks;
    state.tasksReady = true;
    emit("tasks");
  }, () => { state.error = "تعذر تحميل المهام"; state.tasksReady = true; emit("tasks"); }));
  unsubs.push(watchRecords(officeId, (records) => {
    state.records = records;
    state.recordsById = new Map(records.map((r) => [r.id, r]));
    state.recordsReady = true;
    emit("records");
  }, () => { state.error = "تعذر تحميل العروض والطلبات"; state.recordsReady = true; emit("records"); }));
}

export function stopOfficeData() {
  for (const off of unsubs) { try { off(); } catch (_) { /* ignore */ } }
  unsubs = [];
}

export function recordById(id) {
  return state.recordsById.get(id) || null;
}
