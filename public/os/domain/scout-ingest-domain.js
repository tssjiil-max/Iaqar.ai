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
