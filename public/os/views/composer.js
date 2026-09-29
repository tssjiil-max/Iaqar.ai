/**
 * Proposal composer — the WhatsApp communication flow:
 *   1 template → 2 adjust fields → 3 system prepares text + per-recipient reply link →
 *   4 «إرسال عبر واتساب» → WhatsApp opens with the text and the recipient's number.
 * Opening WhatsApp is recorded as exactly that — never as sent/delivered/read.
 */

import { h, ic, clear, field, append } from "../core/dom.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { newRequestKey, openSheet, openWhatsApp, runAction, toast } from "../core/ui.js";
import {
  RECIPIENT, RECIPIENT_LABEL, SEND_STATE_LABEL, TEMPLATE_ORDER, buildProposalMessage, replyOptionsFor, templateOf, validateProposalFields
} from "../domain/proposal-domain.js";
import { formatNumber, parseRiyadhLocal, toRiyadhLocalInput } from "../domain/format-domain.js";

/** Card for one prepared proposal: open WhatsApp synchronously inside the click. */
export function proposalPreparedPanel(proposal, { onOpened } = {}) {
  const who = RECIPIENT_LABEL[proposal.recipientRole] || "";
  const status = h("span", { class: "os-badge muted", text: SEND_STATE_LABEL[proposal.sendState] || SEND_STATE_LABEL.READY });
  const textArea = h("textarea", { class: "os-textarea", readonly: true, rows: "5", text: proposal.messageText, "aria-label": `رسالة ${who}` });
  const copyBtn = h("button", { type: "button", class: "os-btn secondary" }, ic("clipboard"), "نسخ الرسالة");
  copyBtn.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(proposal.messageText); toast("تم نسخ الرسالة", "ok"); } catch (_) { textArea.select(); }
  });
  let sendEl;
  if (proposal.phoneMissing || !proposal.whatsappUrl) {
    sendEl = h("div", { class: "os-alert warn", text: `لا يوجد رقم جوال صالح لـ${who}. انسخ الرسالة وأرسلها بطريقتك، أو صحّح الرقم في السجل.` });
  } else {
    sendEl = h("a", { class: "os-btn whatsapp block", href: proposal.whatsappUrl, target: "_blank", rel: "noopener" }, ic("whatsapp"), `إرسال عبر واتساب إلى ${who}`);
    sendEl.addEventListener("click", (event) => {
      event.preventDefault();
      openWhatsApp(proposal.whatsappUrl);
      status.textContent = SEND_STATE_LABEL.OPENED_EXTERNAL;
      status.className = "os-badge";
      api("/os/proposals/handoff", { officeId: session.officeId, proposalId: proposal.proposalId }, { keepalive: true })
        .then(() => onOpened?.(proposal))
        .catch((error) => toast(error.message, "bad"));
    });
  }
  return h("div", { class: "os-party", style: { marginTop: "8px" }, "data-proposal": proposal.proposalId },
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "6px" } },
      h("b", { style: { color: "var(--navy)" }, text: `إلى ${who}${proposal.recipientName ? ` — ${proposal.recipientName}` : ""}` }), status),
    textArea,
    h("div", { class: "os-btn-row", style: { marginTop: "8px" } }, sendEl, copyBtn),
    h("p", { class: "os-sub", style: { fontSize: ".82rem", marginTop: "6px" }, text: "يحفظ النظام فتح واتساب فقط. تأكد من إرسال الرسالة من واتساب." })
  );
}

function defaultViewingInput() {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const local = toRiyadhLocalInput(d).slice(0, 10);
  return `${local}T17:00`;
}

/**
 * @param journey  the journey document
 * @param context  { offer, request, defaultKind, defaultRecipients }
 */
