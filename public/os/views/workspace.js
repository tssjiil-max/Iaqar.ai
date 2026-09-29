/**
 * مساحة الفرصة — one workspace for the whole journey of an approved match.
 * Stage (where it is) and current action (what is needed now) are shown separately.
 */

import { h, ic, clear, append } from "../core/dom.js";
import { back, go } from "../core/nav.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { recordById, subscribe } from "../core/state.js";
import { officeSetting, watchDoc, watchJourneyEvents, watchJourneyProposals } from "../core/live.js";
import { confirmDialog, newRequestKey, openSheet, openWhatsApp, runAction, toast } from "../core/ui.js";
import {
  CLOSE_REASONS_LOST, EVENT_SOURCE, JOURNEY_STATUS, JOURNEY_STATUS_LABEL, STAGE, STAGE_LABEL, VIEWING_RESULTS,
  VIEWING_STATE, VIEWING_STATE_LABEL, allowedStageMoves, effectOfViewingResult, isJourneyOpen, stageProgress, suggestNextStep
} from "../domain/journey-domain.js";
import { PROPOSAL_STATUS, RECIPIENT, RECIPIENT_LABEL, SEND_STATE_LABEL, replyLabel, replyOptionsFor } from "../domain/proposal-domain.js";
import { recordView, recordTitle } from "../domain/records-domain.js";
import { formatDateTime, formatPrice, relativeAgo, toNumber } from "../domain/format-domain.js";
import { openComposer } from "./composer.js";

const EVENT_ICON = {
  MATCH_APPROVED: "doc-check", PROPOSAL_CREATED: "note", WHATSAPP_OPENED: "whatsapp", PARTY_REPLY: "reply",
  BROKER_NOTE: "edit3", CALL_OUTCOME: "phone", VIEWING_CONFIRMED: "calendar", VIEWING_RESULT: "eye",
  STAGE_CHANGED: "flag", PAUSED: "pause", RESUMED: "play", CLOSED_WON: "handshake", CLOSED_LOST: "x-circle",
  PROPOSAL_SUPERSEDED: "refresh", FOLLOW_UP_DONE: "check"
};
const SOURCE_LABEL = { [EVENT_SOURCE.REPLY_LINK]: "عبر رابط الرد", [EVENT_SOURCE.BROKER_NOTE]: "سجّله الوسيط", [EVENT_SOURCE.SYSTEM]: "النظام", [EVENT_SOURCE.BROKER]: "الوسيط" };

function defaultKindFor(journey) {
  if (journey.stage === STAGE.VIEWING) return "VIEWING";
  if (journey.stage === STAGE.AGREEMENT) return "AGREEMENT_STEPS";
  return "PRICE";
}

