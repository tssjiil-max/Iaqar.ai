/** Record actions shared by the repository list and the record page. */

import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { confirmDialog, runAction, toast } from "../core/ui.js";
import { recordView } from "../domain/records-domain.js";

export async function removeRecordFlow(record, { button = null, onDone } = {}) {
  const view = recordView(record);
  const ok = await confirmDialog({
    title: `حذف «${view.title}»؟`,
    text: "لن يدخل السجل في مطابقات جديدة. إن كان مرتبطًا بفرص سابقة فسيُؤرشف مع حفظ تاريخه.",
    confirmLabel: "حذف",
    danger: true
  });
  if (!ok) return null;
  const result = await runAction(button, () => api("/os/records/remove", { officeId: session.officeId, recordId: view.id }));
  if (result?.ok) {
    toast(result.mode === "archived" ? "تمت أرشفة السجل مع حفظ تاريخه" : "تم حذف السجل", "ok");
    if (onDone) onDone(result);
  }
  return result;
}

export async function restoreRecordFlow(record, { button = null } = {}) {
  const result = await runAction(button, () => api("/os/records/restore", { officeId: session.officeId, recordId: record.id }), { success: "أعيد السجل إلى المستودع النشط" });
  return result;
}

/** «إيقاف»: out of matching for now, back with one press. Nothing is lost. */
export async function pauseRecordFlow(record, { button = null, onDone } = {}) {
  const view = recordView(record);
  const ok = await confirmDialog({
    title: `إيقاف «${view.title}» مؤقتًا؟`,
    text: "لن يدخل السجل في مطابقات جديدة حتى تستأنفه. بياناته وتاريخه محفوظة.",
    confirmLabel: "إيقاف مؤقت"
  });
  if (!ok) return null;
  const result = await runAction(button, () => api("/os/records/pause", { officeId: session.officeId, recordId: view.id }));
  if (result?.ok) { toast("تم إيقاف السجل مؤقتًا", "ok"); if (onDone) onDone(result); }
  return result;
}

/** «أرشفة»: filed away with its full history; can be returned to the active list. */
export async function archiveRecordFlow(record, { button = null, onDone } = {}) {
  const view = recordView(record);
  const ok = await confirmDialog({
    title: `أرشفة «${view.title}»؟`,
    text: "يخرج السجل من القائمة النشطة ومن المطابقات، ويبقى تاريخه كاملًا. يمكنك إعادته لاحقًا.",
    confirmLabel: "أرشفة"
  });
  if (!ok) return null;
  const result = await runAction(button, () => api("/os/records/archive", { officeId: session.officeId, recordId: view.id }));
  if (result?.ok) { toast("تمت أرشفة السجل", "ok"); if (onDone) onDone(result); }
  return result;
}

/**
 * «حجز رسمي»: a manager's own decision. The offer leaves new public matches immediately; a second
 * reservation for another deal is refused by the server (compare-and-set). Cancel releases it.
 */
export async function reserveRecordFlow(record, { button = null, journeyId = "", onDone } = {}) {
  const view = recordView(record);
  const ok = await confirmDialog({
    title: `حجز «${view.title}» رسميًا؟`,
    text: "يخرج العقار من نتائج البحث والمطابقات الجديدة فورًا. لا يُعتمد حجز آخر عليه حتى تلغي هذا الحجز.",
    confirmLabel: "حجز رسمي"
  });
  if (!ok) return null;
  const result = await runAction(button, () => api("/os/records/reserve", { officeId: session.officeId, recordId: view.id, journeyId }));
  if (result?.ok) { toast("تم الحجز الرسمي", "ok"); if (onDone) onDone(result); }
  return result;
}

export async function releaseReservationFlow(record, { button = null, onDone } = {}) {
  const view = recordView(record);
  const ok = await confirmDialog({
    title: `إلغاء الحجز الرسمي لـ«${view.title}»؟`,
    text: "يعود العقار متاحًا في نتائج البحث والمطابقات.",
    confirmLabel: "إلغاء الحجز", cancelLabel: "تراجع", danger: true
  });
  if (!ok) return null;
  const result = await runAction(button, () => api("/os/records/release", { officeId: session.officeId, recordId: view.id }));
  if (result?.ok) { toast("أُلغي الحجز الرسمي", "ok"); if (onDone) onDone(result); }
  return result;
}
