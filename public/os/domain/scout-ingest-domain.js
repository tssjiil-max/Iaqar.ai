/**
 * «صفحة الاستقبال» — what an assistant (Claude in the browser) pastes → one batch for /os/scout/ingest.
 * Pure functions (the page and the tests use them). Nothing here talks to the network.
 *
 * Accepted pastes:
 *   • the batch itself: { batchId?, search?, items: [...] }
 *   • a JSON list of items: [{ url, title, text, ... }, ...]
 *   • plain text: one ad per paragraph (a blank line between ads); a https link inside an ad is kept as its source.
 */

export const INBOX_LIMITS = Object.freeze({ itemsPerBatch: 20, chars: 100_000 });

const URL_RE = /https:\/\/[^\s<>"')]+/;
const ITEM_KEYS = ["url", "title", "text", "description", "kind", "tx", "propertyType", "city", "district", "plan", "price", "area", "rooms", "publishedAt", "adId", "id", "sourceName"];

function pickItem(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const key of ITEM_KEYS) if (raw[key] !== undefined && raw[key] !== null && raw[key] !== "") out[key] = typeof raw[key] === "number" ? raw[key] : String(raw[key]).slice(0, 2000);
  return Object.keys(out).length ? out : null;
}

/** A short, stable id for a paste, so pressing «إرسال» twice (or a retry) is the same batch. */
export function batchIdFor(items = [], search = {}) {
  const source = JSON.stringify([items, search]);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < source.length; i += 1) {
    const c = source.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `inbox-${a.toString(36)}${b.toString(36)}-${items.length}`;
}

/**
 * The paste → { ok, items, search, batchId, error }. Lists longer than one batch are split by the page
 * (chunks of INBOX_LIMITS.itemsPerBatch), each chunk with its own id.
 */
export function parseInboxPaste(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return { ok: false, error: "الصق النتائج أولًا" };
  if (text.length > INBOX_LIMITS.chars) return { ok: false, error: `النص طويل — الحد ${INBOX_LIMITS.chars} حرف` };
  let items = [];
  let search = {};
  let batchId = "";
  if (/^[[{]/.test(text)) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { return { ok: false, error: "صيغة JSON غير صحيحة — تحقق من النص أو الصق الإعلانات كنص عادي" }; }
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed?.results) ? parsed.results : null;
    if (!list) return { ok: false, error: "لم أجد قائمة إعلانات (items) في النص" };
    items = list.map(pickItem).filter(Boolean);
    if (!Array.isArray(parsed) && parsed.search && typeof parsed.search === "object") search = parsed.search;
    if (!Array.isArray(parsed) && typeof parsed.batchId === "string") batchId = parsed.batchId.slice(0, 120);
  } else {
    items = text.split(/\n\s*\n+/).map((block) => block.trim()).filter((block) => block.replace(/\s+/g, "").length >= 20).map((block) => {
      const url = block.match(URL_RE)?.[0]?.replace(/[.,،]+$/, "") || "";
      return { ...(url ? { url } : {}), text: block.replace(URL_RE, " ").replace(/[ \t]+/g, " ").trim().slice(0, 2000) };
    });
  }
  if (!items.length) return { ok: false, error: "لم أجد إعلانات في النص" };
  return { ok: true, items, search, batchId: batchId || batchIdFor(items, search) };
}

/** A long list → batches the Worker accepts (each with its own stable id). */
export function chunkBatches(parsed) {
  if (!parsed?.ok) return [];
  const out = [];
  for (let i = 0; i < parsed.items.length; i += INBOX_LIMITS.itemsPerBatch) {
    const items = parsed.items.slice(i, i + INBOX_LIMITS.itemsPerBatch);
    out.push({ batchId: parsed.items.length > INBOX_LIMITS.itemsPerBatch ? `${parsed.batchId}-p${i / INBOX_LIMITS.itemsPerBatch + 1}` : parsed.batchId, search: parsed.search, items });
  }
  return out;
}

export const TOKEN_SHAPE = /^iqk\.[A-Za-z0-9_-]{2,80}\.[a-z0-9]{8,24}\.[A-Za-z0-9_-]{32,64}$/;

// ------------------------------------------------------------------ automatic sending (Claude in Chrome, no hand on the page)
//
// What Claude in Chrome is documented to do: open pages, read them, click, type, fill forms, run saved shortcuts on a
// schedule (while Chrome is open). Not documented: sending HTTP requests of its own. So the automatic path uses only
// opening a page: at the end of its search Claude opens
//     <app>/scout-inbox.html#c=<run code>&ingest=<the batch JSON>
// and the page sends it by itself with the key paired to THIS browser (kept in this browser only, never shown, never
// in a conversation). The run code (in the shortcut's text, not a secret key) stops another site from opening the
// page with results of its own. The page writes its answer in [data-inbox-result] for Claude to read back.