function stagePath(journey) {
  return h("div", { class: "os-card" },
    h("div", { class: "os-card-head" },
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
  const noteBtn = h("button", { type: "button", class: "os-btn ghost" }, ic("edit3"), "تسجيل رد بعد اتصال");
  noteBtn.addEventListener("click", () => openCallOutcome(journey, role));
  return h("div", { class: "os-party" },
    h("div", { class: "os-party-head" }, h("div", { class: "av" }, ic("user")),
      h("div", {}, h("b", { text: RECIPIENT_LABEL[role] }), h("span", { text: view?.contactName || "—" }))),
    h("div", { class: "os-party-reply" },
      reply ? h("span", {}, h("b", { text: "آخر رد: " }), reply.label) : h("span", { class: "os-sub", text: "لا يوجد رد بعد" }),
      reply ? h("small", { text: `${relativeAgo(reply.at)} · ${SOURCE_LABEL[reply.source] || ""}` }) : null),
    view?.contactPhone && isJourneyOpen(journey) ? h("div", { class: "os-btn-row", style: { marginTop: "6px" } },
      h("a", { class: "os-btn secondary", href: `tel:${view.contactPhone}`, "aria-label": `اتصال بـ${RECIPIENT_LABEL[role]}` }, ic("phone"), "اتصال"), noteBtn) : null
  );
}

function openCallOutcome(journey, role) {
  const text = h("textarea", { class: "os-textarea", maxlength: "500", placeholder: "ماذا قال الطرف؟" });
  const kind = journey.lastProposal?.kind || "INTEREST_FOLLOWUP";
  let chosen = "";
  const options = h("div", { class: "os-options" });
  for (const option of replyOptionsFor(kind)) {
    const b = h("button", { type: "button", class: `os-option ${option.tone || ""}`, "aria-pressed": "false" }, option.label);
    b.addEventListener("click", () => { chosen = option.label; options.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
    append(options, b);
  }
  const key = newRequestKey();
  const save = h("button", { type: "button", class: "os-btn primary block" }, ic("check"), "حفظ الرد");
  save.addEventListener("click", () => runAction(save, async () => {
    if (!chosen && text.value.trim().length < 2) throw new Error("اختر الرد أو اكتب ملاحظة");
    await api("/os/journeys/note", { officeId: session.officeId, journeyId: journey.journeyId || journey.id, party: role, optionLabel: chosen, text: text.value, requestKey: key });
    sheet.close();
  }, { success: "تم تسجيل الرد كملاحظة من الوسيط" }));
  const sheet = openSheet(`رد ${RECIPIENT_LABEL[role]} بعد اتصال`, h("div", { class: "os-form" },
    h("p", { class: "os-sub", text: "يُحفظ كملاحظة سجّلها الوسيط، ويتميّز عن ردود رابط واتساب." }), options, text, save));
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
  const NEXT = { AGREEMENT_FOLLOW_UP: "متابعة إجراءات الاتفاق", SEND_PROPOSAL: "العودة للتفاوض وتجهيز مقترح", FOLLOW_UP: "متابعة لاحقة" };
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
  const card = h("div", { class: "os-card", id: "now" });
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
  if (type === "VIEWING_RESULT") {
    append(card, title("تسجيل نتيجة المعاينة"),
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
    const follow = proposal?.whatsappUrl ? h("a", { class: "os-btn whatsapp", href: proposal.whatsappUrl, target: "_blank", rel: "noopener" }, ic("whatsapp"), "متابعة عبر واتساب") : null;
    follow?.addEventListener("click", (e) => { e.preventDefault(); openWhatsApp(proposal.whatsappUrl); api("/os/proposals/handoff", { officeId: session.officeId, proposalId: proposal.id }, { keepalive: true }).catch(() => {}); });
    append(card, title(`بانتظار رد ${proposal ? RECIPIENT_LABEL[proposal.recipientRole] : ""}`),
      h("p", { class: "os-sub", text: `${action.reason}${action.dueAt ? ` · موعد المتابعة ${formatDateTime(action.dueAt)}` : ""}` }),
      h("div", { class: "os-btn-row", style: { marginTop: "10px" } }, follow,
        proposal ? h("button", { type: "button", class: "os-btn secondary", onClick: () => openCallOutcome(journey, proposal.recipientRole) }, ic("phone"), "تسجيل رد بعد اتصال") : null));
    return card;
  }
  if (type === "DEAL_ACTION") {
    append(card, title("متابعة إجراءات الاتفاق"), h("p", { class: "os-sub", text: action.reason }),
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
    h("button", { type: "button", class: "os-btn primary block", onClick: () => composer() }, ic("send"), "تجهيز المقترح"));
  return card;
}

function proposalsCard(journey, proposals) {
  const active = Object.values(journey.activeProposals || {});
  const current = proposals.filter((p) => active.includes(p.id));
  if (!current.length) return null;
  return h("div", { class: "os-card" },
    h("h2", { class: "os-h2", style: { marginBottom: "8px" } }, ic("clipboard"), "المقترح الحالي"),
    current.map((p) => {
      const lines = [p.fields?.price ? `السعر المقترح ${formatPrice(p.fields.price)}` : "", p.fields?.viewingAt ? `المعاينة ${formatDateTime(p.fields.viewingAt)}` : "", p.fields?.question || p.fields?.actionText || p.fields?.stepText || ""].filter(Boolean);
      const status = p.status === PROPOSAL_STATUS.ANSWERED ? `وصل رد: ${replyLabel(p.kind, p.reply || {})}` : SEND_STATE_LABEL[p.sendState] || "";
      return h("div", { class: "os-meta-row", style: { marginBottom: "6px", flexWrap: "wrap" } }, ic(p.kind === "VIEWING" ? "calendar" : "coins"),
        h("span", {}, h("b", { text: `${p.label} — ${RECIPIENT_LABEL[p.recipientRole]}` }), lines.length ? ` · ${lines.join(" · ")}` : ""),
        h("span", { class: `os-badge${p.status === PROPOSAL_STATUS.ANSWERED ? " ok" : " muted"}`, style: { marginInlineStart: "auto" }, text: status }));
    }));
}

function timelineCard(events) {
  return h("div", { class: "os-card" },
    h("h2", { class: "os-h2", style: { marginBottom: "8px" } }, ic("clock"), "سجل الإجراءات"),
    events.length ? h("ol", { class: "os-timeline" }, events.map((e) => h("li", {},
      h("span", { class: `ic${e.type === "WHATSAPP_OPENED" ? " wa" : ""}` }, ic(EVENT_ICON[e.type] || "info")),
      h("span", {}, e.text, h("span", { class: "src", text: SOURCE_LABEL[e.source] || "" })),
      h("span", { class: "when", text: relativeAgo(e.at || e.createdAt) })))) : h("p", { class: "os-sub", text: "لا توجد أحداث بعد." }));
}

function openCloseWon(journey) {
  const price = h("input", { class: "os-input", inputmode: "numeric", placeholder: "السعر النهائي (اختياري)" });
  const save = h("button", { type: "button", class: "os-btn primary block" }, ic("handshake"), "تأكيد إتمام الصفقة");
  save.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "إتمام الصفقة؟", text: "هذا إجراء نهائي يُغلق الفرصة كصفقة تمت، ويؤرشفها مع حفظ سجلها.", confirmLabel: "إتمام" });
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
  const draft = { note: "", result: "", resultNote: "" };
  const draw = () => {
    const y = window.scrollY;
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
    const summary = h("div", { class: "os-card" },
      h("div", { class: "os-card-head", style: { alignItems: "flex-start" } },
        h("div", { style: { minWidth: 0 } },
          h("h2", { class: "os-task-title", style: { marginTop: 0 }, text: `${requestLabel} ↔ ${recordTitle(offer).replace(/ للبيع| للإيجار/, "")}` }),
          h("p", { class: "os-sub", text: `عرض #${offerView.reference} · طلب #${requestView.reference}${journey.compatibility?.label ? ` · ${journey.compatibility.label}` : ""}` })),
        isJourneyOpen(journey) ? h("button", { type: "button", class: "os-icon-btn", "aria-label": "إجراءات الفرصة", onClick: () => openStageMenu(journey) }, ic("more")) : null),
      h("div", { class: "os-meta-row" }, ic("coins"), h("span", {}, "السعر المطلوب: ", h("b", { text: formatPrice(offerView.price) || "—" }), " · الميزانية: ", h("b", { text: formatPrice(requestView.price) || "—" }))),
      h("details", { class: "os-more", style: { marginTop: "10px" } }, h("summary", {}, "عرض التفاصيل", ic("chev-down")),
        h("div", { class: "os-facts", style: { marginTop: "10px" } },
          fact("building", "نوع العقار", offerView.propertyType),
          fact("pin", "الموقع", offerView.location),
          fact("area", "المساحة", offerView.areaLabel || "غير محددة"),
          fact("search", "احتياج العميل", [requestView.propertyType, requestView.location, requestView.areaLabel].filter(Boolean).join(" · "))),
        h("div", { class: "os-btn-row", style: { marginTop: "8px" } },
          h("button", { type: "button", class: "os-btn ghost", onClick: () => go(`record/${journey.offerId}`) }, "سجل العرض"),
          h("button", { type: "button", class: "os-btn ghost", onClick: () => go(`record/${journey.requestId}`) }, "سجل الطلب")))
    );
    const communication = isJourneyOpen(journey) ? communicationCard(journey, offer, request, draft) : null;
    append(container, 
      summary,
      stagePath(journey),
      nowAction(journey, proposals, offer, request, draft),
      isJourneyOpen(journey) ? assistBox(journey) : null,
      h("div", { class: "os-card" }, h("h2", { class: "os-h2", style: { marginBottom: "8px" } }, ic("users"), "الأطراف"),
        h("div", { class: "os-parties" }, partyCard(RECIPIENT.CLIENT, recordById(journey.requestId), journey), partyCard(RECIPIENT.OWNER, recordById(journey.offerId), journey))),
      proposalsCard(journey, proposals),
      communication,
      timelineCard(events)
    );
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
  return h("div", { class: "os-card" },
    h("h2", { class: "os-h2", style: { marginBottom: "4px" } }, ic("send"), "التواصل"),
    h("p", { class: "os-sub", style: { marginBottom: "10px" }, text: "أرسل مقترحًا جاهزًا عبر واتساب برابط رد، أو وثّق ملاحظة." }),
    h("button", { type: "button", class: "os-btn primary block", onClick: () => openComposer(journey, { offer, request, defaultKind: defaultKindFor(journey) }) }, ic("whatsapp"), "مقترح جديد عبر واتساب"),
    h("div", { style: { marginTop: "10px" } }, note, counter),
    h("div", { class: "os-btn-row" }, saveNote));
}
