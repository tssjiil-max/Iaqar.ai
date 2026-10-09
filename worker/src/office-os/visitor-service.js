/**
 * «مدير المكتب الذكي» on Telegram, with people who opened an office's own bot link
 * (t.me/<bot>?start=of_<officeId>): who they are (button), what they offer or look for (their own words,
 * any language the model supports; the platform's Arabic parser when it does not), their mobile (Telegram's
 * own contact button), a summary, and — only after «سجّل» — the record, saved through the office's normal
 * save path (same validation, duplicate check, validity and matching). Rules: public/os/domain/visitor-domain.js.
 *
 * Gates: Telegram sending allowed on this environment + the office's bot switch + the office's agent switch.
 * Off → nothing is sent. The person's chat is remembered (no «Start» again for the next transaction), and
 * once a record is saved the chat is linked to it like a side linked from the record page.
 *
 *   telegramVisitors/<chatId>   one person's conversation state with one office at a time (Worker only)
 */

import {
  PERSONA, VISITOR_MODE, detectLang, isSmallTalk, kindForPersona, mergeDraft, nextMissing, personaButtons, questionFor, summaryLines,
  toRecordInput, visitorText, wantsHuman
} from "../../../public/os/domain/visitor-domain.js";
import { AGENT_LANGUAGE_RULES } from "../../../public/os/domain/agent-domain.js";
import { DURATION_OPTIONS } from "../../../public/os/domain/validity-domain.js";
import { recordView } from "../../../public/os/domain/records-domain.js";
import { whatsappDigits } from "../../../public/os/domain/format-domain.js";
import { botOutboundConfig, botSettings, notifyOffice, partyKey, sendToChat } from "./bot-notify.js";
import { saveRecord } from "./records-service.js";
import { officeValiditySettings } from "./validity-service.js";

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const CHAT_ID = /^\d{1,20}$/; // private chats only
const AI_CALLS_PER_CHAT_DAY = 40;
const visitorPath = (chatId) => ["telegramVisitors", text(chatId, 30)];

async function gatesOpen(ctx, officeId) {
  if (!botOutboundConfig(ctx.env).available) return false;
  if ((await botSettings(ctx.store, officeId)).enabled !== true) return false;
  return (await ctx.store.get(["offices", officeId, "agentSettings", "main"]))?.enabled === true;
}

async function officeName(ctx, officeId) {
  const office = (await ctx.store.get(["offices", officeId])) || {};
  return text(office.businessName || office.officeName || office.name, 80) || "";
}

const parseDraft = (doc) => { try { const d = JSON.parse(doc?.draftJson || "{}"); return d && typeof d === "object" ? d : {}; } catch { return {}; } };

async function saveState(ctx, chatId, patch) {
  const { draft, ...rest } = patch;
  await ctx.store.set(visitorPath(chatId), { ...rest, ...(draft ? { draftJson: JSON.stringify(draft).slice(0, 4000) } : {}), updatedAt: ctx.now() });
}

async function say(ctx, chatId, body, options = {}) {
  return sendToChat(ctx.deps, chatId, body, { ...options, now: ctx.now() });
}

// ------------------------------------------------------------------ start

/** «/start of_<officeId>»: a new conversation with this office (any earlier draft is set aside). */
export async function startVisitor(ctx, { officeId: rawOffice, chat = {}, from = {} }) {
  const chatId = text(chat.id, 30);
  if (chat.type !== "private" || !CHAT_ID.test(chatId)) return { ok: true, status: 200, ignored: true, reason: "not_private" };
  const officeId = ctx.deps.firestoreOfficeId(rawOffice);
  const office = officeId ? await ctx.store.get(["offices", officeId]) : null;
  const lang = /^en/i.test(text(from.language_code, 10)) ? "en" : "ar";
  if (!office) { await say(ctx, chatId, visitorText(lang).unknownOffice); return { ok: true, status: 200, visitor: "unknown_office" }; }
  if (!(await gatesOpen(ctx, officeId))) return { ok: true, status: 200, ignored: true, reason: "agent_off" };
  await saveState(ctx, chatId, { chatId, officeId, mode: VISITOR_MODE.AGENT, stage: "PERSONA", persona: "", draft: {}, lang, name: text([from.first_name, from.last_name].filter(Boolean).join(" "), 80), startedAt: ctx.now() });
  const known = (await ctx.store.get(["telegramBotChats", chatId])) || {};
  await ctx.store.set(["telegramBotChats", chatId], { lastOfficeId: officeId, lastOfficeAt: ctx.now(), visitorOffices: { ...(known.visitorOffices || {}), [officeId]: true }, updatedAt: ctx.now() });
  await say(ctx, chatId, visitorText(lang).welcome(await officeName(ctx, officeId) || "المكتب"), { buttons: personaButtons(lang) });
  return { ok: true, status: 200, visitor: "started", officeId };
}

