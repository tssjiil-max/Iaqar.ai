/** «مجتمع الوسطاء» data: live cooperation requests of this office + the workflow call (same Worker route as the old app). */

import { api, db, docData } from "./runtime.js";

export function watchCooperation(officeId, onRows, onError) {
  const parts = { out: [], inn: [] };
  const loaded = { out: false, inn: false };
  // Report only once both sides have answered, so the screen never flashes a half list.
  const emit = () => { if (loaded.out && loaded.inn) onRows([...parts.out, ...parts.inn]); };
  const listen = (field, key) => db().collection("cooperationRequests").where(field, "==", officeId).limit(60)
    .onSnapshot((snap) => { parts[key] = snap.docs.map(docData); loaded[key] = true; emit(); }, (error) => onError?.(error));
  const offs = [listen("originatingOfficeId", "out"), listen("targetOfficeId", "inn")];
  return () => offs.forEach((off) => { try { off(); } catch (_) { /* ignore */ } });
}

export function runCooperationAction(officeId, cooperationId, action, reason = "") {
  return api("/cooperation/workflow", { officeId, cooperationId, action, reason });
}
