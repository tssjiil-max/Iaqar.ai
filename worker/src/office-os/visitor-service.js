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
  CITIES, PERSONA, VISITOR_MODE, detectLang, extractFacts, isSmallTalk, isYes, kindForPersona, mergeDraft, nextMissing, personaButtons, personaFromText,
  questionFor, summaryLines, toRecordInput, visitorText, wantsHuman
} from "../../../public/os/domain/visitor-domain.js";
import { AGENT_LANGUAGE_RULES } from "../../../public/os/domain/agent-domain.js";
import { partyCommand } from "../../../public/os/domain/bot-domain.js";
import { DURATION_OPTIONS } from "../../../public/os/domain/validity-domain.js";
import { recordView, validateRecordInput } from "../../../public/os/domain/records-domain.js";
import { whatsappDigits } from "../../../public/os/domain/format-domain.js";
import { botOutboundConfig, botSettings, notifyOffice, partyKey, sendToChat } from "./bot-notify.js";
import { saveRecord } from "./records-service.js";
import { officeValiditySettings } from "./validity-service.js";

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const CHAT_ID = /^\d{1,20}$/; // private chats only
const AI_CALLS_PER_CHAT_DAY = 40;
const visitorPath = (chatId) => ["telegramVisitors", text(chatId, 30)];

async function gatesOpen(ctx, officeId) {
  // «جرّب مدير مكتبك»: nothing leaves the Worker, so only the office's agent switch matters.
  if (ctx.preview) return (await ctx.store.get(["offices", officeId, "agentSettings", "main"]))?.enabled === true;
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
  // A button from an older message must not undo the current step.
  const stage = String(doc.stage || "");
  const allowed = data.startsWith("vp:") ? ["PERSONA", "KIND"].includes(stage)
    : data.startsWith("vk:") ? stage === "KIND"
      : data.startsWith("vc:") ? stage === "CONFIRM"
        : data === "vn:NEW" ? ["DONE", "CONFIRM", "COLLECT", "PHONE", "KIND", "PERSONA"].includes(stage) || !stage : false;
  if (!allowed) return { ok: true, status: 200, ignored: true, reason: "stale_button" };
  if (data.startsWith("vp:")) {
    const persona = data.slice(3);
    const kind = kindForPersona(persona);
    await saveState(ctx, chatId, { persona, stage: kind ? "COLLECT" : "KIND", draft: kind ? { kind } : {}, asked: "", suggestedCity: "" });
    if (!kind) await say(ctx, chatId, t.brokerKind, { buttons: [[{ text: t.kinds.OFFER, callback_data: "vk:OFFER" }, { text: t.kinds.REQUEST, callback_data: "vk:REQUEST" }]] });
    else await say(ctx, chatId, kind === "OFFER" ? t.firstOwner : t.firstClient);
    return { ok: true, status: 200, persona };
  }
  if (data.startsWith("vk:")) {
    const kind = data.slice(3);
    await saveState(ctx, chatId, { stage: "COLLECT", draft: { kind }, asked: "", suggestedCity: "" });
    await say(ctx, chatId, kind === "OFFER" ? t.firstOwner : t.firstClient);
    return { ok: true, status: 200, kind };
  }
  if (data === "vn:NEW") {
    await saveState(ctx, chatId, { stage: "PERSONA", persona: "", draft: {} });
    await say(ctx, chatId, t.welcome(await officeName(ctx, officeId) || "المكتب"), { buttons: personaButtons(lang) });
    return { ok: true, status: 200, newTransaction: true };
  }
  if (data === "vc:EDIT") {
    await saveState(ctx, chatId, { stage: "COLLECT", asked: "", suggestedCity: "" });
    await say(ctx, chatId, t.editHint);
    return { ok: true, status: 200, editing: true };
  }
  if (data === "vc:SAVE") return saveVisitorRecord(ctx, { chatId, doc, officeId, lang });
  return { ok: true, status: 200, ignored: true, reason: "unknown_button" };
}

// ------------------------------------------------------------------ messages

/**
 * What the person said, as facts. The office's own Arabic rules ALWAYS run (so a long message is understood
 * at once even without the model); the model, when available, adds what the rules missed and other languages.
 * `asked` = the thing just asked, so a short answer («الوبرة», «35 ألف») lands in the right place.
 */
