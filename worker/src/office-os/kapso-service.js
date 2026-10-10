/**
 * Kapso WhatsApp Sandbox → the office's central understanding (Staging only).
 *
 *   POST /integrations/kapso/webhook   (Kapso «whatsapp.message.received», payload v2, single or batched)
 *
 *   • Refused unless: this Worker is Staging, KAPSO_WEBHOOK_SECRET / KAPSO_OFFICE_ID / KAPSO_PHONE_NUMBER_ID are set,
 *     and X-Webhook-Signature = hex HMAC-SHA256(raw body, secret) (Kapso's documented scheme).
 *   • The office is the ONE configured office (KAPSO_OFFICE_ID) — never taken from the text or the sender.
 *     A message to another phone_number_id, or (when KAPSO_ALLOWED_SENDERS is set) from another sender, is ignored.
 *   • Each WhatsApp message id is processed once (create-only document), so Kapso's retries never duplicate a record.
 *   • The text goes through the shared «تعبئة ذكية» understanding; one conversation per sender collects what is
 *     missing (one question at a time); nothing is saved before the sender answers «نعم» to the summary.
 *   • Saving uses the office's normal save path (validation, duplicates, matching → Daily Tasks → negotiation room).
 *   • Replies go back only to the sender of the inbound message, through Kapso (KAPSO_API_KEY), only on Staging.
 *   • Logs carry counts and codes only — never a phone, a name or the message.
 */

import { analyzeListing, listingTitle, normalizeAnalysis, purposeFrom, splitDistrictInput } from "../../../public/os/domain/smart-fill-domain.js";
import { extractFacts, isSmallTalk, isYes } from "../../../public/os/domain/visitor-domain.js";
import { PROPERTY_TYPES } from "../../../public/os/domain/records-domain.js";
import { formatNumber } from "../../../public/os/domain/format-domain.js";
import { saveRecord } from "./records-service.js";

export const KAPSO_EVENT = "whatsapp.message.received";
const DEFAULT_API = "https://api.kapso.ai/meta/whatsapp/v24.0";
const CHAT_WINDOW_MS = 6 * 60 * 60 * 1000;
const PURPOSE_WORD = { SALE: "للبيع", RENT: "للإيجار", PURCHASE: "للشراء", LEASE_REQUEST: "للاستئجار" };

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const digits = (value) => String(value ?? "").replace(/\D/g, "");

export function kapsoConfig(env = {}) {
  const staging = String(env.DEPLOYMENT_ENV || "").toLowerCase() === "staging";
  const secret = text(env.KAPSO_WEBHOOK_SECRET, 500);
  const officeId = text(env.KAPSO_OFFICE_ID, 80).replace(/[^a-zA-Z0-9_-]/g, "");
  const phoneNumberId = digits(env.KAPSO_PHONE_NUMBER_ID).slice(0, 30);
  const allowed = String(env.KAPSO_ALLOWED_SENDERS || "").split(/[,\s]+/).map(digits).filter(Boolean);
  const reason = !staging ? "not_staging" : !secret ? "secret_missing" : !officeId ? "office_missing" : !phoneNumberId ? "phone_number_missing" : "";
  return { enabled: !reason, reason, secret, officeId, phoneNumberId, allowed, apiKey: text(env.KAPSO_API_KEY, 500), apiBase: text(env.KAPSO_API_BASE, 200) || DEFAULT_API };
}

function hex(buffer) { return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join(""); }

export async function kapsoSignature(raw, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, typeof raw === "string" ? new TextEncoder().encode(raw) : raw));
}

