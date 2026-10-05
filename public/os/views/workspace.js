/**
 * مساحة الفرصة — one workspace for the whole journey of an approved match.
 * Stage (where it is) and current action (what is needed now) are shown separately.
 */

import { h, ic, clear, append } from "../core/dom.js";
import { propertyTypeIcon } from "../core/icons.js";
import { back, go } from "../core/nav.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { recordById, subscribe } from "../core/state.js";
import { officeSetting, watchDoc, watchJourneyEvents, watchJourneyProposals } from "../core/live.js";
import { confirmDialog, newRequestKey, openSheet, runAction, toast } from "../core/ui.js";
import {
  CLOSE_REASONS_LOST, EVENT_SOURCE, JOURNEY_STATUS, JOURNEY_STATUS_LABEL, STAGE, STAGE_LABEL, VIEWING_RESULTS,
  VIEWING_STATE, VIEWING_STATE_LABEL, allowedStageMoves, effectOfViewingResult, isJourneyOpen, stageProgress, suggestNextStep
} from "../domain/journey-domain.js";
import { PROPOSAL_STATUS, RECIPIENT, RECIPIENT_LABEL, sendStateLabel, replyLabel } from "../domain/proposal-domain.js";
import { recordView, recordTitle } from "../domain/records-domain.js";
import { formatDateTime, formatPrice, relativeAgo, toNumber } from "../domain/format-domain.js";
import { openComposer, proposalPreparedPanel } from "./composer.js";
import { DOC_STATUS, DOC_STATUS_LABEL, DOC_STATUS_ORDER, documentChecklist, documentSummary, documentSummaryText } from "../domain/deal-documents-domain.js";

const EVENT_ICON = {
  MATCH_APPROVED: "doc-check", PROPOSAL_CREATED: "note", WHATSAPP_OPENED: "whatsapp", MESSAGE_SHARED: "send", PARTY_REPLY: "reply",
  BROKER_NOTE: "edit3", CALL_OUTCOME: "phone", VIEWING_CONFIRMED: "calendar", VIEWING_RESULT: "eye",
  STAGE_CHANGED: "flag", PAUSED: "pause", RESUMED: "play", CLOSED_WON: "handshake", CLOSED_LOST: "x-circle",
  PROPOSAL_SUPERSEDED: "refresh", FOLLOW_UP_DONE: "check", DOCUMENT_UPDATED: "note",
  SESSION_MOVE: "handshake", SESSION_BROKER_MESSAGE: "send", SESSION_OPENED: "link", SESSION_LINK: "link", SESSION_RESOLVED: "check"
};
const SOURCE_LABEL = { [EVENT_SOURCE.REPLY_LINK]: "عبر رابط الرد", [EVENT_SOURCE.BROKER_NOTE]: "سجّله الوسيط", [EVENT_SOURCE.SYSTEM]: "النظام", [EVENT_SOURCE.BROKER]: "الوسيط" };

function defaultKindFor(journey) {
  if (journey.stage === STAGE.VIEWING) return "VIEWING";
  if (journey.stage === STAGE.AGREEMENT) return "AGREEMENT_STEPS";
  return "PRICE";
}

function stagePath(journey) {
  return h("details", { class: "os-card os-stage-panel", "data-panel": "stages", open: !isJourneyOpen(journey) },
    h("summary", { class: "os-card-head" },
      h("h2", { class: "os-h2" }, ic("flag"), "مسار الفرصة"),
      h("span", { class: "os-ref" }, "المرحلة الحالية: ", h("b", { text: isJourneyOpen(journey) ? STAGE_LABEL[journey.stage] || "" : JOURNEY_STATUS_LABEL[journey.status] }))),
    h("div", { class: "os-path", role: "list" }, stageProgress(journey).map((s) => h("div", { class: `os-step ${s.state}`, role: "listitem", "aria-current": s.state === "current" ? "step" : null },
      h("div", { class: "dot" }, ic(s.state === "done" ? "check" : s.state === "skipped" ? "chev-left" : s.icon)),
      h("span", { text: s.state === "skipped" ? `${s.label} (تخطّي)` : s.label }))))
  );
}

