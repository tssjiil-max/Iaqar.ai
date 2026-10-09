/**
 * Shared office state: live tasks and records, with a tiny subscribe API so views
 * re-render only what they show.
 */

import { watchDoneToday, watchRecords, watchTasks } from "./live.js";
import { riyadhDayStart } from "../domain/agent-domain.js";

const listeners = new Set();

export const state = {
  tasks: [],
  records: [],
  recordsById: new Map(),
  tasksReady: false,
  // «تم إنجازها»: tasks completed today (shared by the home card and Daily Tasks so their numbers agree).
  doneToday: [],
  doneReady: false,
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
  // «اليوم» restarts at Riyadh midnight: the listener is renewed then, so the count never carries yesterday.
  let stopDone = null;
  let dayTimer = 0;
  const watchDone = () => {
    if (stopDone) { try { stopDone(); } catch (_) { /* ignore */ } }
    stopDone = watchDoneToday(officeId, (tasks) => {
      state.doneToday = tasks;
      state.doneReady = true;
      emit("done");
    }, () => { state.doneToday = []; state.doneReady = true; emit("done"); });
    const next = riyadhDayStart(new Date()).getTime() + 86400000 + 1000;
    dayTimer = setTimeout(watchDone, Math.max(60_000, next - Date.now()));
  };
  watchDone();
  unsubs.push(() => { clearTimeout(dayTimer); if (stopDone) stopDone(); });
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