async function understand(ctx, { officeId, doc, draft, body, asked = "" }) {
  const rules = extractFacts(body, { expectNumber: asked });
  // The platform parser only fills gaps (never the city: a district must not become a city).
  const parsed = typeof ctx.deps.parseMessage === "function" ? (ctx.deps.parseMessage(body) || {}) : {};
  for (const key of ["propertyType", "price", "area", "rooms", "transactionType"]) if (rules[key] === undefined && parsed[key]) rules[key] = parsed[key];
  const day = ctx.now().toISOString().slice(0, 10);
  const used = doc.aiDay === day ? Number(doc.aiCalls || 0) : 0;
  const canAi = Boolean(text(ctx.env?.GEMINI_API_KEY, 300)) && typeof ctx.deps.callGemini === "function" && used < AI_CALLS_PER_CHAT_DAY;
  if (canAi) {
    await saveState(ctx, doc.chatId, { aiDay: day, aiCalls: used + 1 });
    const system = [
      `أنت «مدير المكتب الذكي» لمكتب عقاري (مساعد ذكاء اصطناعي، لست موظفًا بشريًا). تتحدث مع شخص يسجل ${draft.kind === "REQUEST" ? "طلب عقار (يبحث عن عقار)" : "عرض عقار (يملك العقار)"}.`,
      AGENT_LANGUAGE_RULES,
      "استخرج كل الحقائق المذكورة في رسالة الشخص دفعة واحدة. لا تخترع أي رقم أو حي أو مدينة أو سعر لم يُذكر. الحي ليس مدينة: «الوبرة» و«العزيزية» أحياء.",
      asked ? `آخر سؤال سألته كان عن: ${asked}. إذا كانت الرسالة جوابًا قصيرًا فهي لهذا الحقل.` : "",
      `المسودة الحالية: ${JSON.stringify(draft)}`,
      "أعد JSON فقط: {\"found\": {\"propertyType\": \"\", \"city\": \"\", \"district\": \"\", \"price\": 0, \"area\": 0, \"rooms\": 0, \"halls\": 0, \"bathrooms\": 0, \"kitchen\": \"\", \"rentPeriod\": \"YEARLY|MONTHLY|\", \"transactionType\": \"sale|rent|\"}, \"lang\": \"رمز لغة الشخص مثل ar أو en أو ur\", \"question\": \"سؤال واحد قصير بلغة الشخص عن أول معلومة ناقصة، أو فارغ\"}"
    ].filter(Boolean).join("\n");
    const result = await Promise.race([
      ctx.deps.callGemini({ systemInstruction: system, userParts: [{ text: body.slice(0, 1500) }], generationConfig: { temperature: 0.2, maxOutputTokens: 700, responseMimeType: "application/json" } }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "TIMEOUT" }), 10000))
    ]).catch(() => ({ ok: false }));
    if (result?.ok && result.parsed && typeof result.parsed === "object") {
      const ai = result.parsed.found && typeof result.parsed.found === "object" ? result.parsed.found : {};
      const found = { ...rules };
      for (const [key, value] of Object.entries(ai)) {
        if (value === undefined || value === null || value === "" || value === 0) continue;
        // The model may not move a district into the city, nor change what the rules read exactly.
        if (key === "city" && (norm(value) === norm(rules.district || ai.district || draft.district || "") || (!CITIES.includes(String(value)) && !body.includes(String(value))))) continue;
        if (found[key] === undefined) found[key] = value;
      }
      return { found, lang: text(result.parsed.lang, 8).toLowerCase(), question: text(result.parsed.question, 300), source: "ai" };
    }
  }
  return { found: rules, lang: detectLang(body), question: "", source: "rules" };
}

const norm = (value) => String(value || "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").trim().toLowerCase();

/** The office's city, for «حي الوبرة في المدينة المنورة؟» — the office's own setting, else the city of most of its records. */
async function officeCity(ctx, officeId) {
  const office = (await ctx.store.get(["offices", officeId])) || {};
  const own = text(office.city || office.officeCity || office.publicProfile?.city, 60);
  if (own) return CITY_LIST_NORMALIZE(own);
  const rows = await ctx.store.list(["offices", officeId, "opportunities"], 200).catch(() => []);
  const counts = {};
  for (const r of rows) { const c = text(r.city, 60); if (c) counts[c] = (counts[c] || 0) + 1; }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ["", 0];
  return n >= 3 && n / rows.length >= 0.6 ? best : "";
}
const CITY_LIST_NORMALIZE = (value) => CITIES.find((c) => norm(c) === norm(value) || norm(c).startsWith(norm(value))) || value;