function partyCard(role, record, journey) {
  const view = record ? recordView(record) : null;
  const reply = journey.lastReplies?.[role];
  const sendBtn = h("button", { type: "button", class: "os-btn soft os-party-send", "aria-label": `إرسال مقترح إلى ${RECIPIENT_LABEL[role]}` }, ic("send"), "إرسال مقترح");
  sendBtn.addEventListener("click", () => openComposer(journey, {
    offer: recordById(journey.offerId) || journey.offerSummary,
    request: recordById(journey.requestId) || journey.requestSummary,
    defaultKind: defaultKindFor(journey), defaultRecipients: [role]
  }));
  return h("div", { class: "os-party" },
    h("div", { class: "os-party-head" }, h("div", { class: "av" }, ic("user")),
      h("div", {}, h("b", { text: RECIPIENT_LABEL[role] }), h("span", { text: view?.contactName || "—" }))),
    h("div", { class: "os-party-reply" },
      reply ? h("span", {}, h("b", { text: "آخر رد: " }), reply.label) : h("span", { class: "os-sub", text: "لا يوجد رد بعد" }),
      reply ? h("small", { text: `${relativeAgo(reply.at)} · ${SOURCE_LABEL[reply.source] || ""}` }) : null),
    isJourneyOpen(journey) ? sendBtn : null
  );
}

function viewingResultAction(journey, draft) {
  let result = draft.result || "";
  const note = h("textarea", { class: "os-textarea", maxlength: "500", placeholder: "ملاحظة مختصرة عن المعاينة…" });
  note.value = draft.resultNote || "";
  const counter = h("div", { class: "os-counter", text: `${note.value.length}/500` });
  note.addEventListener("input", () => { draft.resultNote = note.value; counter.textContent = `${note.value.length}/500`; });
  const nextRow = h("div", { class: "os-meta-row", hidden: true });
  const options = h("div", { class: "os-options" });
  const save = h("button", { type: "button", class: "os-btn primary block", disabled: true }, ic("send"), "حفظ النتيجة ومتابعة الصفقة");
  const NEXT = {
    AGREEMENT_FOLLOW_UP: "المستندات ثم إتمام الصفقة", REOPEN_PRICE: "العودة للتفاوض على السعر", CLOSE_MATCH: "إغلاق هذه المطابقة (العرض والطلب يبقيان)",
    RESCHEDULE_VIEWING: "تحديد موعد معاينة جديد", FOLLOW_UP_RESULT: "متابعة الطرف ثم تسجيل النتيجة بعد يومين",
    SEND_PROPOSAL: "العودة للتفاوض وتجهيز مقترح", FOLLOW_UP: "متابعة لاحقة"
  };
  for (const option of VIEWING_RESULTS) {
    const b = h("button", { type: "button", class: `os-option${option.id === "not_suitable" ? " negative" : option.id === "interested" ? " positive" : ""}`, "aria-pressed": "false", "data-result": option.id }, ic(option.icon), option.label);
    const select = () => {
      result = option.id;
      draft.result = option.id;
      options.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      save.disabled = false;
      const effect = effectOfViewingResult(option.id);
      nextRow.hidden = false;
      clear(nextRow).append(ic("chev-left"), h("span", { text: `الخطوة التالية: ${effect.suggestClose ? "إغلاق الفرصة أو البحث عن بديل" : NEXT[effect.next] || ""}` }));
    };
    b.addEventListener("click", select);
    append(options, b);
    if (draft.result === option.id) queueMicrotask(select);
  }
  save.addEventListener("click", async () => {
    const res = await runAction(save, () => api("/os/journeys/viewing/result", { officeId: session.officeId, journeyId: journey.journeyId || journey.id, result, note: note.value }), { success: "تم حفظ نتيجة المعاينة" });
    if (res?.ok) { draft.result = ""; draft.resultNote = ""; }
  });
  return [options, note, counter, save, nextRow];
}