// ------------------------------------------------------------------ buttons

export function isVisitorCallback(data) {
  return /^(vp:(OWNER|BROKER|CLIENT)|vk:(OFFER|REQUEST)|vc:(SAVE|EDIT)|vn:NEW)$/.test(String(data || ""));
}

export async function handleVisitorCallback(ctx, query = {}) {
  const chatId = text(query.message?.chat?.id, 30);
  const toast = (message = "") => ctx.deps.telegram("answerCallbackQuery", { callback_query_id: text(query.id, 80), text: String(message).slice(0, 180) }).catch(() => {});
  const doc = await ctx.store.get(visitorPath(chatId));
  // The person pressing must be this private chat's own user.
  if (!doc || (query.from?.id !== undefined && text(query.from.id, 30) !== chatId)) { await toast(""); return { ok: true, status: 200, ignored: true, reason: "not_this_chat" }; }
  const officeId = ctx.deps.firestoreOfficeId(doc.officeId);
  if (!(await gatesOpen(ctx, officeId))) { await toast(""); return { ok: true, status: 200, ignored: true, reason: "agent_off" }; }
  const lang = doc.lang === "en" ? "en" : "ar";
  const t = visitorText(lang);
  const data = String(query.data || "");
  await toast("");
  if (data.startsWith("vp:")) {
    const persona = data.slice(3);
    const kind = kindForPersona(persona);
    await saveState(ctx, chatId, { persona, stage: kind ? "COLLECT" : "KIND", draft: kind ? { kind } : {} });
    if (!kind) await say(ctx, chatId, t.brokerKind, { buttons: [[{ text: t.kinds.OFFER, callback_data: "vk:OFFER" }, { text: t.kinds.REQUEST, callback_data: "vk:REQUEST" }]] });
    else await say(ctx, chatId, kind === "OFFER" ? t.firstOwner : t.firstClient);
    return { ok: true, status: 200, persona };
  }
  if (data.startsWith("vk:")) {
    const kind = data.slice(3);
    await saveState(ctx, chatId, { stage: "COLLECT", draft: { kind } });
    await say(ctx, chatId, kind === "OFFER" ? t.firstOwner : t.firstClient);
    return { ok: true, status: 200, kind };
  }
  if (data === "vn:NEW") {
    await saveState(ctx, chatId, { stage: "PERSONA", persona: "", draft: {} });
    await say(ctx, chatId, t.welcome(await officeName(ctx, officeId) || "المكتب"), { buttons: personaButtons(lang) });
    return { ok: true, status: 200, newTransaction: true };
  }
  if (data === "vc:EDIT") {
    await saveState(ctx, chatId, { stage: "COLLECT" });
    await say(ctx, chatId, t.editHint);
    return { ok: true, status: 200, editing: true };
  }
  if (data === "vc:SAVE") return saveVisitorRecord(ctx, { chatId, doc, officeId, lang });
  return { ok: true, status: 200, ignored: true, reason: "unknown_button" };
}

// ------------------------------------------------------------------ messages

