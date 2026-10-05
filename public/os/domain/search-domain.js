/**
 * «البحث الشامل» — one search box over everything the office already has on this device:
 * العروض والطلبات، الصفقات الجارية، الصفقات المغلقة، مستندات المكتبة، ورسائل مركز التواصل.
 * Pure rules; the data is the office's own (already member-read by the rules).
 */

import { recordView } from "./records-domain.js";
import { closedDealModel, dealRoute, taskCardModel } from "./task-domain.js";
import { inboxItemView } from "./message-class-domain.js";

export const SEARCH_GROUPS = Object.freeze([
  { id: "records", label: "العروض والطلبات" },
  { id: "deals", label: "الصفقات الجارية" },
  { id: "closed", label: "الصفقات المغلقة" },
  { id: "documents", label: "المستندات" },
  { id: "messages", label: "الرسائل" }
]);

export const MIN_QUERY = 2;
const PER_GROUP = 20;

export function normalizeSearch(value) {
  return String(value ?? "").toLowerCase()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Every word of the query must appear somewhere in the item's text (any order). */
export function matchesQuery(haystack, query) {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  if (!words.length) return false;
  const text = normalizeSearch(haystack);
  const digits = String(haystack ?? "").replace(/\D/g, "");
  return words.every((word) => text.includes(word) || (/^\d{3,}$/.test(word) && digits.includes(word)));
}

/**
 * Returns { query, ready, total, groups: [{ id, label, items: [{ id, title, sub, tag, route }] }] }.
 * `visibleTask` lets the caller hide deals the signed-in broker may not see.
 */
export function searchOffice({ query = "", records = [], tasks = [], closed = [], documents = [], messages = [] } = {}) {
  const clean = String(query || "").trim();
  if (normalizeSearch(clean).length < MIN_QUERY) return { query: clean, ready: false, total: 0, groups: [] };
  const out = { records: [], deals: [], closed: [], documents: [], messages: [] };

  for (const record of records) {
    const view = recordView(record);
    if (view.state === "DELETED") continue;
    const text = [view.kindLabel, view.purposeLabel, view.title, view.location, view.propertyType, view.contactName, view.contactPhone, view.notes, view.reference, view.price || "", view.lifecycleLabel].join(" ");
    if (matchesQuery(text, clean)) out.records.push({ id: view.id, title: view.title || view.propertyType || "سجل", sub: [view.location, view.priceLabel, view.contactName].filter(Boolean).join(" · "), tag: `${view.kindLabel} · ${view.lifecycleLabel}`, route: `record/${view.id}` });
  }
  const seenDeal = new Set();
  for (const task of tasks) {
    const card = taskCardModel(task);
    const key = card.journeyId || card.matchId || card.id;
    if (seenDeal.has(key)) continue;
    if (matchesQuery([card.title, card.reason, card.lastEvent, card.badge].join(" "), clean)) {
      seenDeal.add(key);
      out.deals.push({ id: card.id, title: card.title || "صفقة", sub: card.reason || card.lastEvent, tag: card.badge, route: card.journeyId || card.matchId ? dealRoute(task) : `task/${card.id}` });
    }
  }
  for (const journey of closed) {
    const deal = closedDealModel(journey);
    const text = [deal.propertyType, deal.location, deal.statusLabel, deal.reason, deal.finalPrice || "", journey.offerSummary?.contactName, journey.requestSummary?.contactName].join(" ");
    if (matchesQuery(text, clean)) out.closed.push({ id: deal.id, title: [deal.propertyType, deal.location].filter(Boolean).join(" · "), sub: deal.reason, tag: deal.statusLabel, route: `journey/${deal.id}` });
  }
  for (const item of documents) {
    const text = [item.documentTitle, item.fileName, item.referenceNumber, item.categoryLabel, item.category].join(" ");
    if (matchesQuery(text, clean)) out.documents.push({ id: String(item.id || ""), title: String(item.documentTitle || item.fileName || "مستند"), sub: [item.referenceNumber, item.fileName].filter(Boolean).join(" · "), tag: "مكتبة المكتب", route: "library" });
  }
  for (const message of messages) {
    const view = inboxItemView(message);
    if (matchesQuery([view.text, view.sender, view.classLabel, view.channelLabel].join(" "), clean)) out.messages.push({ id: view.id, title: view.text.slice(0, 90) || "رسالة بلا نص", sub: `${view.sender} · ${view.channelLabel}`, tag: view.classLabel, route: view.recordId ? `record/${view.recordId}` : "inbox" });
  }
  const groups = SEARCH_GROUPS.map((group) => ({ ...group, count: out[group.id].length, items: out[group.id].slice(0, PER_GROUP) })).filter((group) => group.count);
  return { query: clean, ready: true, total: groups.reduce((sum, group) => sum + group.count, 0), groups };
}