function nowAction(journey, proposals, offer, request, draft) {
  const card = h("div", { class: "os-card os-now-card", id: "now" });
  const action = journey.currentAction;
  const jid = journey.journeyId || journey.id;
  const composer = (kind, recips) => openComposer(journey, { offer, request, defaultKind: kind || defaultKindFor(journey), defaultRecipients: recips });
  const title = (text) => h("h2", { class: "os-h2", style: { marginBottom: "8px" } }, ic("clipboard"), `المطلوب الآن: ${text}`);

  if (!isJourneyOpen(journey)) {
    const won = journey.status === JOURNEY_STATUS.CLOSED_WON;
    append(card, h("h2", { class: "os-h2" }, ic(won ? "handshake" : "archive"), JOURNEY_STATUS_LABEL[journey.status]),
      h("p", { class: "os-sub", text: [journey.outcome?.reason, journey.outcome?.finalPrice ? `السعر النهائي ${formatPrice(journey.outcome.finalPrice)}` : "", `أُغلقت ${formatDateTime(journey.closedAt)}`].filter(Boolean).join(" · ") }),
      h("p", { class: "os-sub", text: "الفرصة مؤرشفة ويبقى سجلها متاحًا للرجوع." }));
    return card;
  }
  if (journey.status === JOURNEY_STATUS.PAUSED) {
    const resume = h("button", { type: "button", class: "os-btn primary block" }, ic("play"), "استئناف الفرصة");
    resume.addEventListener("click", () => runAction(resume, () => api("/os/journeys/resume", { officeId: session.officeId, journeyId: jid }), { success: "تم استئناف الفرصة" }));
    append(card, title("استئناف الفرصة المتوقفة"), h("p", { class: "os-sub", text: journey.pauseReason || "الفرصة متوقفة مؤقتًا." }), resume);
    return card;
  }
  const type = action?.type || "";
  if (type.startsWith("SESSION_")) {
    append(card, title(action.label && !["فتح غرفة التفاوض", "فتح جلسة التفاوض"].includes(action.label) ? action.label : type === "SESSION_INTERVENTION" ? "تدخل مطلوب" : "متابعة غرفة التفاوض"),
      h("p", { class: "os-sub", style: { marginBottom: "10px" }, text: action.reason }),
      h("button", { type: "button", class: "os-btn primary block", onClick: () => go(`session/${jid}`) }, ic("handshake"), "فتح غرفة التفاوض"));
    return card;
  }
  if (type === "VIEWING_RESULT") {
    append(card, title("نتيجة المعاينة"),
      h("div", { class: "os-meta-row", style: { marginBottom: "8px" } }, ic("calendar"), h("span", { text: `${VIEWING_STATE_LABEL[journey.viewing?.state] || ""} · ${formatDateTime(journey.viewing?.at)}` })),
      ...viewingResultAction(journey, draft));
    return card;
  }
  if (type === "VIEWING_CONFIRM") {
    const accepted = Object.keys(journey.viewing?.acceptedBy || {}).map((r) => RECIPIENT_LABEL[r]).join(" و");
    const confirm = h("button", { type: "button", class: "os-btn primary block" }, ic("check"), "تأكيد الموعد");
    confirm.addEventListener("click", () => runAction(confirm, () => api("/os/journeys/viewing/confirm", { officeId: session.officeId, journeyId: jid }), { success: "تم تأكيد موعد المعاينة" }));
    append(card, title("تأكيد موعد المعاينة"),
      h("p", { class: "os-sub", text: `قبل ${accepted || "الطرف"} موعد ${formatDateTime(journey.viewing?.at)}. القبول لا يعني تنفيذ المعاينة — أكّد الموعد بعد التأكد من جاهزية الطرفين.` }),
      h("div", { class: "os-btn-row", style: { marginTop: "10px" } }, confirm,
        h("button", { type: "button", class: "os-btn secondary", onClick: () => composer("VIEWING") }, ic("calendar"), "تعديل الموعد")));
    return card;
  }
  if (type === "PROPOSAL_REPLY") {
    const spec = journey.openTasks?.[action.taskId] || {};
    const proposal = proposals.find((p) => p.id === spec.proposalId);
    const ack = h("button", { type: "button", class: "os-btn secondary" }, ic("check"), "تمت المراجعة");
    ack.addEventListener("click", () => runAction(ack, () => api("/os/journeys/ack-reply", { officeId: session.officeId, journeyId: jid, proposalId: spec.proposalId }), { success: "تمت مراجعة الرد" }));
    append(card, title("مراجعة الرد"),
      proposal ? h("div", { class: "os-alert info" },
        h("b", { text: `${RECIPIENT_LABEL[proposal.recipientRole]} على ${proposal.label}: ` }), replyLabel(proposal.kind, proposal.reply || {}),
        h("small", { style: { display: "block" }, text: `${relativeAgo(proposal.reply?.at)} · عبر رابط الرد — رد مبدئي` })) : h("p", { class: "os-sub", text: action.reason }),
      h("div", { class: "os-btn-row", style: { marginTop: "10px" } },
        h("button", { type: "button", class: "os-btn primary", onClick: () => composer(proposal?.kind === "VIEWING" ? "VIEWING" : undefined, proposal ? [proposal.recipientRole === RECIPIENT.CLIENT ? RECIPIENT.OWNER : RECIPIENT.CLIENT] : null) }, ic("send"), "إرسال مقترح جديد"), ack));
    return card;
  }
  if (type === "AWAITING_REPLY") {
    const spec = journey.openTasks?.[action.taskId] || {};
    const proposal = proposals.find((p) => p.id === spec.proposalId);
    append(card, title(`بانتظار رد ${proposal ? RECIPIENT_LABEL[proposal.recipientRole] : ""}`),
      h("p", { class: "os-sub", text: `${action.reason}${action.dueAt ? ` · موعد المتابعة ${formatDateTime(action.dueAt)}` : ""}` }),
      proposal ? h("button", { type: "button", class: "os-btn primary block", onClick: () => openSheet("إرسال تذكير", proposalPreparedPanel({ ...proposal, proposalId: proposal.id })) }, ic("send"), "إرسال تذكير") : null);
    return card;
  }
  if (type === "DEAL_ACTION") {
    const docs = documentSummary(documentChecklist(journey));
    append(card, title("متابعة إجراءات الاتفاق"), h("p", { class: "os-sub", text: action.reason }),
      h("button", { type: "button", class: "os-meta-row os-docs-link", "data-docs-link": "", onClick: () => { const panel = document.getElementById("documents"); if (panel) { panel.open = true; panel.scrollIntoView({ block: "start", behavior: "smooth" }); } } },
        ic("contract"), h("span", { text: docs.complete ? "المستندات المطلوبة مكتملة" : `المستندات: ${documentSummaryText(docs)}` })),
      h("div", { class: "os-btn-row", style: { marginTop: "10px" } },
        h("button", { type: "button", class: "os-btn primary", onClick: () => composer("AGREEMENT_STEPS") }, ic("send"), "متابعة خطوات الاتفاق"),
        h("button", { type: "button", class: "os-btn secondary", onClick: () => openCloseWon(journey) }, ic("handshake"), "إتمام الصفقة")));
    return card;
  }
  if (type === "JOURNEY_FOLLOW_UP") {
    const done = h("button", { type: "button", class: "os-btn secondary" }, ic("check"), "تمت المتابعة");
    done.addEventListener("click", () => runAction(done, () => api("/os/tasks/done", { officeId: session.officeId, journeyId: jid, taskId: action.taskId }), { success: "تم" }));
    append(card, title(action.label || "متابعة الفرصة"), h("p", { class: "os-sub", text: action.reason }),
      h("div", { class: "os-btn-row", style: { marginTop: "10px" } },
        h("button", { type: "button", class: "os-btn primary", onClick: () => composer("INTEREST_FOLLOWUP") }, ic("send"), "تجهيز مقترح متابعة"), done));
    return card;
  }
  // SEND_PROPOSAL or nothing pending
  append(card, title(type === "SEND_PROPOSAL" ? "إرسال مقترح" : "لا يوجد إجراء عاجل"),
    h("p", { class: "os-sub", style: { marginBottom: "10px" }, text: action?.reason || "تابع الطرفين وأرسل المقترح التالي عند الحاجة." }),
    h("div", { class: "os-proposal-shortcuts" },
      h("button", { type: "button", class: "os-btn primary", onClick: () => composer("PRICE") }, ic("coins"), "اقتراح سعر"),
      h("button", { type: "button", class: "os-btn secondary", onClick: () => composer("VIEWING") }, ic("calendar"), "تحديد معاينة"),
      h("button", { type: "button", class: "os-btn secondary", onClick: () => composer("INFO_REQUEST") }, ic("question"), "طلب معلومات")));
  return card;
}

