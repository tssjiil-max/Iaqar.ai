/**
 * Proposals and message templates — the WhatsApp communication pillar.
 *
 * A template is one registry entry: its fields, how its message reads, and which
 * reply options the recipient sees. Adding a template = adding an entry here.
 * The Worker validates replies against the same registry, so the UI and the server
 * can never disagree about what a valid reply is.
 */

import { cleanText, formatDateTime, formatPrice, toDate, toNumber } from "./format-domain.js";

export const RECIPIENT = Object.freeze({ CLIENT: "client", OWNER: "owner" });
export const RECIPIENT_LABEL = Object.freeze({ client: "العميل", owner: "المالك" });

export const PROPOSAL_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  ANSWERED: "ANSWERED",
  SUPERSEDED: "SUPERSEDED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED"
});

/** Honest handoff states: the system can only prove the broker opened WhatsApp. */
export const SEND_STATE = Object.freeze({
  READY: "READY",
  OPENED_EXTERNAL: "OPENED_EXTERNAL"
});

export const SEND_STATE_LABEL = Object.freeze({
  READY: "جاهز للإرسال",
  OPENED_EXTERNAL: "تم فتح واتساب"
});

const DAY = 24 * 3600 * 1000;
export const DEFAULT_LINK_TTL_MS = 7 * DAY;

/**
 * textKind: "text" | "price" | "datetime". needsText: the extra field appears only then.
 * effect: what the reply means for the workflow (interpreted by the Worker).
 */
export const TEMPLATES = Object.freeze({
  PRICE: {
    kind: "PRICE",
    label: "اقتراح سعر",
    icon: "coins",
    fields: [{ key: "price", label: "السعر المقترح", type: "price", required: true }],
    replies: [
      { id: "accept_initial", label: "موافق مبدئيًا", tone: "positive", effect: "PRICE_ACCEPTED" },
      { id: "counter", label: "أقترح سعرًا آخر", tone: "neutral", needsText: true, textKind: "price", textLabel: "السعر الذي تقترحه", effect: "PRICE_COUNTER" },
      { id: "reject", label: "غير مناسب", tone: "negative", effect: "PRICE_REJECTED" }
    ]
  },
  VIEWING: {
    kind: "VIEWING",
    label: "تحديد أو تعديل معاينة",
    icon: "calendar",
    fields: [{ key: "viewingAt", label: "موعد المعاينة", type: "datetime", required: true }],
    replies: [
      { id: "accept", label: "موافق", tone: "positive", effect: "VIEWING_ACCEPTED" },
      { id: "decline", label: "غير مناسب", tone: "negative", effect: "VIEWING_DECLINED" },
      { id: "other_time", label: "اقترح موعدًا آخر", tone: "neutral", needsText: true, textKind: "text", textLabel: "الموعد المناسب لك", effect: "VIEWING_COUNTER" }
    ]
  },
  INFO_REQUEST: {
    kind: "INFO_REQUEST",
    label: "طلب معلومات",
    icon: "question",
    fields: [{ key: "question", label: "المعلومة المطلوبة", type: "text", required: true }],
    replies: [
      { id: "provide", label: "إرسال المعلومة", tone: "positive", needsText: true, textKind: "text", textLabel: "اكتب المعلومة", effect: "INFO_PROVIDED" },
      { id: "later", label: "سأرد لاحقًا", tone: "neutral", effect: "INFO_LATER" }
    ]
  },
  INTEREST_FOLLOWUP: {
    kind: "INTEREST_FOLLOWUP",
    label: "متابعة الاهتمام",
    icon: "heart",
    fields: [],
    replies: [
      { id: "still_interested", label: "ما زلت مهتمًا", tone: "positive", effect: "INTERESTED" },
      { id: "need_time", label: "أحتاج وقتًا", tone: "neutral", effect: "NEEDS_TIME" },
      { id: "not_interested", label: "لم أعد مهتمًا", tone: "negative", effect: "NOT_INTERESTED" }
    ]
  },
  ACTION_CONFIRM: {
    kind: "ACTION_CONFIRM",
    label: "طلب تأكيد إجراء",
    icon: "check",
    fields: [{ key: "actionText", label: "الإجراء المطلوب تأكيده", type: "text", required: true }],
    replies: [
      { id: "confirm", label: "أؤكد", tone: "positive", effect: "ACTION_CONFIRMED" },
      { id: "need_change", label: "أحتاج تعديلًا", tone: "neutral", needsText: true, textKind: "text", textLabel: "التعديل المطلوب", effect: "ACTION_CHANGE" },
      { id: "decline", label: "لا أؤكد", tone: "negative", effect: "ACTION_DECLINED" }
    ]
  },
  AGREEMENT_STEPS: {
    kind: "AGREEMENT_STEPS",
    label: "متابعة خطوات الاتفاق",
    icon: "clipboard",
    fields: [{ key: "stepText", label: "الخطوة المطلوبة", type: "text", required: true }],
    replies: [
      { id: "done", label: "تم", tone: "positive", effect: "STEP_DONE" },
      { id: "in_progress", label: "جارٍ العمل عليها", tone: "neutral", effect: "STEP_IN_PROGRESS" },
      { id: "need_help", label: "أحتاج مساعدة", tone: "negative", needsText: true, textKind: "text", textLabel: "ما الذي تحتاجه؟", effect: "STEP_HELP" }
    ]
  }
});

