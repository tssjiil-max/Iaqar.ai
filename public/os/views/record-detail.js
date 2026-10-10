/** Record details + linked opportunities + manual search for suitable options. */

import { partyBotRow } from "./bot-settings.js";
import { externalCooperationPanel } from "./external-cooperation.js";
import { isExternalBroker } from "../domain/external-broker-domain.js";
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
import { archiveRecordFlow, pauseRecordFlow, removeRecordFlow, restoreRecordFlow } from "./record-actions.js";
import { imageGallery } from "./record-images.js";
import { ANSWER, STATE, answerOptions, validityView } from "../domain/validity-domain.js";

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

  // Built once per visit: a redraw (live data) must not ask the server again or drop a link just made.
  let botRow = null;
  let botRowFor = "";
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
    // Manage the record: تعديل · إيقاف/استئناف · أرشفة · حذف. Every destructive step asks first; history is never destroyed.
    const act = (label, iconName, kind, name, onClick) => h("button", { type: "button", class: `os-btn ${kind}`, "data-record-action": name, onClick }, ic(iconName), label);
    const actions = h("div", { class: "os-record-actions", "data-record-actions": "" },
      view.state !== "DELETED" ? act("تعديل", "edit", "secondary", "edit", () => go(`record/${view.id}/edit`)) : null,
      view.state === "ACTIVE" ? act("إيقاف", "pause", "secondary", "pause", (e) => pauseRecordFlow(record, { button: e.currentTarget })) : null,
      view.state === "PAUSED" ? act("استئناف", "play", "soft", "resume", (e) => restoreRecordFlow(record, { button: e.currentTarget })) : null,
      view.state === "ACTIVE" || view.state === "PAUSED" ? act("أرشفة", "archive", "secondary", "archive", (e) => archiveRecordFlow(record, { button: e.currentTarget })) : null,
      view.state === "ARCHIVED" ? act("إعادة للنشطة", "restore", "soft", "restore", (e) => restoreRecordFlow(record, { button: e.currentTarget })) : null,
      view.state !== "DELETED" ? act("حذف", "trash", "danger", "delete", (e) => removeRecordFlow(record, { button: e.currentTarget, onDone: () => go("repo") })) : null
    );
    append(container, h("div", { class: "os-card" },
      h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "6px" } },
        h("span", { class: `os-badge${isRequest ? "" : " ok"}`, text: `${view.kindLabel} · ${view.purposeLabel}` }),
        isExternalBroker(record) ? h("span", { class: "os-badge", text: "وسيط متعاون" }) : null,
        h("span", { class: `os-badge${view.state === "ACTIVE" ? "" : " muted"}`, "data-record-state": view.state, text: view.lifecycleLabel })),
      h("h2", { class: "os-task-title", text: view.title }),
      isRequest ? h("p", { class: "os-sub", text: "احتياج العميل ومواصفاته وميزانيته." }) : imageGallery(record),
      h("div", { class: "os-facts", style: { marginTop: "10px" } },
        fact("coins", isRequest ? "الميزانية" : "السعر", view.priceLabel.replace(/^(السعر|الميزانية) /, "")),
        isRequest ? null : fact("tag", "حالة السعر", view.priceStatusLabel),
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
      // «بوت المكتب»: is this person on the bot, and the link to give him (hidden where the bot is not available).
      // …but a changed mobile is a different person to the bot, so the row is rebuilt then.
      isExternalBroker(record) ? null : (botRow = botRow && botRowFor === String(view.contactPhone || "") ? botRow : ((botRowFor = String(view.contactPhone || "")), partyBotRow(record, { who: isRequest ? "العميل" : "المالك" }))),
      h("div", { style: { marginTop: "12px" } }, actions)
    ));
    append(container, externalCooperationPanel(record));

    // «الصلاحية والتوفر»: the record's own facts and one-tap answers (same record; nothing is deleted).
    if (view.state !== "DELETED") {
      const v = validityView(record);
      const tone = v.state === STATE.ACTIVE || v.state === STATE.LEGACY ? "" : " muted";
      const answer = (id, label, kind = "secondary") => {
        const b = h("button", { type: "button", class: `os-btn ${kind}`, "data-validity-answer": id }, label);
        b.addEventListener("click", () => runAction(b, () => api(id === "REACTIVATE" ? "/os/records/reactivate" : "/os/records/availability", { officeId: session.officeId, recordId: view.id, ...(id === "REACTIVATE" ? {} : { answer: id }) }),
          { success: id === "REACTIVATE" ? "عاد السجل نشطًا بمدة جديدة" : id === ANSWER.AVAILABLE || id === ANSWER.STILL_LOOKING ? "تم التأكيد والتجديد" : "تم تحديث التوفر — توقفت مطابقاته الجديدة" }));
        return b;
      };
      const options = answerOptions(view.kind, record.purpose).filter((o) => o.id !== ANSWER.EDIT && o.id !== ANSWER.PAUSE);
      const reopen = [STATE.EXPIRED, STATE.UNAVAILABLE, STATE.NEEDS_CONFIRMATION].includes(v.state);
      append(container, h("div", { class: "os-card", "data-validity-card": v.state },
        h("div", { class: "os-card-head" }, h("h2", { class: "os-h2" }, ic("clock"), "الصلاحية والتوفر"), h("span", { class: `os-badge${tone}`, "data-validity-state": v.state, text: v.label })),
        h("p", { class: "os-sub", text: [v.duration, v.urgent ? "مستعجل" : "", v.remaining, v.periodic, v.lastConfirmed].filter(Boolean).join(" · ") || "لم تُحدد مدة لهذا السجل بعد — يبقى في المطابقة كما كان." }),
        v.reason && v.state !== STATE.ACTIVE ? h("p", { class: "os-sub", "data-validity-reason": "", text: `السبب: ${v.reason}` }) : null,
        h("div", { class: "os-btn-row" },
          ...([STATE.PAUSED, STATE.ARCHIVED].includes(v.state) ? [] : reopen && v.state !== STATE.NEEDS_CONFIRMATION ? [answer("REACTIVATE", "إعادة تفعيل بمدة جديدة", "soft")] : options.map((o, i) => answer(o.id, o.label, i === 0 ? "soft" : "secondary"))))));
    }

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