/**
 * «مستندات الصفقة»: المطلوب · الموجود · الناقص · حالة المراجعة. Open by default in the agreement
 * stage; read-only once the deal is closed. Every change is saved by the Worker and logged.
 */
function documentsCard(journey) {
  const jid = journey.journeyId || journey.id;
  const open = isJourneyOpen(journey);
  const rows = documentChecklist(journey);
  const summary = documentSummary(rows);
  const update = (button, body, success) => runAction(button, () => api("/os/journeys/documents", { officeId: session.officeId, journeyId: jid, ...body }), { success });
  const list = h("ul", { class: "os-docs", "data-docs": "" }, rows.map((row) => {
    const select = h("select", { class: "os-select os-doc-status", "aria-label": `حالة ${row.label}`, "data-doc-status": row.id, disabled: open ? null : true },
      DOC_STATUS_ORDER.map((status) => h("option", { value: status, text: DOC_STATUS_LABEL[status] })));
    select.value = row.status;
    select.addEventListener("change", async () => {
      const saved = await update(select, { documentId: row.id, status: select.value }, `${row.label}: ${DOC_STATUS_LABEL[select.value]}`);
      // A change that was not saved is not left on screen.
      if (saved === undefined) select.value = row.status;
    });
    const remove = row.custom && open ? h("button", { type: "button", class: "os-icon-btn", "aria-label": `حذف ${row.label}`, "data-doc-remove": row.id }, ic("trash")) : null;
    remove?.addEventListener("click", () => update(remove, { documentId: row.id, remove: true }, "تم حذف المستند من القائمة"));
    return h("li", { class: `os-doc is-${row.status.toLowerCase()}`, "data-doc": row.id, "data-doc-state": row.status },
      h("span", { class: "os-doc-mark" }, ic(row.status === DOC_STATUS.REVIEWED ? "doc-check" : row.status === DOC_STATUS.RECEIVED ? "check" : row.status === DOC_STATUS.NOT_REQUIRED ? "x" : "hourglass")),
      h("span", { class: "os-doc-copy" }, h("b", { text: row.label }),
        h("small", { text: [row.partyLabel, row.optional && row.status !== DOC_STATUS.NOT_REQUIRED ? "اختياري" : "", row.note].filter(Boolean).join(" · ") })),
      select, remove);
  }));
  let adder = null;
  if (open) {
    const input = h("input", { class: "os-input", name: "documentLabel", maxlength: "80", placeholder: "اسم مستند إضافي", "aria-label": "اسم مستند إضافي" });
    const add = h("button", { type: "button", class: "os-btn secondary", "data-doc-add": "" }, ic("plus"), "إضافة");
    add.addEventListener("click", async () => {
      const res = await update(add, { label: input.value }, "تمت إضافة المستند");
      if (res?.ok) input.value = "";
    });
    adder = h("div", { class: "os-doc-add" }, input, add);
  }
  return h("details", { class: "os-card os-documents", "data-panel": "documents", id: "documents", open: journey.stage === STAGE.AGREEMENT || !open },
    h("summary", { class: "os-h2" }, ic("contract"), "مستندات الصفقة",
      h("span", { class: `os-badge${summary.complete ? " ok" : " muted"}`, "data-docs-badge": "", text: summary.complete ? "مكتملة" : `الناقص ${summary.missing}` }), ic("chev-down")),
    h("p", { class: "os-sub os-docs-summary", "data-docs-summary": "", text: documentSummaryText(summary) }),
    list, adder,
    open ? null : h("p", { class: "os-sub", text: "الصفقة مغلقة — المستندات للعرض فقط." }));
}