/** Timing-safe comparison of the received hex signature with the expected one. */
export async function verifyKapsoSignature(raw, header, secret) {
  const got = String(header || "").trim().toLowerCase().replace(/^sha256=/, "");
  if (!secret || !/^[0-9a-f]{64}$/.test(got)) return false;
  const want = await kapsoSignature(raw, secret);
  let diff = 0;
  for (let i = 0; i < want.length; i += 1) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

/** The inbound messages of one delivery (unbuffered payload, or the batch envelope's `data`). */
export function kapsoMessages(body = {}) {
  const items = body && body.batch === true && Array.isArray(body.data) ? body.data : [body];
  return items.slice(0, 100).map((item) => {
    const m = item?.message || {};
    const conv = item?.conversation || {};
    return {
      id: text(m.id, 200),
      type: text(m.type, 30),
      direction: text(m.kapso?.direction, 20),
      from: digits(m.from || conv.phone_number).slice(0, 20),
      body: typeof m.text?.body === "string" ? m.text.body : typeof m.kapso?.content === "string" && m.type === "text" ? m.kapso.content : "",
      name: text(conv.contact_name || m.username, 80),
      phoneNumberId: digits(item?.phone_number_id || conv.phone_number_id).slice(0, 30)
    };
  }).filter((m) => m.id);
}

export const saudiMobile = (from) => { const d = digits(from); return /^9665\d{8}$/.test(d) ? `0${d.slice(3)}` : /^05\d{8}$/.test(d) ? d : ""; };

const QUESTION = {
  kind: "عندك عقار تبي تعرضه، ولا تدور على عقار؟",
  purpose: { OFFER: "العقار للبيع ولا للإيجار؟", REQUEST: "تبي شراء ولا استئجار؟", "": "بيع/شراء ولا إيجار/استئجار؟" },
  propertyType: "وش نوع العقار؟ (شقة، فيلا، أرض، عمارة…)",
  district: "في أي حي؟ (تقدر تكتب أكثر من حي)",
  price: { OFFER: "كم السعر المطلوب؟", REQUEST: "كم الميزانية؟", "": "كم السعر أو الميزانية؟" }
};

export function nextQuestion(listing, officeCity = "") {
  const first = listing.missing[0];
  if (!first) return { key: "", text: "" };
  if (first === "city") return { key: "city", text: officeCity ? `العقار في ${officeCity}؟ اكتب «نعم» أو اسم المدينة.` : "في أي مدينة؟", suggested: officeCity };
  const q = QUESTION[first];
  return { key: first, text: typeof q === "string" ? q : q[listing.kind] || q[""] };
}

export function summaryText(listing, officeName) {
  const price = listing.price ? `${listing.kind === "REQUEST" ? "الميزانية" : "السعر"}: ${formatNumber(listing.price)} ريال` : "";
  return [
    `هذا ملخص ${listing.kind === "REQUEST" ? "طلبك" : "عرضك"} لدى ${officeName}:`,
    `• ${listingTitle(listing)}${listing.city ? `، ${listing.city}` : ""}`,
    price ? `• ${price}` : "",
    listing.area ? `• المساحة: ${formatNumber(listing.area)} م²` : "",
    listing.rooms ? `• الغرف: ${listing.rooms}` : "",
    listing.features.length ? `• ${listing.features.join("، ")}` : "",
    listing.urgent === true ? "• مستعجل" : listing.urgent === false ? "• غير مستعجل" : "",
    "اكتب «نعم» للتسجيل، أو صحّح أي معلومة."
  ].filter(Boolean).join("\n");
}

async function reply(ctx, cfg, to, body) {
  if (!cfg.apiKey) return { sent: false, reason: "api_key_missing" };
  try {
    const response = await fetch(`${cfg.apiBase}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": cfg.apiKey },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: String(body).slice(0, 4000) } }),
      signal: AbortSignal.timeout(8000)
    });
    return { sent: response.ok, reason: response.ok ? "" : `http_${response.status}` };
  } catch (error) {
    return { sent: false, reason: "network" };
  }
}

/**
 * The conversation so far → one listing. Each message is read on its own and a later value replaces an earlier one
 * (a correction wins); a short answer is read for the field that was just asked («الهجرة» → the district).
 */
export function foldListing(messages = [], { city = "" } = {}) {
  const m = { kind: "", purpose: "", propertyType: "", city: "", districts: [], area: 0, price: 0, rooms: 0, features: [], urgent: null, phone: "", notes: "", original: messages.map((x) => x.t).join("\n") };
  for (const { t, a } of messages) {
    const l = analyzeListing(t);
    const short = a ? extractFacts(t, { expectNumber: a }) : {};
    if (a === "district" && !l.districts.length && short.district) l.districts = [short.district];
    if (a === "city" && !l.city && short.city) l.city = short.city;
    if (a === "propertyType" && !l.propertyType && PROPERTY_TYPES.includes(short.propertyType)) l.propertyType = short.propertyType;
    if (a === "price" && !l.price && short.price) l.price = short.price;
    for (const k of ["kind", "purpose", "propertyType", "city", "notes"]) if (l[k]) m[k] = l[k];
    for (const k of ["area", "price", "rooms"]) if (l[k]) m[k] = l[k];
    if (l.districts.length) m.districts = l.districts;
    if (l.urgent !== null) m.urgent = l.urgent;
    m.features = [...new Set([...m.features, ...l.features])];
  }
  for (const { t } of messages) { const p = purposeFrom(t, m.kind); if (p) m.purpose = p; }
  if (city && !m.city) m.city = city;
  return normalizeAnalysis({ ok: true, listings: [m] }).listings[0];
}

/** One inbound text message → the office's conversation, and at the end the office's normal save path. */
export async function handleKapsoMessage(ctx, cfg, message) {
  const officeId = cfg.officeId;
  const sha = (v) => ctx.deps.sha256Hex(v);
  // Once per WhatsApp message id (Kapso retries the same delivery up to 3 times).
  const fresh = await ctx.store.create(["offices", officeId, "kapsoInbound", `in_${(await sha(message.id)).slice(0, 40)}`], {
    officeId, channel: "KAPSO_SANDBOX", type: message.type, receivedAt: ctx.now().toISOString(), isTestFixture: true
  });
  if (fresh === false) return { status: "duplicate" };
  if (message.type !== "text" || !message.body.trim()) {
    await reply(ctx, cfg, message.from, "أرسل تفاصيل العقار نصًا من فضلك (النوع، الحي، السعر أو الميزانية).");
    return { status: "unsupported_type" };
  }
  const office = (await ctx.store.get(["offices", officeId])) || {};
  const officeName = text(office.officeName, 80) || "المكتب";
  const officeCity = text(office.city, 60);
  const chatRef = ["offices", officeId, "kapsoChats", `wa_${(await sha(message.from)).slice(0, 40)}`];
  const now = ctx.now();
  let chat = (await ctx.store.get(chatRef)) || {};
  if (!chat.updatedAt || now - new Date(chat.updatedAt) > CHAT_WINDOW_MS || chat.stage === "SAVED") chat = {};
  const body = message.body.slice(0, 1500);

  // Confirmation: only an explicit «نعم» saves (silence is never consent).
  if (chat.stage === "CONFIRM" && isYes(body)) {
    const listing = foldListing(chat.messages || [], { city: chat.city });
    const phone = saudiMobile(message.from);
    if (!phone) {
      await reply(ctx, cfg, message.from, "نعتذر، التسجيل عبر واتساب متاح حاليًا للأرقام السعودية فقط. تواصل مع المكتب مباشرة.");
      return { status: "non_saudi_sender" };
    }
    const { district, others } = splitDistrictInput(listing.districts.join("، "));
    const assignment = await ctx.store.get(["offices", officeId, "officeSettings", "assignment"]).catch(() => null);
    const actor = { uid: text(assignment?.defaultBrokerId || office.ownerUid, 128) || "office-agent", role: "broker", isManager: false };
    const input = {
      kind: listing.kind, purpose: listing.purpose, propertyType: listing.propertyType, city: listing.city, district,
      price: listing.price, area: listing.area || "", rooms: listing.rooms || "",
      contactName: message.name || (listing.kind === "REQUEST" ? "عميل واتساب" : "مالك واتساب"), contactPhone: phone,
      notes: [listing.features.join("، "), others.length ? `أحياء مقبولة أيضًا: ${others.join("، ")}` : "", listing.notes].filter(Boolean).join(" — ").slice(0, 1000),
      validity: listing.urgent === true ? { urgent: true, duration: "" } : undefined,
      intakeOrigin: { channel: "WHATSAPP", role: listing.kind === "REQUEST" ? "CLIENT" : "OWNER", method: "SMART_FILL", text: listing.original }
    };
    let saved;
    try {
      saved = await saveRecord(ctx, { actor, officeId, input, requestKey: `kapso-${chat.firstMessageId || message.id}` });
    } catch (error) {
      await reply(ctx, cfg, message.from, `${error?.publicMessage || "تعذر التسجيل"} — صحّح المعلومة وأرسلها.`);
      await ctx.store.set(chatRef, { ...chat, stage: "COLLECT", updatedAt: now.toISOString() });
      return { status: "invalid", code: error?.code || "" };
    }
    await ctx.store.set(chatRef, { ...chat, stage: "SAVED", recordId: saved.recordId, updatedAt: now.toISOString() });
    // The sender never sees matches or the other side: the office reviews them first.
    await reply(ctx, cfg, message.from, saved.duplicate
      ? `${listing.kind === "REQUEST" ? "طلبك" : "عرضك"} مسجل لدينا مسبقًا في ${officeName}. سيتواصل معك الوسيط عند وجود جديد.`
      : `تم تسجيل ${listing.kind === "REQUEST" ? "طلبك" : "عرضك"} في ${officeName} ✅\nسيتواصل معك الوسيط عند وجود ${listing.kind === "REQUEST" ? "عقار مناسب" : "عميل مناسب"}.`);
    return { status: saved.duplicate ? "duplicate_record" : "saved", recordId: saved.recordId, matches: Number(saved.matches || 0), matchingPending: saved.matchingPending === true };
  }

  // The city suggestion «العقار في المدينة المنورة؟» answered with «نعم».
  if (chat.asked === "city" && chat.suggestedCity && isYes(body)) chat.city = chat.suggestedCity;
  else chat.messages = [...(chat.messages || []), { t: body, a: chat.asked || "" }].slice(-12);
  const listing = foldListing(chat.messages || [], { city: chat.city });

  if (!chat.firstMessageId && !listing.understood) {
    // Greeting or anything that is not about a property: no record, a short pointer to what the office needs.
    const greeting = isSmallTalk(body) ? "وعليكم السلام ورحمة الله 🌷\n" : "";
    await reply(ctx, cfg, message.from, `${greeting}معك مدير ${officeName} الذكي (مساعد آلي). أرسل عرضك أو طلبك العقاري: نوع العقار، الحي، والسعر أو الميزانية.`);
    await ctx.store.set(chatRef, { stage: "", messages: [], updatedAt: now.toISOString(), isTestFixture: true });
    return { status: "social" };
  }
  const ask = nextQuestion(listing, officeCity);
  const base = { ...chat, firstMessageId: chat.firstMessageId || message.id, updatedAt: now.toISOString(), isTestFixture: true };
  if (ask.key) {
    await ctx.store.set(chatRef, { ...base, stage: "COLLECT", asked: ask.key, suggestedCity: ask.suggested || "" });
    await reply(ctx, cfg, message.from, ask.text);
    return { status: "asked", missing: ask.key };
  }
  await ctx.store.set(chatRef, { ...base, stage: "CONFIRM", asked: "" });
  await reply(ctx, cfg, message.from, summaryText(listing, officeName));
  return { status: "confirm" };
}

/** The whole delivery. Always answers quickly with a code (Kapso expects 200 within 10 s). */
export async function handleKapsoWebhook({ raw, headers, env, makeCtx }) {
  const cfg = kapsoConfig(env);
  if (!cfg.enabled) return { status: 503, body: { ok: false, error: "kapso_not_configured", reason: cfg.reason } };
  if (!(await verifyKapsoSignature(raw, headers.get("x-webhook-signature"), cfg.secret))) return { status: 401, body: { ok: false, error: "bad_signature" } };
  const event = text(headers.get("x-webhook-event"), 80);
  let body = {};
  try { body = JSON.parse(raw); } catch (_) { return { status: 400, body: { ok: false, error: "bad_json" } }; }
  const kind = event || text(body?.type, 80);
  if (kind && kind !== KAPSO_EVENT) return { status: 200, body: { ok: true, ignored: "event", event: kind } };
  const ctx = await makeCtx(cfg.officeId);
  const results = [];
  for (const message of kapsoMessages(body)) {
    if (message.phoneNumberId !== cfg.phoneNumberId) { results.push({ status: "other_number" }); continue; }
    if (message.direction && message.direction !== "inbound") { results.push({ status: "not_inbound" }); continue; }
    if (cfg.allowed.length && !cfg.allowed.includes(message.from)) { results.push({ status: "sender_not_allowed" }); continue; }
    try {
      results.push(await handleKapsoMessage(ctx, cfg, message));
    } catch (error) {
      console.error("[kapso] message failed", error?.code || error?.message);
      results.push({ status: "failed" });
    }
  }
  console.log("[kapso] delivery", JSON.stringify({ count: results.length, statuses: results.map((r) => r.status) }));
  return { status: 200, body: { ok: true, results } };
}
