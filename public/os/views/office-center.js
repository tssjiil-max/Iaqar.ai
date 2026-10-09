/**
 * Three office-wide screens:
 *   #/inbox    «مركز التواصل» — what arrived on the channels, with its class
 *   #/search   «البحث الشامل» — one box over records, deals, closed deals, documents, messages
 *   #/audit    «سجل النشاط»  — who did what and when (manager)
 * All read the office's own data (member-read by the rules); changes go through the Worker.
 */

import { h, ic, clear, append, emptyState } from "../core/dom.js";
import { back, go } from "../core/nav.js";
import { session } from "../core/session.js";
import { state, subscribe } from "../core/state.js";
import { api } from "../core/runtime.js";
import { runAction } from "../core/ui.js";
import { listAuditLog, listClosedJourneys, listMembers, watchInbox } from "../core/live.js";
import { listLibrary } from "../core/library.js";
import { relativeAgo } from "../domain/format-domain.js";
import { recordView } from "../domain/records-domain.js";
import { closedDealsFor, visibleToActor } from "../domain/task-domain.js";
import { MESSAGE_CLASS_LABEL, MESSAGE_CLASS_ORDER, countByClass, filterInbox, inboxItemView } from "../domain/message-class-domain.js";
import { MIN_QUERY, searchOffice } from "../domain/search-domain.js";
import { AUDIT_FILTERS, auditViews, filterAudit } from "../domain/audit-domain.js";

function pageHead(title) {
  return h("div", { class: "os-page-head" },
    h("button", { type: "button", class: "os-back", onClick: () => back("office") }, ic("chev-right"), "رجوع"),
    h("h1", { class: "os-page-title", text: title }), h("span"));
}

function chips(options, selected, onPick, attr) {
  const row = h("div", { class: "os-chips os-center-chips", role: "group" });
  for (const option of options) {
    const chip = h("button", { type: "button", class: "os-chip", "aria-pressed": String(option.id === selected), [attr]: option.id },
      option.label, option.count === undefined ? null : h("span", { class: "n", text: String(option.count) }));
    chip.addEventListener("click", () => onPick(option.id));
    row.append(chip);
  }
  return row;
}

// ------------------------------------------------------------------ مركز التواصل