function proposalsCard(journey, proposals) {
  const active = Object.values(journey.activeProposals || {});
  const current = proposals.filter((p) => active.includes(p.id)).sort((a, b) => Number(a.recipientRole !== RECIPIENT.OWNER) - Number(b.recipientRole !== RECIPIENT.OWNER));
  if (!current.length) return null;
  return h("div", { class: "os-card" },
    h("h2", { class: "os-h2", style: { marginBottom: "8px" } }, ic("clipboard"), "المقترح الحالي"),
    h("div", { class: "os-current-proposals" }, current.map((p) => {
      const lines = [p.fields?.price ? `السعر المقترح ${formatPrice(p.fields.price)}` : "", p.fields?.viewingAt ? `المعاينة ${formatDateTime(p.fields.viewingAt)}` : "", p.fields?.question || p.fields?.actionText || p.fields?.stepText || ""].filter(Boolean);
      const status = p.status === PROPOSAL_STATUS.ANSWERED ? `وصل رد: ${replyLabel(p.kind, p.reply || {})}` : sendStateLabel(p);
      return h("div", { class: "os-proposal-preview" },
        h("b", {}, ic(p.kind === "VIEWING" ? "calendar" : "coins"), `${p.label} · ${RECIPIENT_LABEL[p.recipientRole]}`),
        h("span", { text: lines.join(" · ") }),
        h("small", { class: `os-badge${p.status === PROPOSAL_STATUS.ANSWERED ? " ok" : " muted"}`, text: status }));
    })));
}

function timelineCard(events) {
  return h("details", { class: "os-card os-history", "data-panel": "history" },
    h("summary", { class: "os-h2" }, ic("clock"), "سجل الإجراءات", h("span", { class: "os-count", text: String(events.length) }), ic("chev-down")),
    events.length ? h("ol", { class: "os-timeline" }, events.map((e) => h("li", {},
      h("span", { class: `ic${e.type === "WHATSAPP_OPENED" ? " wa" : ""}` }, ic(EVENT_ICON[e.type] || "info")),
      h("span", {}, e.text, h("span", { class: "src", text: SOURCE_LABEL[e.source] || "" })),
      h("span", { class: "when", text: relativeAgo(e.at || e.createdAt) })))) : h("p", { class: "os-sub", text: "لا توجد أحداث بعد." }));
}