async function understand(ctx, { officeId, doc, draft, body }) {
  const day = ctx.now().toISOString().slice(0, 10);
  const used = doc.aiDay === day ? Number(doc.aiCalls || 0) : 0;
  const canAi = Boolean(text(ctx.env?.GEMINI_API_KEY, 300)) && typeof ctx.deps.callGemini === "function" && used < AI_CALLS_PER_CHAT_DAY;
  if (canAi) {
    await saveState(ctx, doc.chatId, { aiDay: day, aiCalls: used + 1 });
    const system = [
      `أنت «مدير المكتب الذكي» لمكتب عقاري (مساعد ذكاء اصطناعي، لست موظفًا بشريًا). تتحدث مع شخص يسجل ${draft.kind === "REQUEST" ? "طلب عقار" : "عرض عقار"}.`,
      AGENT_LANGUAGE_RULES,
      "استخرج الحقائق من رسالة الشخص فقط. لا تخترع أي رقم أو حي أو سعر. احفظ الأرقام كما كتبها (حوّل «850 ألف» إلى 850000 فقط).",
      `المسودة الحالية: ${JSON.stringify(draft)}`,
      "بعد إضافة ما قاله، اسأل سؤالًا واحدًا قصيرًا عن أول معلومة ناقصة بالترتيب: الغرض (بيع/إيجار أو شراء/إيجار)، نوع العقار، الحي، المدينة، السعر أو الميزانية. إذا لم يبق شيء ناقص اجعل question فارغًا.",
      "أعد JSON فقط: {\"found\": {\"propertyType\": \"\", \"city\": \"\", \"district\": \"\", \"price\": 0, \"area\": 0, \"rooms\": 0, \"transactionType\": \"sale|rent|\"}, \"lang\": \"رمز لغة الشخص مثل ar أو en أو ur\", \"question\": \"سؤالك بلغة الشخص ولهجته\"}"
    ].join("\n");
    const result = await Promise.race([
      ctx.deps.callGemini({ systemInstruction: system, userParts: [{ text: body.slice(0, 1500) }], generationConfig: { temperature: 0.2, maxOutputTokens: 600, responseMimeType: "application/json" } }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "TIMEOUT" }), 10000))
    ]).catch(() => ({ ok: false }));
    if (result?.ok && result.parsed && typeof result.parsed === "object") {
      const found = result.parsed.found && typeof result.parsed.found === "object" ? result.parsed.found : {};
      return { found, lang: text(result.parsed.lang, 8).toLowerCase(), question: text(result.parsed.question, 300), source: "ai" };
    }
  }
  // The platform's own Arabic real-estate parser.
  const parsed = typeof ctx.deps.parseMessage === "function" ? ctx.deps.parseMessage(body) : {};
  return {
    found: { propertyType: parsed.propertyType, district: parsed.district, city: /المدينة|مكة|جدة|الرياض|الدمام|الخبر|الطائف|ابها|تبوك|بريدة|حائل/.test(body) ? parsed.city : "", price: parsed.price, area: parsed.area, rooms: parsed.rooms, transactionType: parsed.transactionType },
    lang: detectLang(body), question: "", source: "rules"
  };
}

async function forwardToOffice(ctx, { officeId, doc, chatId, body, update }) {
  const inboxId = `tgv_${String(update?.update_id ?? Date.now()).replace(/[^0-9A-Za-z_-]/g, "").slice(0, 40)}`;
  const created = await ctx.store.create(["offices", officeId, "inbox", inboxId], {
    schemaVersion: 3, officeId, direction: "inbound", source: "telegram_bot_visitor", channel: "telegram", status: "kept", processingState: "kept", isProcessed: true,
    outboundEnabled: false, messageType: "text", messageText: body, senderName: text(doc.name, 60), messageClass: "DEAL",
    messageClassReason: "محادثة مع مدير المكتب الذكي حُوّلت للوسيط", receivedAt: ctx.now(), createdAt: ctx.now()
  });
  if (created) {
    await notifyOffice(ctx.store, ctx.deps, { officeId, key: `visitor|${inboxId}`, title: `محادثة تحتاجك عبر البوت — ${text(doc.name, 40) || "زائر"}`, body: body.slice(0, 200), route: "inbox", now: ctx.now() });
  }
  return created;
}

const ACTIVE_STAGES = ["PERSONA", "KIND", "COLLECT", "PHONE", "CONFIRM"];

/**
 * A message in a visitor conversation. null = not a visitor chat (the caller continues as before).
 * activeOnly: called BEFORE the linked-side handler — takes the message only while a transaction is being
 * collected (so a person who already has a saved record can still register a second one), never a «/» command.
 */
