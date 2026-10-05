/**
 * «متابعة الصفقة» — #/deal/<journeyId>: one entry point that gathers the parts of a deal
 * (التفاوض · المعاينة · المستندات · السجل · الإغلاق), its stage and next action, its open tasks,
 * and the two existing ways to reach the sides with what the system knows about each contact.
 *
 * It only reads and links: the existing pages keep their routes and do the work. Opening this
 * page never changes the deal and never sends anything.
 */

import { h, ic, clear, append } from "../core/dom.js";
import { go } from "../core/nav.js";
import { session } from "../core/session.js";
import { recordById, state, subscribe } from "../core/state.js";
import { watchDoc, watchJourneyEvents } from "../core/live.js";
import { rememberDeal, tasksRouteToReturnTo } from "../core/deal-return.js";
import { relativeAgo } from "../domain/format-domain.js";
import { recordView } from "../domain/records-domain.js";
import { isActiveTask, visibleToActor } from "../domain/task-domain.js";
import { dealIdOf, groupDealTasks, subtaskCountLabel } from "../domain/deal-card-domain.js";
import { communicationLog, communicationOptions, followSections, followSummary } from "../domain/deal-follow-domain.js";
import { dealPrimaryControl, dealTaskRows } from "./tasks.js";

export function renderDealHub(container, { journeyId }) {
  let journey;
  let events = [];
  const draw = () => {
    const y = window.scrollY;
    const logOpen = container.querySelector("[data-contact-log]")?.open || false;
    clear(container);
    const toTasks = h("button", { type: "button", class: "os-back", "data-back-to-card": "" }, ic("chev-right"), "بطاقة الصفقة");
    toTasks.addEventListener("click", () => { rememberDeal(journeyId); go(tasksRouteToReturnTo()); });
    append(container, h("div", { class: "os-page-head" }, toTasks, h("h1", { class: "os-page-title", text: "متابعة الصفقة" }), h("span")));
    if (journey === undefined) { append(container, h("div", { class: "os-skeleton" }), h("div", { class: "os-skeleton" })); return; }
    if (!journey) { append(container, h("div", { class: "os-alert bad", text: "الصفقة غير موجودة." })); return; }

    const now = new Date();
    const offer = recordById(journey.offerId) || { ...journey.offerSummary, opportunityKind: "OFFER" };
    const request = recordById(journey.requestId) || null;
    const view = recordView({ ...offer, id: journey.offerId });
    const owner = String(offer.contactName || "").trim();
    const client = String(request?.contactName || "").trim();
    const summary = followSummary(journey, now);
    const mine = state.tasks.filter((task) => isActiveTask(task) && dealIdOf(task) === journeyId && visibleToActor(task, { uid: session.user?.uid, isManager: session.isManager, officeId: session.officeId }));
    const group = groupDealTasks(mine, now).find((item) => item.kind === "deal") || null;
    const primary = group?.primary ? dealPrimaryControl(group.primary, now) : null;
    if (primary) primary.button.classList.add("block");

    // 1 — fixed place for: which deal, which stage, what is needed now (kept short so it can stay in view while scrolling).
    const nowTitle = primary ? primary.title : summary.nextLabel || "لا يوجد إجراء مطلوب منك الآن";
    const nowReason = primary?.model.reason || summary.nextReason;
    append(container, h("section", { class: "os-card os-follow-summary", "data-follow-summary": "" },
      h("div", { class: "os-follow-deal" },
        h("h2", { class: "os-h2", text: [view.propertyType, view.location].filter(Boolean).join(" · ") || "صفقة" }),
        h("span", { class: "ref-status step-" + summary.step, "data-follow-stage": "", text: summary.paused ? `${summary.stage} · متوقفة مؤقتًا` : summary.stage })),
      h("p", { class: "os-follow-now", "data-follow-now": "" },
        group?.urgency.label ? h("span", { class: `ref-urgency is-${group.urgency.level}`, "data-follow-urgency": group.urgency.level, text: group.urgency.label }) : null,
        h("small", { text: "المطلوب الآن: " }), h("b", { text: nowTitle }))));
    // …with its details and the one main button right under it.
    append(container, h("section", { class: "os-card os-follow-next", "data-follow-next": "" },
      owner || client ? h("p", { class: "os-follow-parties" }, ic("users"), h("span", { text: [owner ? `المالك: ${owner}` : "", client ? `العميل: ${client}` : ""].filter(Boolean).join(" · ") })) : null,
      nowReason && nowReason !== nowTitle ? h("p", { class: "os-follow-reason", text: nowReason }) : null,
      primary ? primary.button : null));

    // 2 — the five parts of the deal; each opens the existing page at that part.
    append(container, h("section", { class: "os-card os-follow-sections", "aria-label": "أقسام الصفقة" },
      followSections(journey, { events, now }).map((section) => {
        const row = h("button", { type: "button", class: "os-follow-row" + (section.attention ? " needs" : ""), "data-follow-section": section.id },
          h("span", { class: "os-set-icon" }, ic(section.icon)),
          h("span", { class: "os-set-text" }, h("b", { text: section.label }), h("small", { text: section.status })),
          section.attention ? h("span", { class: "os-follow-dot", "aria-label": "يحتاج متابعتك" }) : null,
          ic("chev-left"));
        row.addEventListener("click", () => go(section.route));
        return row;
      })));

    // 3 — every open task of this deal stays reachable here.
    if (group?.tasks.length) {
      append(container, h("section", { class: "os-card", "data-follow-tasks": String(group.tasks.length) },
        h("h2", { class: "os-h2", style: { marginBottom: "8px" } }, ic("clipboard"), `مهام الصفقة: ${subtaskCountLabel(group.tasks.length)}`),
        h("ul", { class: "ref-deal-subs os-follow-subs" }, dealTaskRows(group.tasks, group.primary, now))));
    }

    // 4 — the two existing ways to reach the sides, and what is known about each contact.
    const log = communicationLog(events);
    append(container, h("section", { class: "os-card os-follow-contact", "data-follow-contact": "" },
      h("h2", { class: "os-h2", style: { marginBottom: "4px" } }, ic("send"), "التواصل مع الطرفين"),
      h("p", { class: "os-sub", style: { marginBottom: "10px" }, text: "طريقتان قائمتان، تختار المناسب لكل حالة. لا يُرسل شيء إلا بضغطك على زر الإرسال في صفحته." }),
      communicationOptions(journey).map((option) => {
        const open = h("button", { type: "button", class: "os-btn secondary", "data-contact-open": option.id, disabled: summary.open ? null : true }, ic(option.icon), option.button);
        open.addEventListener("click", () => go(option.route));
        return h("div", { class: "os-follow-option", "data-contact-option": option.id },
          h("div", { class: "os-set-text" }, h("b", { text: option.label }), h("small", { text: option.what }), h("small", { class: "os-follow-state", "data-contact-state": "", text: option.state })),
          open);
      }),
      h("details", { class: "os-follow-log", "data-contact-log": "", open: logOpen || null },
        h("summary", {}, ic("clock"), h("span", { text: "سجل التواصل" }), h("span", { class: "os-count", text: String(log.length) }), ic("chev-down")),
        log.length
          ? h("ul", { class: "os-follow-log-list" }, log.map((item) => h("li", { "data-contact-event": item.type, "data-contact-certain": String(item.certain) },
            h("span", { class: `os-follow-chip is-${item.state}`, text: item.label }),
            h("span", { class: "os-follow-log-text", text: item.text }),
            h("small", { text: [item.note, relativeAgo(item.at) || ""].filter(Boolean).join(" · ") }))))
          : h("p", { class: "os-sub", text: "لا يوجد تواصل مسجَّل بعد." }),
        h("p", { class: "os-sub os-follow-honest", text: "«فُتح واتساب» تعني أنك فتحت واتساب من هنا فقط؛ النظام لا يستطيع التأكد من أن الرسالة أُرسلت أو وصلت." }))));
    window.scrollTo({ top: y });
  };
  const offs = [
    watchDoc(session.officeId, "journeys", journeyId, (doc) => { journey = doc; draw(); }, () => { journey = null; draw(); }),
    watchJourneyEvents(session.officeId, journeyId, (rows) => { events = rows; if (journey) draw(); }),
    subscribe((kind) => { if ((kind === "tasks" || kind === "records") && journey) draw(); })
  ];
  draw();
  return () => offs.forEach((off) => off && off());
}