export const RUN_CODE_SHAPE = /^[a-z0-9]{8,16}$/;

export function newRunCode(random = () => Math.random()) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i += 1) out += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  return out;
}

/** «#c=…&ingest=…» → { auto, code, raw }. `ingest` is always last: everything after it is the batch (it may contain «&»). */
export function parseAutoFragment(hash = "") {
  const body = String(hash || "").replace(/^#/, "");
  const at = body.indexOf("ingest=");
  if (at < 0) return { auto: false, code: "", raw: "" };
  const head = new URLSearchParams(body.slice(0, at).replace(/&$/, ""));
  let raw = body.slice(at + "ingest=".length);
  try { raw = decodeURIComponent(raw); } catch (_) { /* typed unencoded: taken as it is */ }
  return { auto: true, code: String(head.get("c") || "").trim().toLowerCase(), raw: raw.slice(0, INBOX_LIMITS.chars) };
}

const TX_AR = { sale: "للبيع", rent: "للإيجار" };
export const RESTRICTED_SOURCES_AR = "عقار (aqar.fm) وحراج وبيوت ووصلت";

/**
 * The shortcut text the manager saves in Claude in Chrome (and schedules there): what to look for — read from the
 * office's scout settings (types, sale/rent, city, districts, plans) — where not to look, the exact result shape,
 * and the page to open at the end. It carries the run code, never the key.
 */
export function shortcutPrompt({ inboxUrl, code, settings = {} }) {
  const types = (settings.propertyTypes || []).length ? settings.propertyTypes.join(" أو ") : "أي نوع عقار";
  const tx = (settings.purposes || []).map((p) => TX_AR[p]).filter(Boolean).join(" أو ") || "للبيع أو للإيجار";
  const place = [settings.city || "", (settings.districts || []).length ? `الأحياء: ${settings.districts.join("، ")}` : "", (settings.plans || []).length ? `المخططات: ${settings.plans.join("، ")}` : ""].filter(Boolean).join(" — ");
  return [
    `ابحث عن إعلانات عقارية جديدة: ${types} ${tx}${place ? ` في ${place}` : ""}، عروضًا وطلبات.`,
    `لا تستخدم ${RESTRICTED_SOURCES_AR}: شروطها تمنع جمع إعلاناتها آليًا، وستُرفض. استخدم فقط مصادر تسمح بذلك.`,
    "لا تخترع أي معلومة: اترك الحقل فارغًا إذا لم يذكره الإعلان. حتى 20 إعلانًا.",
    "عند الانتهاء كوّن JSON بهذا الشكل بالضبط:",
    `{"batchId":"<التاريخ والوقت>","search":{"tx":"","propertyTypes":[],"city":"","districts":[],"plans":[]},"items":[{"url":"https://…","title":"","text":"","kind":"OFFER أو REQUEST","tx":"sale أو rent","propertyType":"","city":"","district":"","plan":"","price":0,"area":0,"rooms":0,"publishedAt":""}]}`,
    `ثم افتح هذا الرابط في تبويب جديد بعد أن تضع الـ JSON مكان <JSON>:`,
    `${inboxUrl}#c=${code}&ingest=<JSON>`,
    "انتظر حتى تظهر نتيجة الاستقبال في الصفحة (المربع «نتيجة الاستقبال») ثم أخبرني بعدد ما حُفظ وما تكرر وما رُفض وسببه."
  ].join("\n");
}

/** Where this browser keeps its pairing (same origin as the office app and the inbox page). */
export const PAIR_STORE_KEY = "iaqar.scoutInbox.pair";

export function readPairing(storage) {
  try {
    const raw = JSON.parse(storage?.getItem(PAIR_STORE_KEY) || "null");
    if (raw && TOKEN_SHAPE.test(String(raw.token || "")) && RUN_CODE_SHAPE.test(String(raw.code || ""))) return { token: raw.token, code: raw.code, officeId: String(raw.officeId || ""), keyId: String(raw.keyId || ""), pairedAt: String(raw.pairedAt || "") };
  } catch (_) { /* nothing paired, or storage blocked */ }
  return null;
}

export function writePairing(storage, pairing) {
  try { storage?.setItem(PAIR_STORE_KEY, JSON.stringify(pairing)); return true; } catch (_) { return false; }
}

export function clearPairing(storage) {
  try { storage?.removeItem(PAIR_STORE_KEY); } catch (_) { /* storage blocked */ }
}