function openCloseWon(journey) {
  const price = h("input", { class: "os-input", inputmode: "numeric", placeholder: "السعر النهائي (اختياري)" });
  const save = h("button", { type: "button", class: "os-btn primary block" }, ic("handshake"), "تأكيد إتمام الصفقة");
  save.addEventListener("click", async () => {
    const docs = documentSummary(documentChecklist(journey));
    const missing = docs.missing ? ` مستندات ناقصة (${docs.missing}): ${docs.missingLabels.join("، ")}.` : "";
    const ok = await confirmDialog({ title: docs.missing ? "إتمام الصفقة مع مستندات ناقصة؟" : "إتمام الصفقة؟", text: `هذا إجراء نهائي يُغلق الفرصة كصفقة تمت، ويؤرشفها مع حفظ سجلها.${missing}`, confirmLabel: "إتمام" });
    if (!ok) return;
    const res = await runAction(save, () => api("/os/journeys/close", { officeId: session.officeId, journeyId: journey.journeyId || journey.id, outcome: "WON", finalPrice: toNumber(price.value) }), { success: "تم إتمام الصفقة" });
    if (res?.ok) sheet.close();
  });
  const sheet = openSheet("إتمام الصفقة", h("div", { class: "os-form" },
    h("p", { class: "os-sub", text: "الاهتمام أو الموافقة المبدئية لا يكفيان — استخدم هذا بعد اكتمال الاتفاق فعليًا." }), price, save));
}

