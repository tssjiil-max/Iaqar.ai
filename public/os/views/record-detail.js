/** Record details + linked opportunities + manual search for suitable options. */

import { h, ic, clear, emptyState, append } from "../core/dom.js";
import { back, go } from "../core/nav.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { recordById, state, subscribe } from "../core/state.js";
import { journeysForRecord } from "../core/live.js";
import { runAction } from "../core/ui.js";
import { MISSING_LABELS, RECORD_KIND, recordView } from "../domain/records-domain.js";
import { JOURNEY_STATUS_LABEL, STAGE_LABEL, isJourneyOpen } from "../domain/journey-domain.js";
import { buildWhatsAppUrl, formatDateTime } from "../domain/format-domain.js";
import { removeRecordFlow, restoreRecordFlow } from "./record-actions.js";

function fact(iconName, label, value) {
  if (!value) return null;
  return h("div", { class: "os-fact" }, h("div", { class: "ic" }, ic(iconName)), h("div", {}, h("b", { text: label }), h("span", { text: value })));
}

function candidatesPanel(record) {
  const view = recordView(record);
  const panel = h("div", { class: "os-card" });
  const listEl = h("div", { class: "os-form" });
  const searchBtn = h("button", { type: "button", class: "os-btn secondary block" }, ic("search"), "بحث عن خيارات مناسبة");
  searchBtn.addEventListener("click", () => runAction(searchBtn, async () => {
    const result = await api("/os/records/candidates", { officeId: session.officeId, recordId: view.id });
    clear(listEl);
    if (!result.candidates?.length) {
      append(listEl, emptyState("search", "لا توجد خيارات مناسبة الآن", "سيُعاد فحص السجل تلقائيًا عند إضافة عروض أو طلبات جديدة."));
      return;
    }
    for (const c of result.candidates) {
      const other = recordById(c.recordId);
      const otherView = other ? recordView(other) : null;
      const pairBtn = h("button", { type: "button", class: "os-btn soft" }, ic("doc-check"), c.inOpenJourney ? "مفتوحة كفرصة" : "مراجعة هذه المطابقة");
      if (c.inOpenJourney) pairBtn.disabled = true;
      pairBtn.addEventListener("click", () => runAction(pairBtn, async () => {
        const res = await api("/os/records/pair", { officeId: session.officeId, recordId: view.id, counterpartId: c.recordId });
        if (res.alreadyOpen && res.journeyId) go(`journey/${res.journeyId}`);
        else if (res.matchId) go(`review/${res.matchId}`);
      }));
      append(listEl, h("div", { class: "os-party" },
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
          h("b", { style: { color: "var(--navy)" }, text: otherView?.title || "سجل" }),
          h("span", { class: `os-badge${c.belowThreshold ? " muted" : ""}`, text: `${c.level} · ${c.score} من 100` })
        ),
        otherView ? h("p", { class: "os-sub", text: [otherView.priceLabel, otherView.location, otherView.areaLabel].filter(Boolean).join(" · ") }) : null,
        h("ul", { class: "os-list", style: { margin: "6px 0" } },
          c.reasons.map((r) => h("li", { class: "good" }, ic("check"), r)),
          c.warnings.map((w) => h("li", { class: "warn" }, ic("alert"), w))),
        c.belowThreshold ? h("p", { class: "os-sub", style: { fontSize: ".85rem" }, text: "أقل من حد المطابقة التلقائية — القرار لك بعد المراجعة." }) : null,
        pairBtn
      ));
    }
  }));
  append(panel, h("div", { class: "os-card-head" }, h("h2", { class: "os-h2" }, ic("search"), "خيارات مناسبة")),
    h("p", { class: "os-sub", style: { marginBottom: "10px" }, text: "يفحص النظام السجلات تلقائيًا، ويمكنك البحث يدويًا هنا. الدرجة يحسبها محرك المطابقة." }),
    searchBtn, h("div", { style: { marginTop: "10px" } }, listEl));
  return { panel, searchBtn };
}