export function renderInbox(container) {
  const body = h("div", { "data-inbox": "" }, h("div", { class: "os-skeleton" }));
  append(container, pageHead("مركز التواصل"), body);
  let items = null;
  let selected = "ALL";
  let failed = false;

  const card = (view) => {
    const convert = view.canConvert ? h("button", { type: "button", class: "os-btn secondary", "data-inbox-convert": view.id }, ic("plus"), "حوّلها إلى عرض أو طلب") : null;
    if (convert) convert.addEventListener("click", () => runAction(convert, async () => {
      const result = await api("/os/inbox/convert", { officeId: session.officeId, inboxId: view.id });
      if (result.recordId) go(`record/${result.recordId}`);
    }, { success: "بدأت معالجة الرسالة — سيظهر السجل في العروض والطلبات" }));
    const open = view.recordId ? h("button", { type: "button", class: "os-btn secondary", "data-inbox-record": view.recordId, onClick: () => go(`record/${view.recordId}`) }, ic("eye"), "فتح السجل") : null;
    return h("article", { class: "os-card os-inbox-card", "data-inbox-item": view.id, "data-message-class": view.messageClass, "data-inbox-state": view.state },
      h("header", { class: "os-inbox-head" },
        h("span", { class: `os-inbox-class is-${view.messageClass.toLowerCase()}`, text: view.classLabel }),
        h("span", { class: "os-inbox-meta" }, ic(view.channel === "telegram" ? "telegram" : view.channel === "whatsapp" ? "whatsapp" : "mail"), view.channelLabel),
        h("small", { class: "os-sub", text: relativeAgo(view.receivedAt) || "" })),
      h("p", { class: "os-inbox-text", dir: "auto", text: view.hasText ? view.text : "رسالة وسائط بلا نص" }),
      h("footer", { class: "os-inbox-foot" },
        h("small", { class: "os-sub", text: `${view.sender} · ${view.stateLabel}` }),
        view.reason && view.kept ? h("small", { class: "os-sub", "data-inbox-reason": "", text: `لماذا لم تتحول تلقائيًا: ${view.reason}` }) : null),
      convert || open ? h("div", { class: "os-btn-row" }, convert, open) : null);
  };

  const draw = () => {
    clear(body);
    if (failed) return append(body, h("div", { class: "os-alert bad", text: "تعذر تحميل الرسائل." }));
    if (!items) return append(body, h("div", { class: "os-skeleton" }));
    const views = items.map(inboxItemView);
    const counts = countByClass(views);
    const options = [{ id: "ALL", label: "الكل", count: views.length }, ...MESSAGE_CLASS_ORDER.filter((key) => counts[key]).map((key) => ({ id: key, label: MESSAGE_CLASS_LABEL[key], count: counts[key] }))];
    if (!options.some((option) => option.id === selected)) selected = "ALL";
    const shown = filterInbox(views, selected);
    append(body,
      h("p", { class: "os-sub", text: "كل ما يصل من قنوات المكتب يظهر هنا بتصنيفه. العروض والطلبات تُعالج تلقائيًا، أما التحية والاستفسار ومتابعة الصفقات فتبقى لك دون أن تتحول إلى سجلات." }),
      views.length ? chips(options, selected, (id) => { selected = id; draw(); }, "data-inbox-filter") : null,
      shown.length ? h("div", { class: "os-center-list" }, ...shown.map(card))
        : emptyState("inbox-in", "لا توجد رسائل بعد", "عند ربط واتساب أو تيليجرام تظهر الرسائل الواردة هنا.",
          session.isManager ? h("button", { type: "button", class: "os-btn primary", onClick: () => go("settings/channels") }, ic("link"), "قنوات المكتب") : null));
  };
  const stop = watchInbox(session.officeId, (docs) => { items = docs; failed = false; draw(); }, () => { failed = true; draw(); });
  return () => { try { stop(); } catch (_) { /* ignore */ } };
}

// ------------------------------------------------------------------ البحث الشامل

export function renderSearch(container, { query = "" } = {}) {
  const input = h("input", { class: "os-input", type: "search", inputmode: "search", autocomplete: "off", placeholder: "اسم، حي، نوع عقار، رقم جوال، سعر، مرجع…", "aria-label": "البحث الشامل", "data-search-input": "", value: query });
  const results = h("div", { "data-search-results": "" });
  append(container, pageHead("البحث الشامل"), h("div", { class: "os-search" }, ic("search"), input), results);
  const extra = { closed: [], documents: [], messages: [] };
  const mine = () => state.tasks.filter((task) => visibleToActor(task, { uid: session.user?.uid, isManager: session.isManager, officeId: session.officeId }));

  const draw = () => {
    clear(results);
    const found = searchOffice({ query: input.value, records: state.records, tasks: mine(), ...extra });
    if (!found.ready) return append(results, h("p", { class: "os-sub", "data-search-hint": "", text: `اكتب ${MIN_QUERY} أحرف على الأقل. البحث يشمل العروض والطلبات والصفقات الجارية والمغلقة ومستندات المكتبة ورسائل مركز التواصل.` }));
    if (!found.total) return append(results, emptyState("search", "لا توجد نتائج", `لم نجد ما يطابق «${found.query}». جرّب كلمة أقل أو تهجئة أخرى.`));
    append(results, h("p", { class: "os-sub", "data-search-total": String(found.total), text: `النتائج: ${found.total}` }));
    for (const group of found.groups) {
      append(results, h("section", { class: "os-center-group", "data-search-group": group.id },
        h("h2", { class: "os-h2" }, group.label, h("span", { class: "os-center-count", text: String(group.count) })),
        h("div", { class: "os-center-list" }, ...group.items.map((item) => h("button", { type: "button", class: "os-card os-center-row", "data-search-item": item.id, onClick: () => go(item.route) },
          h("span", { class: "os-set-text" }, h("b", { text: item.title, dir: "auto" }), item.sub ? h("small", { text: item.sub, dir: "auto" }) : null),
          h("span", { class: "os-center-tag", text: item.tag }), ic("chev-left")))),
        group.count > group.items.length ? h("p", { class: "os-sub", text: `يظهر أول ${group.items.length} — اكتب كلمة إضافية لتضييق النتائج.` }) : null));
    }
  };
  let timer = 0;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(draw, 120); });
  const unsubscribe = subscribe(draw);
  let closed = false;
  // Data that is not already live on this device is fetched once; a failure only narrows the search.
  Promise.allSettled([listClosedJourneys(session.officeId), listLibrary(), new Promise((resolve, reject) => {
    const stop = watchInbox(session.officeId, (docs) => { stop(); resolve(docs); }, reject);
  })]).then(([deals, documents, messages]) => {
    if (closed) return;
    extra.closed = deals.status === "fulfilled" ? closedDealsFor(deals.value, { uid: session.user?.uid, isManager: session.isManager }) : [];
    extra.documents = documents.status === "fulfilled" ? documents.value : [];
    extra.messages = messages.status === "fulfilled" ? messages.value : [];
    draw();
  });
  draw();
  setTimeout(() => input.focus(), 0);
  return () => { closed = true; clearTimeout(timer); unsubscribe(); };
}

