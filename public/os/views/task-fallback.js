/** Tasks without a dedicated screen (platform offer, external reply, system action) — handled inside Office OS, never in the old app. */

import { h, ic } from "../core/dom.js";
import { go } from "../core/nav.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { openSheet, runAction } from "../core/ui.js";

export function openGeneralTask(task) {
  const type = String(task.type || "").toUpperCase();
  const title = task.titleText || "مهمة";
  const summary = task.summaryText || "";
  const body = h("div", { class: "os-form", "data-general-task": type },
    summary ? h("p", { class: "os-sub", text: summary }) : h("p", { class: "os-sub", text: "لا توجد تفاصيل إضافية لهذه المهمة." }));
  const sheet = openSheet(title, body);
  const opportunityId = String(task.opportunityId || "");
  if (type === "PLATFORM_OPPORTUNITY_OFFER" && opportunityId) {
    const accept = h("button", { type: "button", class: "os-btn primary block", "data-platform-accept": "" }, ic("check"), "استلام الفرصة");
    accept.addEventListener("click", () => runAction(accept, async () => {
      await api("/opportunity-router/accept", { officeId: session.officeId, opportunityId });
      sheet.close(); go(`record/${opportunityId}`);
    }, { success: "تم استلام الفرصة" }));
    const decline = h("button", { type: "button", class: "os-btn secondary block", "data-platform-decline": "" }, "اعتذار");
    decline.addEventListener("click", () => runAction(decline, async () => {
      await api("/opportunity-router/decline", { officeId: session.officeId, opportunityId, reason: "not_suitable" });
      sheet.close();
    }, { success: "تم الاعتذار عن الفرصة" }));
    body.append(accept, decline);
  } else if (opportunityId) {
    const open = h("button", { type: "button", class: "os-btn primary block", "data-open-record": "" }, "فتح السجل");
    open.addEventListener("click", () => { sheet.close(); go(`record/${opportunityId}`); });
    body.append(open);
  }
}
