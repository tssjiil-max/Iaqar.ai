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