// ------------------------------------------------------------------ سجل النشاط

export function renderAudit(container) {
  const body = h("div", { "data-audit": "" }, h("div", { class: "os-skeleton" }));
  append(container, pageHead("سجل النشاط"), body);
  if (!session.isManager) {
    clear(body);
    append(body, h("div", { class: "os-alert warn", text: "سجل النشاط لمدير المكتب فقط." }));
    return null;
  }
  let selected = "ALL";
  let views = [];
  const draw = () => {
    clear(body);
    const shown = filterAudit(views, selected);
    append(body,
      h("p", { class: "os-sub", text: "كل إجراء مهم يُسجَّل هنا تلقائيًا: من فعل ماذا ومتى. السجل للقراءة فقط ولا يمكن تعديله." }),
      chips(AUDIT_FILTERS.map((filter) => ({ ...filter, count: filterAudit(views, filter.id).length })), selected, (id) => { selected = id; draw(); }, "data-audit-filter"),
      shown.length ? h("div", { class: "os-center-list" }, ...shown.map((view) => {
        const row = h(view.route ? "button" : "div", { class: "os-card os-center-row", "data-audit-item": view.id, "data-audit-action": view.action, ...(view.route ? { type: "button" } : {}) },
          h("span", { class: "os-set-text" },
            h("b", { text: `${view.actor} ${view.text}` }),
            view.detail ? h("small", { text: view.detail, dir: "auto" }) : null,
            h("small", { text: relativeAgo(view.at) || "" })),
          view.route ? ic("chev-left") : null);
        if (view.route) row.addEventListener("click", () => go(view.route));
        return row;
      })) : emptyState("clipboard", "لا يوجد نشاط مسجَّل", "ستظهر هنا إجراءات المكتب عند حدوثها."));
  };
  Promise.all([listAuditLog(session.officeId), listMembers(session.officeId).catch(() => [])]).then(([entries, members]) => {
    const memberNames = Object.fromEntries(members.map((member) => [String(member.uid || member.id || ""), String(member.displayName || member.name || "").trim() || (String(member.role || "") === "owner" ? "مدير المكتب" : "وسيط")]));
    const recordTitles = Object.fromEntries(state.records.map((record) => { const view = recordView(record); return [view.id, `${view.kindLabel}: ${view.title}`]; }));
    views = auditViews(entries, { memberNames, recordTitles });
    if (body.isConnected) draw();
  }).catch(() => { clear(body); append(body, h("div", { class: "os-alert bad", text: "تعذر تحميل سجل النشاط." })); });
  return null;
}