export async function handleVisitorMessage(ctx, { update = {}, message = {}, activeOnly = false }) {
  const chatId = text(message.chat?.id, 30);
  if (message.chat?.type !== "private" || !CHAT_ID.test(chatId)) return null;
  const doc = await ctx.store.get(visitorPath(chatId));
  if (!doc) return null;
  if (activeOnly) {
    if (doc.mode === VISITOR_MODE.HUMAN || !ACTIVE_STAGES.includes(doc.stage)) return null;
    if (/^\//.test(text(message.text, 20))) return null;
    if (message.contact && doc.stage !== "PHONE") return null;
  }
  const officeId = ctx.deps.firestoreOfficeId(doc.officeId);
  // A webhook delivered twice is answered once.
  if (update.update_id !== undefined && Number(doc.lastUpdateId || 0) >= Number(update.update_id)) return { ok: true, status: 200, duplicate: true };
  await saveState(ctx, chatId, { lastUpdateId: Number(update.update_id || 0) });
  if (!(await gatesOpen(ctx, officeId))) return null;
  const body = text(message.text, 1500);
  let lang = doc.lang === "en" ? "en" : "ar";
  const t = () => visitorText(lang);
  if (doc.mode === VISITOR_MODE.HUMAN) {
    if (body) await forwardToOffice(ctx, { officeId, doc, chatId, body, update });
    return { ok: true, status: 200, forwarded: 1, mode: VISITOR_MODE.HUMAN };
  }
  let draft = parseDraft(doc);
  // Telegram's own contact button: the person's own number only.
  if (message.contact) {
    if (doc.stage !== "PHONE") return { ok: true, status: 200, ignored: true, reason: "contact_not_expected" };
    if (text(message.contact.user_id, 30) !== text(message.from?.id, 30)) { await say(ctx, chatId, t().phoneMismatch); return { ok: true, status: 200, phone: "not_own" }; }
    const digits = whatsappDigits(message.contact.phone_number);
    if (!digits) { await say(ctx, chatId, t().phoneMismatch); return { ok: true, status: 200, phone: "invalid" }; }
    const phone = `0${digits.slice(3)}`;
    await saveState(ctx, chatId, { phone, stage: "CONFIRM" });
    await say(ctx, chatId, "✓", { keyboard: { remove_keyboard: true } });
    await say(ctx, chatId, t().summary(summaryLines(draft, lang)), { buttons: [[{ text: t().save, callback_data: "vc:SAVE" }, { text: t().edit, callback_data: "vc:EDIT" }]] });
    return { ok: true, status: 200, phone: "saved", stage: "CONFIRM" };
  }
  if (!body) return { ok: true, status: 200, ignored: true, reason: "no_text" };
  if (detectLang(body) === "en") lang = "en";
  if (wantsHuman(body)) {
    await saveState(ctx, chatId, { mode: VISITOR_MODE.HUMAN, handedAt: ctx.now(), lang });
    await forwardToOffice(ctx, { officeId, doc, chatId, body, update });
    await say(ctx, chatId, t().handedOver);
    return { ok: true, status: 200, handedOver: true };
  }
  if (["PERSONA", "KIND", "DONE"].includes(doc.stage) || !draft.kind) {
    // Small talk or a message before choosing: never turned into a record.
    await say(ctx, chatId, isSmallTalk(body) ? t().smallTalk : t().welcome(await officeName(ctx, officeId) || "المكتب"), { buttons: isSmallTalk(body) && doc.stage === "DONE" ? [[{ text: t().newTx, callback_data: "vn:NEW" }]] : personaButtons(lang) });
    return { ok: true, status: 200, stage: doc.stage, smallTalk: isSmallTalk(body) };
  }
  if (isSmallTalk(body)) { await say(ctx, chatId, t().smallTalk); return { ok: true, status: 200, smallTalk: true }; }
  const understood = await understand(ctx, { officeId, doc: { ...doc, chatId }, draft, body });
  if (understood.lang === "en") lang = "en";
  draft = mergeDraft(draft, understood.found);
  const missing = nextMissing(draft);
  if (missing) {
    // The model's own question (in the person's language and dialect) when it asks for the same missing thing; else ours.
    const question = understood.source === "ai" && understood.question ? understood.question : questionFor(missing, draft, lang);
    await saveState(ctx, chatId, { draft, stage: "COLLECT", lang, langCode: understood.lang || lang });
    await say(ctx, chatId, question);
    return { ok: true, status: 200, asked: missing, source: understood.source };
  }
  if (!doc.phone) {
    await saveState(ctx, chatId, { draft, stage: "PHONE", lang });
    await say(ctx, chatId, t().phone, { keyboard: { keyboard: [[{ text: t().phoneButton, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
    return { ok: true, status: 200, asked: "phone" };
  }
  await saveState(ctx, chatId, { draft, stage: "CONFIRM", lang });
  await say(ctx, chatId, t().summary(summaryLines(draft, lang)), { buttons: [[{ text: t().save, callback_data: "vc:SAVE" }, { text: t().edit, callback_data: "vc:EDIT" }]] });
  return { ok: true, status: 200, stage: "CONFIRM" };
}

// ------------------------------------------------------------------ saving

async function assigneeOf(ctx, officeId) {
  const assignment = await ctx.store.get(["offices", officeId, "officeSettings", "assignment"]).catch(() => null);
  const office = (await ctx.store.get(["offices", officeId])) || {};
  return text(assignment?.defaultBrokerId || office.ownerUid, 128) || "office-agent";
}

async function saveVisitorRecord(ctx, { chatId, doc, officeId, lang }) {
  const t = visitorText(lang);
  if (doc.stage !== "CONFIRM" || !doc.phone) return { ok: true, status: 200, ignored: true, reason: "not_ready" };
  const draft = parseDraft(doc);
  const actor = { uid: await assigneeOf(ctx, officeId), role: "broker", isManager: false };
  let saved;
  try {
    saved = await saveRecord(ctx, { actor, officeId, input: toRecordInput(draft, { phone: doc.phone, name: doc.name }), requestKey: `tgv-${chatId}-${text(doc.startedAt?.toISOString?.() || doc.startedAt, 40)}`, sourceType: "TELEGRAM_AGENT" });
  } catch (error) {
    await saveState(ctx, chatId, { stage: "COLLECT" });
    await say(ctx, chatId, `${error?.publicMessage || t.unclear}\n${t.editHint}`);
    return { ok: true, status: 200, saved: false, reason: error?.code || "invalid" };
  }
  const record = await ctx.store.get(["offices", officeId, "opportunities", saved.recordId]);
  const ref = recordView({ ...(record || {}), id: saved.recordId }).reference;
  // This chat now speaks for the record (no «Start» again): the same link a side gets from the record page.
  const key = await partyKey(ctx.deps, officeId, whatsappDigits(doc.phone));
  if (key) {
    await ctx.store.set(["telegramParties", key], { officeId, partyKey: key, chatId, status: "ACTIVE", name: text(doc.name, 60), recordId: saved.recordId, linkedAt: ctx.now().toISOString(), linkedBy: "visitor", phoneConfirmed: true, updatedAt: ctx.now() });
    const known = (await ctx.store.get(["telegramBotChats", chatId])) || {};
    await ctx.store.set(["telegramBotChats", chatId], { parties: { ...(known.parties || {}), [officeId]: key }, lastOfficeId: officeId, lastOfficeAt: ctx.now(), updatedAt: ctx.now() });
  }
  const settings = await officeValiditySettings(ctx, officeId);
  const duration = DURATION_OPTIONS.find((o) => o.id === (record?.validityDuration || settings.defaultDuration))?.label || "";
  await saveState(ctx, chatId, { stage: "DONE", draft: {}, lastRecordId: saved.recordId });
  await say(ctx, chatId, t.saved(ref, lang === "en" ? (record?.validityDuration || "MONTH").toLowerCase().replace("_", " ") : (duration || "شهر")), { buttons: [[{ text: t.newTx, callback_data: "vn:NEW" }]] });
  return { ok: true, status: 200, saved: true, recordId: saved.recordId, duplicate: saved.duplicate === true, reference: ref };
}

export { PERSONA };