export const TEMPLATE_ORDER = Object.freeze(["PRICE", "VIEWING", "INFO_REQUEST", "INTEREST_FOLLOWUP", "ACTION_CONFIRM", "AGREEMENT_STEPS"]);

export function templateOf(kind) {
  return TEMPLATES[String(kind || "").toUpperCase()] || null;
}

export function replyOptionsFor(kind) {
  return (templateOf(kind)?.replies || []).map((reply) => ({ ...reply }));
}

/** Validate template fields; returns { ok, errors, fields } with normalized values. */
export function validateProposalFields(kind, raw = {}, { now = new Date() } = {}) {
  const template = templateOf(kind);
  if (!template) return { ok: false, errors: { kind: "نوع المقترح غير معروف" }, fields: {} };
  const errors = {};
  const fields = {};
  for (const field of template.fields) {
    const value = raw[field.key];
    if (field.type === "price") {
      const n = toNumber(value);
      if (!(n > 0)) errors[field.key] = "اكتب السعر";
      else fields[field.key] = n;
    } else if (field.type === "datetime") {
      const date = toDate(value);
      if (!date) errors[field.key] = "حدد الموعد";
      else if (date.getTime() < now.getTime() - 5 * 60 * 1000) errors[field.key] = "الموعد في الماضي";
      else fields[field.key] = date.toISOString();
    } else {
      const text = cleanText(value, 300);
      if (field.required && text.length < 2) errors[field.key] = "اكتب النص المطلوب";
      else fields[field.key] = text;
    }
  }
  const note = cleanText(raw.note, 300);
  if (note) fields.note = note;
  return { ok: Object.keys(errors).length === 0, errors, fields };
}

/** Short neutral property line safe for either party (no names or phones). */
export function publicPropertyLine(summary = {}) {
  const type = cleanText(summary.propertyType, 40) || "العقار";
  const district = cleanText(summary.district, 80);
  const city = cleanText(summary.city, 60);
  const where = district ? ` في ${district.startsWith("حي") ? district : `حي ${district}`}` : "";
  return `${type}${where}${city && !district ? ` في ${city}` : city ? `، ${city}` : ""}`;
}

function greeting(name) {
  const first = cleanText(name, 40).split(" ")[0];
  return first ? `مرحبًا ${first}،` : "مرحبًا،";
}

/**
 * Build the prepared WhatsApp text. `link` is appended by the caller when known;
 * the Worker re-appends it if the broker removed it while editing.
 */