async function forwardToOffice(ctx, { officeId, doc, chatId, body, update }) {
  if (ctx.preview) return false; // a try-out never reaches the office's inbox
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
const MINUTE = 60000;
// How long a started conversation keeps taking the person's messages before his other links (an office he is a
// side of) get them again: a choice not made yet — 30 minutes; a transaction being filled in or a chat handed
// to the office — 24 hours.
const WINDOW = { PERSONA: 30 * MINUTE, KIND: 30 * MINUTE, COLLECT: 1440 * MINUTE, PHONE: 1440 * MINUTE, CONFIRM: 1440 * MINUTE, HUMAN: 1440 * MINUTE };
const msOf = (value) => (value instanceof Date ? value.getTime() : value?.toDate ? value.toDate().getTime() : new Date(value || 0).getTime()) || 0;

function stillActive(doc, now) {
  const key = doc.mode === VISITOR_MODE.HUMAN ? "HUMAN" : String(doc.stage || "");
  const span = WINDOW[key];
  if (!span) return false;
  const since = key === "HUMAN" ? msOf(doc.handedAt || doc.updatedAt) : msOf(doc.updatedAt);
  return now.getTime() - since <= span;
}

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
    if (!(ACTIVE_STAGES.includes(doc.stage) || doc.mode === VISITOR_MODE.HUMAN) || !stillActive(doc, ctx.now())) return null;
    // «/stop», «إيقاف» and the like stay the linked-side commands they were.
    if (/^\//.test(text(message.text, 20)) || partyCommand(message.text)) return null;
    if (message.contact && (doc.mode === VISITOR_MODE.HUMAN || doc.stage !== "PHONE")) return null;
    // A record-page link waiting for this person's contact completes first.
    if (message.contact && (await ctx.store.get(["telegramPartyPending", chatId]))?.status === "WAITING") return null;
  }
  const officeId = ctx.deps.firestoreOfficeId(doc.officeId);
  if (!(await gatesOpen(ctx, officeId))) return null;
  // A webhook delivered twice is answered once (by id, not by order: Telegram may deliver two updates in parallel).
  if (update.update_id !== undefined) {
    const id = Number(update.update_id);
    const seen = await ctx.store.update(visitorPath(chatId), (current) => {
      const recent = Array.isArray(current.recentUpdates) ? current.recentUpdates.map(Number) : [];
      return recent.includes(id) ? null : { recentUpdates: [...recent, id].slice(-30) };
    });
    if (seen && !seen.patch) return { ok: true, status: 200, duplicate: true };
  }
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
    if (!digits) { await say(ctx, chatId, t().phoneSaudiOnly, { keyboard: { remove_keyboard: true } }); return { ok: true, status: 200, phone: "not_saudi" }; }
    const phone = `0${digits.slice(3)}`;
    await saveState(ctx, chatId, { phone, stage: "CONFIRM" });
    if (!ctx.preview) await say(ctx, chatId, "✓", { keyboard: { remove_keyboard: true } });
    await say(ctx, chatId, t().summary(summaryLines(draft, lang), draft.kind), { buttons: [[{ text: t().save, callback_data: "vc:SAVE" }, { text: t().edit, callback_data: "vc:EDIT" }]] });
    return { ok: true, status: 200, phone: "saved", stage: "CONFIRM", draft };
  }
  if (!body) return { ok: true, status: 200, ignored: true, reason: "no_text" };
  if (detectLang(body) === "en") lang = "en";
  if (wantsHuman(body)) {
    await saveState(ctx, chatId, { mode: VISITOR_MODE.HUMAN, handedAt: ctx.now(), lang });
    await forwardToOffice(ctx, { officeId, doc, chatId, body, update });
    await say(ctx, chatId, t().handedOver);
    return { ok: true, status: 200, handedOver: true };
  }
  // A number typed instead of the contact button: in the app's try-out it is the test number; on Telegram the
  // button stays required (it proves the number is the person's own).
  if (doc.stage === "PHONE" && whatsappDigits(body)) {
    if (ctx.preview) return handleVisitorMessage(ctx, { update: { update_id: Number(update.update_id || 0) + 1 }, message: { chat: message.chat, from: message.from, contact: { phone_number: body, user_id: message.from?.id } } });
    await say(ctx, chatId, `${t().phone}\n${lang === "en" ? "(The button confirms the number is yours.)" : "(الزر يؤكد أن الرقم رقمك أنت.)"}`, { keyboard: { keyboard: [[{ text: t().phoneButton, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
    return { ok: true, status: 200, asked: "phone", typedNumber: true };
  }
  let stage = String(doc.stage || "");
  let persona = String(doc.persona || "");
  // Who the person is, said in words («أنا مالك»، «عندي شقة للإيجار»، «أدور فيلا») instead of a button.
  if (stage === "PERSONA" || (stage === "DONE" && !isSmallTalk(body))) {
    const said = personaFromText(body) || (stage === "DONE" ? persona : "");
    const facts = extractFacts(body);
    const hasFacts = Boolean(facts.propertyType || facts.district || facts.price || facts.transactionType);
    if (!said || (stage === "DONE" && !hasFacts)) {
      if (stage === "DONE") { await say(ctx, chatId, t().smallTalk, { buttons: [[{ text: t().newTx, callback_data: "vn:NEW" }]] }); return { ok: true, status: 200, stage }; }
      // Not the full welcome again: a short pointer to the same three choices.
      await say(ctx, chatId, isSmallTalk(body) ? t().smallTalk : t().pickPersona, { buttons: personaButtons(lang) });
      return { ok: true, status: 200, stage, smallTalk: isSmallTalk(body) };
    }
    persona = said;
    const kind = kindForPersona(persona);
    if (!kind) {
      await saveState(ctx, chatId, { persona, stage: "KIND", draft: {} });
      await say(ctx, chatId, t().brokerKind, { buttons: [[{ text: t().kinds.OFFER, callback_data: "vk:OFFER" }, { text: t().kinds.REQUEST, callback_data: "vk:REQUEST" }]] });
      return { ok: true, status: 200, persona, stage: "KIND" };
    }
    draft = { kind };
    stage = "COLLECT";
    await saveState(ctx, chatId, { persona, stage, draft, asked: "" });
    if (!hasFacts) { await say(ctx, chatId, kind === "OFFER" ? t().firstOwner : t().firstClient); return { ok: true, status: 200, persona, stage }; }
  }
  if (stage === "KIND") {
    const k = /عرض|offer|listing/i.test(body) ? "OFFER" : /طلب|request/i.test(body) ? "REQUEST" : "";
    if (!k) { await say(ctx, chatId, t().brokerKind, { buttons: [[{ text: t().kinds.OFFER, callback_data: "vk:OFFER" }, { text: t().kinds.REQUEST, callback_data: "vk:REQUEST" }]] }); return { ok: true, status: 200, stage }; }
    draft = { kind: k };
    stage = "COLLECT";
    await saveState(ctx, chatId, { stage, draft, asked: "" });
    if (!(extractFacts(body).propertyType || extractFacts(body).district)) { await say(ctx, chatId, k === "OFFER" ? t().firstOwner : t().firstClient); return { ok: true, status: 200, kind: k }; }
  }
  if (!draft.kind) {
    await say(ctx, chatId, t().pickPersona, { buttons: personaButtons(lang) });
    return { ok: true, status: 200, stage };
  }
  if (isSmallTalk(body) && !(doc.asked === "city" && isYes(body))) { await say(ctx, chatId, t().smallTalk); return { ok: true, status: 200, smallTalk: true }; }
  // «حي الوبرة في المدينة المنورة؟» → «نعم»
  let source = "rules";
  if (doc.asked === "city" && doc.suggestedCity && isYes(body)) {
    draft = mergeDraft(draft, { city: doc.suggestedCity });
  } else {
    const understood = await understand(ctx, { officeId, doc: { ...doc, chatId }, draft, body, asked: doc.asked || "" });
    if (understood.lang === "en") lang = "en";
    draft = mergeDraft(draft, understood.found);
    source = understood.source;
    doc.langCode = understood.lang || doc.langCode;
    // The model's own wording is used only for languages the texts here do not cover, and never when it asks
    // something other than the missing field (e.g. «who are you?» again): the question always follows the draft.
    doc.aiQuestion = understood.source === "ai" && understood.lang && !["ar", "en"].includes(understood.lang)
      && !/مالك|وسيط|عميل|owner|broker|client/i.test(understood.question) ? understood.question : "";
  }
  const missing = nextMissing(draft);
  if (missing) {
    let question = doc.aiQuestion || questionFor(missing, draft, lang);
    let suggestedCity = "";
    if (missing === "city" && draft.district) {
      suggestedCity = await officeCity(ctx, officeId);
      if (suggestedCity) question = t().confirmCity(draft.district, suggestedCity);
    }
    await saveState(ctx, chatId, { draft, stage: "COLLECT", lang, langCode: doc.langCode || lang, asked: missing, suggestedCity });
    await say(ctx, chatId, question);
    return { ok: true, status: 200, asked: missing, suggestedCity, draft, source };
  }
  if (!doc.phone) {
    await saveState(ctx, chatId, { draft, stage: "PHONE", lang, asked: "phone", suggestedCity: "" });
    await say(ctx, chatId, t().phone, { keyboard: { keyboard: [[{ text: t().phoneButton, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
    return { ok: true, status: 200, asked: "phone", draft, source };
  }
  await saveState(ctx, chatId, { draft, stage: "CONFIRM", lang, asked: "", suggestedCity: "" });
  await say(ctx, chatId, t().summary(summaryLines(draft, lang), draft.kind), { buttons: [[{ text: t().save, callback_data: "vc:SAVE" }, { text: t().edit, callback_data: "vc:EDIT" }]] });
  return { ok: true, status: 200, stage: "CONFIRM", draft, source };
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
  if (ctx.preview) {
    // A try-out: the record is checked by the office's own rules but never saved, and nobody is linked.
    const check = validateRecordInput(toRecordInput(draft, { phone: doc.phone, name: doc.name }));
    await saveState(ctx, chatId, { stage: check.ok ? "DONE" : "COLLECT", ...(check.ok ? { draft: {} } : {}) });
    await say(ctx, chatId, check.ok ? PREVIEW_SAVED(draft.kind) : `${Object.values(check.errors || {})[0] || t.unclear}\n${t.editHint}`, check.ok ? { buttons: [[{ text: t.newTx, callback_data: "vn:NEW" }]] } : {});
    return { ok: true, status: 200, saved: false, preview: true, valid: check.ok };
  }
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

// ------------------------------------------------------------------ «جرّب مدير مكتبك» (no Telegram needed)

const PREVIEW_CHAT = "1000000001";

/** Repeat where the conversation stands (the current question, the summary…) without changing anything. */
async function resumeVisitor(ctx, { officeId, chatId }) {
  const doc = await ctx.store.get(visitorPath(chatId));
  if (!doc || doc.officeId !== officeId || !["PERSONA", "KIND", "COLLECT", "PHONE", "CONFIRM"].includes(doc.stage)) return false;
  const lang = doc.lang === "en" ? "en" : "ar";
  const t = visitorText(lang);
  const draft = parseDraft(doc);
  if (doc.stage === "PERSONA") await say(ctx, chatId, t.pickPersona, { buttons: personaButtons(lang) });
  else if (doc.stage === "KIND") await say(ctx, chatId, t.brokerKind, { buttons: [[{ text: t.kinds.OFFER, callback_data: "vk:OFFER" }, { text: t.kinds.REQUEST, callback_data: "vk:REQUEST" }]] });
  else if (doc.stage === "PHONE") await say(ctx, chatId, t.phone, { keyboard: { keyboard: [[{ text: t.phoneButton, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
  else if (doc.stage === "CONFIRM") await say(ctx, chatId, t.summary(summaryLines(draft, lang), draft.kind), { buttons: [[{ text: t.save, callback_data: "vc:SAVE" }, { text: t.edit, callback_data: "vc:EDIT" }]] });
  else {
    const missing = nextMissing(draft);
    const known = summaryLines(draft, lang);
    await say(ctx, chatId, [known.length > 1 ? `${lang === "en" ? "So far" : "اللي عندي لحد الآن"}:\n${known.join("\n")}` : "", missing === "city" && draft.district && doc.suggestedCity ? t.confirmCity(draft.district, doc.suggestedCity) : missing ? questionFor(missing, draft, lang) : t.unclear].filter(Boolean).join("\n\n"));
  }
  return true;
}
const PREVIEW_SAVED = (kind) => `معاينة ✅ هنا يُسجَّل ${kind === "OFFER" ? "العرض" : "الطلب"} في مكتبك ويصل صاحبه رقمه المرجعي ومدة صلاحيته. (في التجربة لا يُحفظ شيء ولا يُرسل شيء.)`;
const PREVIEW_BLOCKED = new Set(["telegramBotChats", "telegramParties", "telegramPartyPending"]);

/** The office's own store, with the conversation kept per member and every link/inbox write switched off. */
function previewStore(store, officeId, uid) {
  const own = ["offices", officeId, "agentPreview", uid];
  const blocked = (seg) => PREVIEW_BLOCKED.has(seg[0]) || (seg[0] === "offices" && seg[2] === "inbox");
  const map = (seg) => (seg[0] === "telegramVisitors" ? own : seg);
  return {
    get: async (seg) => (blocked(seg) ? null : store.get(map(seg))),
    set: async (seg, obj) => (blocked(seg) ? undefined : store.set(map(seg), obj)),
    create: async (seg, obj) => (blocked(seg) ? false : store.create(map(seg), obj)),
    update: async (seg, fn, opts) => (blocked(seg) ? null : store.update(map(seg), fn, opts)),
    list: (seg, size) => store.list(seg, size)
  };
}

/**
 * The office's members talk to their own office manager exactly as an owner / broker / client would on
 * Telegram — same texts, buttons, questions and checks — without Telegram, without saving a record and
 * without linking anyone. Works on any environment (no bot or webhook needed).
 *   input: { action: "start" | "text" | "button" | "contact" | "reset", text, data, phone }
 */
export async function previewVisitor(ctx, { actor, officeId, input = {} }) {
  const replies = [];
  const pctx = {
    ...ctx, preview: true,
    store: previewStore(ctx.store, officeId, text(actor.uid, 128)),
    deps: {
      ...ctx.deps,
      telegram: async (method, payload = {}) => {
        if (method === "sendMessage") {
          const markup = payload.reply_markup || {};
          replies.push({
            text: String(payload.text || ""),
            buttons: (markup.inline_keyboard || []).map((row) => row.map((b) => ({ text: String(b.text || ""), data: String(b.callback_data || "") }))),
            askContact: Boolean(markup.keyboard?.flat?.().some((b) => b.request_contact))
          });
        }
        return { ok: true, messageId: replies.length };
      }
    }
  };
  if (!(await gatesOpen(pctx, officeId))) return { ok: true, off: true, replies: [{ text: "شغّل مدير المكتب الذكي أولًا من الإعدادات ← مدير المكتب الذكي.", buttons: [] }] };
  const action = String(input.action || "");
  const chat = { id: Number(PREVIEW_CHAT), type: "private" };
  const from = { id: Number(PREVIEW_CHAT), first_name: text(actor.name || "تجربة", 40), language_code: "ar" };
  const updateId = Date.now();
  if (action === "open") {
    // Opening the page again continues the same conversation (no new welcome, nothing lost).
    const resumed = await resumeVisitor(pctx, { officeId, chatId: PREVIEW_CHAT });
    if (!resumed) await startVisitor(pctx, { officeId, chat, from });
  } else if (action === "start" || action === "reset") {
    // A new try-out forgets the test number too (on Telegram a returning person keeps his own).
    await pctx.store.set(visitorPath(PREVIEW_CHAT), { phone: "" });
    await startVisitor(pctx, { officeId, chat, from });
  } else if (action === "button") {
    if (!isVisitorCallback(input.data)) throw ctx.deps.appError("preview_button_invalid", 400, "زر غير معروف");
    await handleVisitorCallback(pctx, { id: `p${updateId}`, from, data: String(input.data), message: { chat } });
  } else if (action === "contact") {
    await handleVisitorMessage(pctx, { update: { update_id: updateId }, message: { chat, from, contact: { phone_number: text(input.phone, 20), user_id: from.id } } });
  } else if (action === "text") {
    const body = text(input.text, 1500);
    if (!body) throw ctx.deps.appError("empty_message", 400, "اكتب رسالتك");
    const handled = await handleVisitorMessage(pctx, { update: { update_id: updateId }, message: { chat, from, text: body } });
    if (!handled) await startVisitor(pctx, { officeId, chat, from });
  } else {
    throw ctx.deps.appError("preview_action_invalid", 400, "إجراء غير معروف");
  }
  return { ok: true, replies };
}

export { PERSONA };