export function renderRecordDetail(container, { recordId }) {
  const autoSearch = new URLSearchParams(location.hash.split("?")[1] || "").get("search") === "1";
  let linked = null;
  let searchStarted = false;
  journeysForRecord(session.officeId, recordId).then((rows) => { linked = rows; draw(); }).catch(() => { linked = []; draw(); });

  const draw = () => {
    const record = recordById(recordId);
    clear(container);
    const head = h("div", { class: "os-page-head" },
      h("button", { type: "button", class: "os-back", onClick: () => back("repo") }, ic("chev-right"), "العروض والطلبات"),
      h("h1", { class: "os-page-title", text: "تفاصيل السجل" }),
      record ? h("span", { class: "os-ref", text: `#${recordView(record).reference}` }) : h("span"));
    append(container, head);
    if (!record) {
      append(container, state.recordsReady ? h("div", { class: "os-alert bad", text: "السجل غير موجود أو حُذف." }) : h("div", { class: "os-skeleton" }));
      return;
    }
    const view = recordView(record);
    const isRequest = view.kind === RECORD_KIND.REQUEST;
    const wa = buildWhatsAppUrl(view.contactPhone, "");
    const actions = h("div", { class: "os-btn-row" },
      view.lifecycle !== "DELETED" ? h("button", { type: "button", class: "os-btn secondary", onClick: () => go(`record/${view.id}/edit`) }, ic("edit"), "تعديل") : null,
      view.lifecycle === "ACTIVE" ? h("button", { type: "button", class: "os-btn danger", onClick: (e) => removeRecordFlow(record, { button: e.currentTarget, onDone: () => go("repo") }) }, ic("trash"), "حذف") : null,
      view.lifecycle === "ARCHIVED" ? h("button", { type: "button", class: "os-btn soft", onClick: (e) => restoreRecordFlow(record, { button: e.currentTarget }) }, ic("restore"), "إعادة للنشطة") : null
    );
    append(container, h("div", { class: "os-card" },
      h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "6px" } },
        h("span", { class: `os-badge${isRequest ? "" : " ok"}`, text: `${view.kindLabel} · ${view.purposeLabel}` }),
        h("span", { class: `os-badge${view.lifecycle === "ACTIVE" ? "" : " muted"}`, text: view.lifecycleLabel })),
      h("h2", { class: "os-task-title", text: view.title }),
      isRequest ? h("p", { class: "os-sub", text: "احتياج العميل ومواصفاته وميزانيته." }) : null,
      h("div", { class: "os-facts", style: { marginTop: "10px" } },
        fact("coins", isRequest ? "الميزانية" : "السعر", view.priceLabel.replace(/^(السعر|الميزانية) /, "")),
        fact("pin", "الموقع", view.location),
        fact("building", "نوع العقار", view.propertyType),
        fact("area", "المساحة", view.areaLabel || "غير محددة"),
        view.rooms ? fact("bed", "الغرف", String(view.rooms)) : null),
      view.notes ? h("p", { style: { margin: "10px 0 0" }, text: view.notes }) : null,
      view.missing.length ? h("div", { class: "os-alert warn", style: { marginTop: "10px" }, text: `بيانات ناقصة للمطابقة: ${view.missing.map((k) => MISSING_LABELS[k] || k).join("، ")}` }) : null,
      h("hr", { class: "os-divider" }),
      h("div", { class: "os-party-head" }, h("div", { class: "av" }, ic("user")),
        h("div", {}, h("b", { text: view.contactName || (isRequest ? "العميل" : "المالك") }), h("span", { dir: "ltr", text: view.contactPhone || "بدون رقم" }))),
      view.contactPhone ? h("div", { class: "os-btn-row", style: { marginTop: "10px" } },
        h("a", { class: "os-btn secondary", href: `tel:${view.contactPhone}` }, ic("phone"), "اتصال"),
        wa ? h("a", { class: "os-btn whatsapp", href: wa, target: "_blank", rel: "noopener" }, ic("whatsapp"), "واتساب") : null) : null,
      h("div", { style: { marginTop: "12px" } }, actions)
    ));

    // Linked opportunities + pending reviews
    const reviews = state.tasks.filter((t) => String(t.type).toUpperCase() === "MATCH_REVIEW" && (t.offerId === recordId || t.requestId === recordId || t.opportunityId === recordId));
    const linkCard = h("div", { class: "os-card" }, h("div", { class: "os-card-head" }, h("h2", { class: "os-h2" }, ic("handshake"), "الفرص المرتبطة")));
    if (linked === null) append(linkCard, h("div", { class: "os-skeleton", style: { height: "60px" } }));
    else if (!linked.length && !reviews.length) append(linkCard, h("p", { class: "os-sub", text: "لا توجد فرص مرتبطة بعد. السجل محفوظ ويُعاد فحصه عند وصول بيانات مناسبة." }));
    for (const task of reviews) {
      append(linkCard, h("button", { type: "button", class: "os-btn soft block", style: { marginBottom: "6px", justifyContent: "space-between" }, onClick: () => go(`review/${task.matchId}`) },
        h("span", { text: "مطابقة بانتظار مراجعتك" }), ic("chev-left")));
    }
    for (const j of linked || []) {
      append(linkCard, h("button", { type: "button", class: "os-btn secondary block", style: { marginBottom: "6px", justifyContent: "space-between" }, onClick: () => go(`journey/${j.id}`) },
        h("span", { text: `${isJourneyOpen(j) ? STAGE_LABEL[j.stage] || "" : JOURNEY_STATUS_LABEL[j.status] || ""} · ${formatDateTime(j.updatedAt)}` }), ic("chev-left")));
    }
    append(container, linkCard);
    if (view.lifecycle === "ACTIVE") {
      const { panel, searchBtn } = candidatesPanel(record);
      append(container, panel);
      if (autoSearch && !searchStarted) { searchStarted = true; setTimeout(() => searchBtn.click(), 50); }
    }
  };
  draw();
  const off = subscribe((k) => { if (k === "records" || k === "tasks") { if (!document.querySelector(".os-party")) draw(); } });
  return () => off();
}