export function buildProposalMessage({ kind, fields = {}, recipientRole, recipientName = "", officeName = "", brokerName = "", property = {}, link = "", now = new Date() }) {
  const template = templateOf(kind);
  if (!template) return "";
  const line = publicPropertyLine(property);
  const lines = [greeting(recipientName)];
  const isClient = recipientRole === RECIPIENT.CLIENT;
  switch (template.kind) {
    case "PRICE":
      lines.push(isClient
        ? `بخصوص ${line}، نقترح عليك سعر ${formatPrice(fields.price)}.`
        : `بخصوص عقارك (${line})، وصلنا اهتمام بسعر ${formatPrice(fields.price)}.`);
      lines.push("نرجو اختيار ردك من الرابط.");
      break;
    case "VIEWING":
      lines.push(`نقترح موعد معاينة ${line} يوم ${formatDateTime(fields.viewingAt, now)}.`);
      lines.push("هل يناسبك الموعد؟ اختر ردك من الرابط.");
      break;
    case "INFO_REQUEST":
      lines.push(`بخصوص ${isClient ? "طلبك" : "عقارك"} (${line})، نحتاج منك: ${cleanText(fields.question, 300)}`);
      lines.push("يمكنك الرد من الرابط.");
      break;
    case "INTEREST_FOLLOWUP":
      lines.push(isClient
        ? `نتابع معك بخصوص ${line}. هل ما زلت مهتمًا؟`
        : `نتابع معك بخصوص عرض عقارك (${line}). هل ما زال العرض قائمًا ومناسبًا لك؟`);
      lines.push("اختر ردك من الرابط.");
      break;
    case "ACTION_CONFIRM":
      lines.push(`بخصوص ${line}، نرجو تأكيد: ${cleanText(fields.actionText, 300)}`);
      lines.push("اختر ردك من الرابط.");
      break;
    case "AGREEMENT_STEPS":
      lines.push(`متابعة لخطوات الاتفاق على ${line}: ${cleanText(fields.stepText, 300)}`);
      lines.push("أخبرنا بالحالة من الرابط.");
      break;
    default:
      break;
  }
  if (fields.note) lines.push(cleanText(fields.note, 300));
  if (link) lines.push(link);
  const signature = [cleanText(brokerName, 60), cleanText(officeName, 80)].filter(Boolean).join(" — ");
  if (signature) lines.push(signature);
  return lines.join("\n");
}

/** Ensure a broker-edited message still carries the reply link exactly once. */
export function ensureLinkInMessage(text, link) {
  const body = String(text || "").slice(0, 3500).trim();
  if (!link) return body;
  if (body.includes(link)) return body;
  return `${body}\n${link}`;
}

/** Summary lines for the reply page (no other-party data). */
export function proposalSummaryLines(kind, fields = {}, now = new Date()) {
  const lines = [];
  if (fields.price) lines.push({ label: "السعر المقترح", value: formatPrice(fields.price) });
  if (fields.viewingAt) lines.push({ label: "موعد المعاينة", value: formatDateTime(fields.viewingAt, now) });
  if (fields.question) lines.push({ label: "المطلوب", value: fields.question });
  if (fields.actionText) lines.push({ label: "الإجراء", value: fields.actionText });
  if (fields.stepText) lines.push({ label: "الخطوة", value: fields.stepText });
  if (fields.note) lines.push({ label: "ملاحظة", value: fields.note });
  return lines;
}

/**
 * Link expiry: 7 days by default; viewing proposals end 2 hours after the proposed
 * time (never longer than 7 days, never shorter than 1 hour from now).
 */
export function proposalExpiry(kind, fields = {}, now = new Date()) {
  const max = now.getTime() + DEFAULT_LINK_TTL_MS;
  if (String(kind).toUpperCase() === "VIEWING" && fields.viewingAt) {
    const at = toDate(fields.viewingAt);
    if (at) {
      const end = Math.min(max, Math.max(now.getTime() + 3600 * 1000, at.getTime() + 2 * 3600 * 1000));
      return new Date(end);
    }
  }
  return new Date(max);
}

/** Server-side reply validation against the template registry. */
export function validateReply(kind, optionId, text) {
  const option = replyOptionsFor(kind).find((item) => item.id === String(optionId || ""));
  if (!option) return { ok: false, error: "reply_option_invalid", message: "اختيار غير صالح" };
  const clean = cleanText(text, 500);
  if (option.needsText) {
    if (option.textKind === "price") {
      const n = toNumber(clean);
      if (!(n > 0)) return { ok: false, error: "reply_text_required", message: "اكتب السعر الذي تقترحه" };
      return { ok: true, option, text: String(n), value: n };
    }
    if (clean.length < 2) return { ok: false, error: "reply_text_required", message: option.textLabel ? `اكتب ${option.textLabel}` : "اكتب ردك" };
  }
  return { ok: true, option, text: option.needsText ? clean : "", value: null };
}

/** Human label for a saved reply, e.g. "أقترح سعرًا آخر: 1,150,000 ريال". */
export function replyLabel(kind, reply = {}) {
  const option = replyOptionsFor(kind).find((item) => item.id === reply.optionId);
  const base = option?.label || reply.label || "";
  if (!reply.text) return base;
  return option?.textKind === "price" ? `${base}: ${formatPrice(reply.text)}` : `${base}: ${reply.text}`;
}