function openCloseLost(journey) {
  let reason = "";
  const options = h("div", { class: "os-options" });
  for (const r of CLOSE_REASONS_LOST) {
    const b = h("button", { type: "button", class: "os-option", "aria-pressed": "false" }, r);
    b.addEventListener("click", () => { reason = r; options.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
    append(options, b);
  }
  const save = h("button", { type: "button", class: "os-btn danger block" }, ic("x-circle"), "إغلاق الفرصة");
  save.addEventListener("click", async () => {
    const res = await runAction(save, () => api("/os/journeys/close", { officeId: session.officeId, journeyId: journey.journeyId || journey.id, outcome: "LOST", reason }), { success: "أُغلقت الفرصة" });
    if (res?.ok) sheet.close();
  });
  const sheet = openSheet("إغلاق دون صفقة", h("div", { class: "os-form" }, h("p", { class: "os-sub", text: "تُؤرشف الفرصة ويبقى سجلها. السجلان يبقيان في المستودع." }), options, save));
}

function openStageMenu(journey) {
  const jid = journey.journeyId || journey.id;
  const move = (stage, label) => h("button", { type: "button", onClick: async (e) => {
    const res = await runAction(e.currentTarget, () => api("/os/journeys/stage", { officeId: session.officeId, journeyId: jid, stage }), { success: `انتقلت الفرصة إلى ${label}` });
    if (res?.ok) sheet.close();
  } }, ic("flag"), label);
  const moves = allowedStageMoves(journey);
  const items = [
    moves.includes(STAGE.NEGOTIATION) ? move(STAGE.NEGOTIATION, "العودة للتفاوض") : null,
    moves.includes(STAGE.VIEWING) ? move(STAGE.VIEWING, "الانتقال للمعاينة") : null,
    moves.includes(STAGE.AGREEMENT) ? move(STAGE.AGREEMENT, journey.viewing?.state === VIEWING_STATE.DONE ? "متابعة الاتفاق" : "متابعة الاتفاق بدون معاينة") : null,
    journey.status === JOURNEY_STATUS.ACTIVE ? h("button", { type: "button", onClick: async (e) => {
      const res = await runAction(e.currentTarget, () => api("/os/journeys/pause", { officeId: session.officeId, journeyId: jid, resumeInDays: 7, reason: "إيقاف مؤقت من الوسيط" }), { success: "أُوقفت الفرصة مؤقتًا وستعود للتذكير بعد أسبوع" });
      if (res?.ok) sheet.close();
    } }, ic("pause"), "إيقاف مؤقت (تذكير بعد أسبوع)") : null,
    h("button", { type: "button", onClick: () => { sheet.close(); openCloseWon(journey); } }, ic("handshake"), "إتمام الصفقة"),
    h("button", { type: "button", onClick: () => { sheet.close(); openCloseLost(journey); } }, ic("x-circle"), "إغلاق دون صفقة")
  ];
  const sheet = openSheet("إجراءات الفرصة", h("nav", { class: "os-menu" }, items));
}

function assistBox(journey) {
  const box = h("div", { class: "os-ai", role: "note" });
  const text = h("span", { text: suggestNextStep(journey) });
  const askBtn = h("button", { type: "button", class: "os-btn ghost", style: { minHeight: "36px" } }, ic("sparkles"), "اقتراح المساعد");
  askBtn.addEventListener("click", () => runAction(askBtn, async () => {
    const res = await api("/os/assist/suggest", { officeId: session.officeId, journeyId: journey.journeyId || journey.id });
    text.textContent = res.suggestion;
    label.textContent = res.source === "ai" ? "اقتراح المساعد الذكي — القرار لك: " : "اقتراح: ";
    askBtn.hidden = true;
  }));
  const label = h("b", { text: "اقتراح: " });
  append(box, label, text, h("div", {}, askBtn));
  return box;
}

export function renderWorkspace(container, { journeyId, focus = "" }) {
  let journey;
  let events = [];
  let proposals = [];
  let dealSettings = {};
  officeSetting(session.officeId, "deals").then((s) => { dealSettings = s || {}; }).catch(() => {});
  let focused = false;
  const disclosureState = new Map();
  const draft = { note: "", result: "", resultNote: "" };
  const draw = () => {
    const y = window.scrollY;
    container.querySelectorAll("details[data-panel]").forEach((panel) => disclosureState.set(panel.dataset.panel, panel.open));
    clear(container);
    const refChip = journey ? h("span", { class: "os-ref", text: `فرصة #${String(journeyId).slice(3, 9).toUpperCase()}` }) : h("span");
    append(container, h("div", { class: "os-page-head" },
      h("button", { type: "button", class: "os-back", onClick: () => back("tasks") }, ic("chev-right"), "المهام اليومية"),
      h("h1", { class: "os-page-title", text: "متابعة الفرصة" }), refChip));
    if (journey === undefined) { append(container, h("div", { class: "os-skeleton" }), h("div", { class: "os-skeleton" })); return; }
    if (!journey) { append(container, h("div", { class: "os-alert bad", text: "الفرصة غير موجودة." })); return; }
    const offer = recordById(journey.offerId) || { ...journey.offerSummary, opportunityKind: "OFFER" };
    const request = recordById(journey.requestId) || { ...journey.requestSummary, opportunityKind: "REQUEST" };
    const offerView = recordView({ ...offer, id: journey.offerId });
    const requestView = recordView({ ...request, id: journey.requestId });
    const requestLabel = String(request.purpose || "").toUpperCase() === "LEASE_REQUEST" ? "طلب استئجار" : "طلب شراء";
    const rawImage = [offer.coverUrl, offer.coverImageUrl, ...[].concat(offer.images || [], offer.photos || [], offer.imageUrls || [], offer.mediaUrls || [])]
      .find((value) => typeof value === "string" && /^https:\/\//i.test(value));
    const image = rawImage ? h("img", { src: rawImage, alt: offerView.title, loading: "lazy" }) : null;
    const cover = h("div", { class: "os-property-cover" }, ic(propertyTypeIcon(offerView.propertyType || offer.propertyType)), image,
      h("span", { text: image ? offerView.propertyType : "لا توجد صورة" }));
    image?.addEventListener("error", () => { image.remove(); cover.lastChild.textContent = "الصورة غير متاحة"; });
    const summary = h("div", { class: "os-card os-property-summary" },
      h("div", { class: "os-card-head" },
        h("h2", { class: "os-h2" }, ic("home"), "معلومات العقار"),
        isJourneyOpen(journey) ? h("button", { type: "button", class: "os-icon-btn", "aria-label": "إجراءات الفرصة", onClick: () => openStageMenu(journey) }, ic("more")) : null),
      h("div", { class: "os-property-layout" }, cover,
        h("div", { class: "os-property-info" },
          h("h3", { class: "os-task-title", text: recordTitle(offer).replace(/ للبيع| للإيجار/, "") }),
          h("p", { class: "os-sub", text: offerView.location }),
          h("div", { class: "os-facts" },
            fact("coins", "السعر", formatPrice(offerView.price)),
            fact("area", "المساحة", offerView.areaLabel || "غير محددة")),
          h("p", { class: "os-property-refs", text: `عرض #${offerView.reference} · طلب #${requestView.reference}` }))),
      h("details", { class: "os-more os-property-details", "data-panel": "property" }, h("summary", {}, "تفاصيل العرض والطلب", ic("chev-down")),
        h("div", { class: "os-facts", style: { marginTop: "8px" } },
          fact("search", "احتياج العميل", [requestLabel, requestView.propertyType, requestView.location, requestView.areaLabel].filter(Boolean).join(" · ")),
          fact("coins", "ميزانية العميل", formatPrice(requestView.price))),
        h("div", { class: "os-btn-row" },
          h("button", { type: "button", class: "os-btn ghost", onClick: () => go(`record/${journey.offerId}`) }, "سجل العرض"),
          h("button", { type: "button", class: "os-btn ghost", onClick: () => go(`record/${journey.requestId}`) }, "سجل الطلب")))
    );
    const communication = isJourneyOpen(journey) ? communicationCard(journey, offer, request, draft) : null;
    const sessionEntry = h("button", { type: "button", class: "os-btn secondary block os-session-entry", onClick: () => go(`session/${journeyId}`) },
      ic("handshake"), "غرفة التفاوض", journey.session?.intervention?.required ? h("span", { class: "os-badge late", text: "تدخل مطلوب" }) : null);
    append(container, 
      summary,
      sessionEntry,
      proposalsCard(journey, proposals),
      h("div", { class: "os-card os-parties-card" },
        h("div", { class: "os-parties" }, partyCard(RECIPIENT.OWNER, recordById(journey.offerId), journey), partyCard(RECIPIENT.CLIENT, recordById(journey.requestId), journey))),
      nowAction(journey, proposals, offer, request, draft),
      documentsCard(journey),
      stagePath(journey),
      communication,
      timelineCard(events),
      isJourneyOpen(journey) ? h("details", { class: "os-card os-assistant-panel", "data-panel": "assistant" },
        h("summary", { class: "os-h2" }, ic("sparkles"), "اقتراح المساعد", ic("chev-down")), assistBox(journey)) : null
    );
    container.querySelectorAll("details[data-panel]").forEach((panel) => {
      if (disclosureState.has(panel.dataset.panel)) panel.open = disclosureState.get(panel.dataset.panel);
    });
    if (!focused && focus) { focused = true; document.getElementById("now")?.scrollIntoView({ block: "start" }); }
    else window.scrollTo({ top: y });
  };
  const offs = [
    watchDoc(session.officeId, "journeys", journeyId, (doc) => { journey = doc; draw(); }, () => { journey = null; draw(); }),
    watchJourneyEvents(session.officeId, journeyId, (rows) => { events = rows; if (journey) draw(); }),
    watchJourneyProposals(session.officeId, journeyId, (rows) => { proposals = rows; if (journey) draw(); }),
    subscribe((k) => { if (k === "records" && journey) draw(); })
  ];
  draw();
  return () => offs.forEach((off) => off());
}

function fact(iconName, label, value) {
  return h("div", { class: "os-fact" }, h("div", { class: "ic" }, ic(iconName)), h("div", {}, h("b", { text: label }), h("span", { text: value || "—" })));
}

function communicationCard(journey, offer, request, draft) {
  const note = h("textarea", { class: "os-textarea", maxlength: "500", placeholder: "اكتب ملاحظة داخلية عن الفرصة…", "aria-label": "ملاحظة الوسيط" });
  note.value = draft.note || "";
  const counter = h("div", { class: "os-counter", text: `${note.value.length}/500` });
  note.addEventListener("input", () => { draft.note = note.value; counter.textContent = `${note.value.length}/500`; });
  const key = newRequestKey();
  const saveNote = h("button", { type: "button", class: "os-btn secondary" }, ic("note"), "حفظ ملاحظة");
  saveNote.addEventListener("click", () => runAction(saveNote, async () => {
    if (note.value.trim().length < 2) throw new Error("اكتب الملاحظة أولًا");
    await api("/os/journeys/note", { officeId: session.officeId, journeyId: journey.journeyId || journey.id, text: note.value, requestKey: `${key}-${note.value.length}` });
    note.value = "";
    draft.note = "";
    counter.textContent = "0/500";
  }, { success: "تم حفظ الملاحظة" }));
  return h("details", { class: "os-card os-communication", "data-panel": "communication" },
    h("summary", { class: "os-h2" }, ic("send"), "التواصل والملاحظات", ic("chev-down")),
    h("p", { class: "os-sub", style: { marginBottom: "10px" }, text: "أرسل المقترح عبر واتساب أو تطبيق آخر. رد الطرف يعود تلقائيًا إلى هذه المهمة." }),
    h("button", { type: "button", class: "os-btn primary block", onClick: () => openComposer(journey, { offer, request, defaultKind: defaultKindFor(journey) }) }, ic("whatsapp"), "إرسال مقترح"),
    h("div", { style: { marginTop: "10px" } }, note, counter),
    h("div", { class: "os-btn-row" }, saveNote));
}