export function openComposer(journey, { offer = {}, request = {}, defaultKind = "PRICE", defaultRecipients = null } = {}) {
  let kind = templateOf(defaultKind) ? defaultKind : "PRICE";
  let recipients = defaultRecipients || [RECIPIENT.CLIENT, RECIPIENT.OWNER];
  const requestKey = newRequestKey();
  const office = session.office || {};
  const values = {
    price: journey.lastProposal?.fields?.price || journey.offerSummary?.price || "",
    viewingAt: defaultViewingInput(),
    question: "", actionText: "", stepText: "", note: ""
  };
  const edited = {};
  const body = h("div", { class: "os-form" });
  const templateRow = h("div", { class: "os-chips", role: "group", "aria-label": "نوع المقترح" });
  const fieldsBox = h("div", { class: "os-form" });
  const recipientSeg = h("div", { class: "os-seg", role: "group", "aria-label": "المستلم" });
  const previews = h("div", { class: "os-form" });
  const replyPreview = h("div", { class: "os-chips" });
  const prepareBtn = h("button", { type: "button", class: "os-btn primary block" }, ic("send"), "تجهيز المقترح والرابط");
  const result = h("div");

  const fieldValues = () => {
    const raw = { ...values };
    if (kind === "VIEWING") raw.viewingAt = parseRiyadhLocal(values.viewingAt)?.toISOString() || "";
    return raw;
  };
  const messageFor = (role) => {
    const recordName = role === RECIPIENT.CLIENT ? request.contactName : offer.contactName;
    const check = validateProposalFields(kind, fieldValues());
    return buildProposalMessage({
      kind, fields: check.fields, recipientRole: role, recipientName: recordName || "",
      officeName: office.officeName || "", brokerName: office.brokerName || "",
      property: { propertyType: offer.propertyType || journey.offerSummary?.propertyType, district: offer.district || journey.offerSummary?.district, city: offer.city || journey.offerSummary?.city }
    });
  };

  const drawPreviews = () => {
    clear(previews);
    for (const role of recipients) {
      const area = h("textarea", { class: "os-textarea", rows: "5", maxlength: "3000", "aria-label": `نص رسالة ${RECIPIENT_LABEL[role]}` });
      area.value = edited[role] ?? messageFor(role);
      area.addEventListener("input", () => { edited[role] = area.value; });
      append(previews, h("label", { class: "os-field" }, h("span", { text: `رسالة ${RECIPIENT_LABEL[role]}` }), area,
        h("small", { text: "يُضاف رابط الرد الخاص بهذا الطرف تلقائيًا عند التجهيز." })));
    }
    clear(replyPreview);
    replyPreview.append(h("span", { class: "os-sub", style: { width: "100%" }, text: "أزرار الرد التي ستظهر للمستلم:" }));
    for (const option of replyOptionsFor(kind)) replyPreview.append(h("span", { class: "os-badge", text: option.label }));
  };

  const drawFields = () => {
    clear(fieldsBox);
    const template = templateOf(kind);
    for (const f of template.fields) {
      let input;
      if (f.type === "price") {
        input = h("input", { class: "os-input", name: f.key, inputmode: "numeric", value: values.price ? formatNumber(values.price) : "" });
      } else if (f.type === "datetime") {
        input = h("input", { class: "os-input", name: f.key, type: "datetime-local", value: values.viewingAt });
      } else {
        input = h("input", { class: "os-input", name: f.key, value: values[f.key] || "", maxlength: "300" });
      }
      input.addEventListener("input", () => { values[f.key] = input.value; for (const k of Object.keys(edited)) delete edited[k]; drawPreviews(); });
      append(fieldsBox, field(f.label, input));
    }
    const note = h("input", { class: "os-input", name: "note", value: values.note, maxlength: "300", placeholder: "ملاحظة تُضاف للرسالة" });
    note.addEventListener("input", () => { values.note = note.value; for (const k of Object.keys(edited)) delete edited[k]; drawPreviews(); });
    append(fieldsBox, field("ملاحظة", note, { optional: true }));
  };

  const drawTemplates = () => {
    clear(templateRow);
    for (const id of TEMPLATE_ORDER) {
      const t = templateOf(id);
      templateRow.append(h("button", { type: "button", class: "os-chip", "aria-pressed": String(kind === id), onClick: () => { kind = id; for (const k of Object.keys(edited)) delete edited[k]; drawTemplates(); drawFields(); drawPreviews(); } }, t.label));
    }
  };
  const drawRecipients = () => {
    clear(recipientSeg);
    for (const [id, label, list] of [["both", "الطرفان", [RECIPIENT.CLIENT, RECIPIENT.OWNER]], ["client", "العميل", [RECIPIENT.CLIENT]], ["owner", "المالك", [RECIPIENT.OWNER]]]) {
      const pressed = recipients.length === list.length && list.every((r) => recipients.includes(r));
      recipientSeg.append(h("button", { type: "button", "aria-pressed": String(pressed), onClick: () => { recipients = list; drawRecipients(); drawPreviews(); } }, label));
    }
  };

  prepareBtn.addEventListener("click", () => runAction(prepareBtn, async () => {
    const check = validateProposalFields(kind, fieldValues());
    if (!check.ok) throw new Error(Object.values(check.errors)[0]);
    const messages = {};
    for (const role of recipients) if (edited[role] !== undefined) messages[role] = edited[role];
    const res = await api("/os/proposals/create", {
      officeId: session.officeId, journeyId: journey.journeyId || journey.id, kind, recipients, fields: fieldValues(), messages, requestKey: `${requestKey}-${kind}-${recipients.join("")}`
    });
    clear(result);
    append(result, h("div", { class: "os-alert ok", text: "تم تجهيز المقترح. اضغط «إرسال عبر واتساب» لكل طرف." }));
    for (const p of res.proposals) append(result, proposalPreparedPanel(p));
    prepareBtn.hidden = true;
    body.querySelectorAll("input, textarea:not([readonly]), .os-chip, .os-seg button").forEach((el) => { if (!result.contains(el)) el.disabled = true; });
    result.scrollIntoView({ block: "start", behavior: "smooth" });
  }));

  drawTemplates(); drawFields(); drawRecipients(); drawPreviews();
  append(body, 
    h("div", { class: "os-field" }, h("span", { text: "نوع المقترح" }), templateRow),
    fieldsBox,
    h("div", { class: "os-field" }, h("span", { text: "إرسال إلى" }), recipientSeg),
    previews,
    replyPreview,
    prepareBtn,
    result
  );
  return openSheet("مقترح جديد", body);
}
