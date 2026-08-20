/**
 * Unified listing site adapters for URL import (aqar, haraj, deal, generic).
 * Pure parsing + registry — fetch orchestration lives in canonical-listing-intake.mjs.
 */

export const LISTING_EXTRACTION_STATUS = Object.freeze({
  EXTRACTED: "extracted",
  FALLBACK_REQUIRED: "fallback_required",
  NEEDS_REVIEW: "needs_review"
});

export const LISTING_FETCH_LIMITS = Object.freeze({
  MAX_BYTES: 2 * 1024 * 1024,
  TIMEOUT_MS: 15000,
  MAX_REDIRECTS: 4
});

const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const REQUEST_PHRASE_RE = /(?:^|\s)(?:مطلوب|أبحث\s+عن|ابحث\s+عن|أرغب\s+في\s+(?:شراء|استئجار|الشراء|الاستئجار))(?:\s|$)/i;

const PROPERTY_TYPE_MAP = Object.freeze({
  villa: "فيلا",
  apartment: "شقة",
  flat: "شقة",
  land: "أرض",
  floor: "دور",
  building: "عمارة",
  shop: "محل",
  office: "مكتب",
  warehouse: "مستودع",
  resthouse: "استراحة",
  house: "منزل"
});

function cleanText(value, max = 12000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
}

function hostFromUrl(url = "") {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function field(value, source, confidence = 0.9) {
  const has = value !== null && value !== undefined && String(value).trim() !== "";
  return { value: has ? value : null, source, confidence: has ? confidence : 0 };
}

function parseNumberToken(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[،,\s\u066C]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function isBlockedListingPageText(text = "") {
  const sample = cleanText(text, 4000);
  if (/You have been blocked|تم حظرك|لا يمكنك الوصول للموقع|حمايتها من الهجمات|cf-browser-verification/i.test(sample)) {
    return true;
  }
  if (/حراج|haraj/i.test(sample)
    && /دخــــول|تسجيل حساب|اتفاقية الاستخدام|سياسة الخصوصية/i.test(sample)
    && !/(?:للبيع|للإيجار|السعر|المساحة|حي\s+\S+)/i.test(sample)) {
    return true;
  }
  return false;
}

export function normalizeListingFetchUrl(raw, isPrivateOrLocalHost) {
  const text = cleanText(raw, 2000);
  if (!text) return "";
  if (/^file:/i.test(text)) return "";
  try {
    const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (isPrivateOrLocalHost(parsed.hostname)) return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function extractNextDataJson(html = "") {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function collectJsonLdNodes(parsed) {
  if (!parsed || typeof parsed !== "object") return [];
  if (Array.isArray(parsed)) return parsed.flatMap((item) => collectJsonLdNodes(item));
  if (Array.isArray(parsed["@graph"])) return parsed["@graph"].flatMap((item) => collectJsonLdNodes(item));
  return [parsed];
}

function extractJsonLdFromHtml(html = "") {
  const chunks = [];
  const nodes = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    try {
      nodes.push(...collectJsonLdNodes(JSON.parse(match[1].trim())));
    } catch {
      /* ignore */
    }
  }
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    for (const key of ["name", "headline", "description", "articleBody"]) {
      const value = cleanText(node[key], 12000);
      if (value) chunks.push(value);
    }
    const offers = node.offers;
    const offerList = Array.isArray(offers) ? offers : (offers ? [offers] : []);
    for (const offer of offerList) {
      if (!offer || typeof offer !== "object") continue;
      const price = offer.price ?? offer.lowPrice ?? offer.highPrice;
      if (price != null) chunks.push(String(price));
    }
    const address = node.address;
    if (typeof address === "string") chunks.push(cleanText(address));
    else if (address && typeof address === "object") {
      for (const key of ["streetAddress", "addressLocality", "addressRegion"]) {
        const value = cleanText(address[key]);
        if (value) chunks.push(value);
      }
    }
  }
  return { text: chunks.join("\n").trim(), nodes };
}

function extractMetaFromHtml(html = "") {
  const chunks = [];
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, " ")) : "";
  if (title) chunks.push(title);
  for (const re of [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/gi
  ]) {
    let m;
    while ((m = re.exec(html))) chunks.push(decodeHtmlEntities(m[1]));
  }
  return { title: cleanText(title), text: cleanText(chunks.join("\n")) };
}

function extractBodyTextFromHtml(html = "") {
  let source = String(html || "");
  source = source.replace(/<script[\s\S]*?<\/script>/gi, " ");
  source = source.replace(/<style[\s\S]*?<\/style>/gi, " ");
  source = source.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  return cleanText(decodeHtmlEntities(source.replace(/<[^>]+>/g, " ")));
}

export function extractListingTextFromHtml(html = "") {
  const jsonLd = extractJsonLdFromHtml(html);
  const meta = extractMetaFromHtml(html);
  const body = extractBodyTextFromHtml(html);
  const combined = [jsonLd.text, meta.text, body].filter(Boolean).join("\n");
  return cleanText(combined.replace(/\s+/g, " "), 12000);
}

function deepFindListingObject(root, depth = 0) {
  if (!root || typeof root !== "object" || depth > 8) return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const found = deepFindListingObject(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const keys = Object.keys(root);
  const hasListingShape = (
    ("title" in root || "name" in root || "headline" in root)
    && ("purpose" in root || "category" in root || "propertyType" in root || "type" in root)
  );
  if (hasListingShape) return root;
  for (const key of keys) {
    if (key === "listing" || key === "ad" || key === "property" || key === "item") {
      const found = deepFindListingObject(root[key], depth + 1);
      if (found) return found;
    }
  }
  for (const key of keys) {
    const found = deepFindListingObject(root[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function mapTransactionTypeFromSignals({ title = "", description = "", purpose = "", priceType = "" } = {}) {
  const hay = cleanText([title, description, purpose, priceType].join(" "));
  const hasSale = /(?:^|\s)للبيع(?:\s|$)|\bsale\b/i.test(hay);
  const hasRent = /(?:^|\s)للإيجار|للايجار(?:\s|$)|\brent\b/i.test(hay);
  if (hasSale && hasRent) return { value: null, conflict: true };
  if (hasSale) return { value: "sale", conflict: false };
  if (hasRent) return { value: "rent", conflict: false };
  return { value: null, conflict: false };
}

function mapOpportunityKindFromText(text = "") {
  if (REQUEST_PHRASE_RE.test(text)) return "buyer_request";
  return "owner_offer";
}

function mapPropertyTypeLabel(raw = "") {
  const text = cleanText(raw);
  if (!text) return "";
  const lower = text.toLowerCase();
  for (const [key, label] of Object.entries(PROPERTY_TYPE_MAP)) {
    if (lower === key || text.includes(label)) return label;
  }
  if (/فيلا|فيله/i.test(text)) return "فيلا";
  if (/شقة|شقه/i.test(text)) return "شقة";
  if (/أرض|ارض/i.test(text)) return "أرض";
  if (/(?:^|\s)دور(?:\s|$)/i.test(text) && !/دورات\s+مياه/i.test(text)) return "دور";
  return text;
}

function buildStructuredFromListingNode(node = {}, sources = {}) {
  const title = cleanText(node.title || node.name || node.headline || "");
  const description = cleanText(node.description || node.content || node.body || "");
  const category = node.category && typeof node.category === "object"
    ? cleanText(node.category.name || node.category.label || node.category.ar || "")
    : cleanText(node.category || node.propertyType || node.type || "");
  const purposeRaw = cleanText(node.purpose || node.listingPurpose || node.adType || node.offerType || "");
  const transaction = mapTransactionTypeFromSignals({
    title,
    description,
    purpose: purposeRaw,
    priceType: node.priceType || node.rentPeriod || ""
  });
  const city = node.city && typeof node.city === "object"
    ? cleanText(node.city.name || node.city.label || node.city.ar || "")
    : cleanText(node.city || node.addressCity || "");
  const district = node.district && typeof node.district === "object"
    ? cleanText(node.district.name || node.district.label || "")
    : cleanText(node.district || node.neighborhood || node.addressDistrict || "");
  const area = parseNumberToken(node.area ?? node.size ?? node.landArea ?? node.space);
  const rooms = parseNumberToken(node.rooms ?? node.bedrooms ?? node.roomCount);
  const bathrooms = parseNumberToken(node.bathrooms ?? node.bathroomCount);
  const livingRooms = parseNumberToken(node.livingRooms ?? node.livingRoomCount ?? node.halls);
  const streetWidth = parseNumberToken(node.streetWidth ?? node.street_width);
  const facade = cleanText(node.facade || node.direction || node.frontage || "");
  const propertyAge = cleanText(node.age || node.propertyAge || node.buildingAge || "");
  const usage = cleanText(node.usage || node.useType || node.propertyUsage || "");
  const price = parseNumberToken(
    node.price ?? node.salePrice ?? node.askingPrice ?? node.rentPrice ?? node.annualRent
  );
  const kindText = `${title}\n${description}`;
  const opportunityKind = mapOpportunityKindFromText(kindText);
  const structured = {
    transactionType: field(transaction.value, sources.transactionType || "structured", transaction.value ? 0.98 : 0),
    opportunityKind: field(opportunityKind, sources.opportunityKind || "structured", 0.95),
    propertyType: field(mapPropertyTypeLabel(category || title), sources.propertyType || "structured", 0.97),
    city: field(city, sources.city || "structured", city ? 0.95 : 0),
    district: field(district, sources.district || "structured", district ? 0.9 : 0),
    area: field(area, sources.area || "structured", area ? 0.94 : 0),
    rooms: field(rooms, sources.rooms || "structured", rooms ? 0.92 : 0),
    bathrooms: field(bathrooms, sources.bathrooms || "structured", bathrooms ? 0.9 : 0),
    livingRooms: field(livingRooms, sources.livingRooms || "structured", livingRooms ? 0.88 : 0),
    streetWidth: field(streetWidth, sources.streetWidth || "structured", streetWidth ? 0.88 : 0),
    facade: field(facade, sources.facade || "structured", facade ? 0.88 : 0),
    propertyAge: field(propertyAge, sources.propertyAge || "structured", propertyAge ? 0.85 : 0),
    usage: field(usage, sources.usage || "structured", usage ? 0.8 : 0),
    salePrice: field(transaction.value === "sale" ? price : null, sources.salePrice || "structured", price ? 0.9 : 0),
    annualRent: field(transaction.value === "rent" ? price : null, sources.annualRent || "structured", price ? 0.9 : 0)
  };
  return { structured, title, description, transactionConflict: transaction.conflict };
}

function structuredToBrokerFields(structured = {}) {
  const tx = structured.transactionType?.value;
  const kind = structured.opportunityKind?.value;
  let purpose = "";
  let opportunityKind = "";
  if (kind === "buyer_request") {
    opportunityKind = "REQUEST";
    if (tx === "sale") purpose = "PURCHASE";
    else if (tx === "rent") purpose = "LEASE_REQUEST";
  } else if (kind === "owner_offer") {
    opportunityKind = "OFFER";
    if (tx === "sale") purpose = "SALE";
    else if (tx === "rent") purpose = "RENT";
  }
  const priceOrBudget = tx === "sale"
    ? structured.salePrice?.value
    : tx === "rent"
      ? structured.annualRent?.value
      : null;
  return {
    opportunityKind,
    purpose,
    propertyType: structured.propertyType?.value || "",
    city: structured.city?.value || "",
    district: structured.district?.value || "",
    area: structured.area?.value ?? null,
    rooms: structured.rooms?.value ?? null,
    bathrooms: structured.bathrooms?.value ?? null,
    priceOrBudget,
    salePrice: structured.salePrice?.value ?? null,
    annualRent: structured.annualRent?.value ?? null,
    livingRoom: structured.livingRooms?.value ?? null
  };
}

function fieldSourcesFromStructured(structured = {}) {
  const out = {};
  for (const [key, entry] of Object.entries(structured)) {
    if (entry?.source) out[key] = entry.source;
  }
  return out;
}

function createAdapter({ id, matchHost, extractId, parseHtml }) {
  return { id, matchHost, extractId, parseHtml };
}

function parseAqarHtml(html, url) {
  const meta = extractMetaFromHtml(html);
  const nextData = extractNextDataJson(html);
  const listingNode = nextData ? deepFindListingObject(nextData) : null;
  let structured = null;
  let fieldSources = {};
  let externalListingId = "";
  const idMatch = String(url).match(/\/(?:r|ad)\/([a-f0-9]+)/i);
  if (idMatch) externalListingId = idMatch[1];

  if (listingNode) {
    const parsed = buildStructuredFromListingNode(listingNode, {
      transactionType: "aqar_next_data",
      propertyType: "aqar_next_data",
      city: "aqar_next_data"
    });
    structured = parsed.structured;
    fieldSources = fieldSourcesFromStructured(structured);
    if (parsed.transactionConflict) {
      return {
        sourceSite: "aqar",
        externalListingId,
        rawText: extractListingTextFromHtml(html),
        listingTitle: parsed.title || meta.title,
        structured,
        brokerFields: structuredToBrokerFields(structured),
        fieldSources,
        extractionStatus: LISTING_EXTRACTION_STATUS.NEEDS_REVIEW,
        classificationStatus: "needs_review"
      };
    }
  }

  const jsonLd = extractJsonLdFromHtml(html);
  const rawText = extractListingTextFromHtml(html);
  const title = meta.title || "";
  if (!structured && (title || jsonLd.text)) {
    const parsed = buildStructuredFromListingNode({
      title,
      description: jsonLd.text,
      category: title,
      city: title.includes("المدينة المنورة") ? "المدينة المنورة" : ""
    }, { transactionType: "aqar_meta", propertyType: "aqar_meta" });
    structured = parsed.structured;
    fieldSources = fieldSourcesFromStructured(structured);
  }

  const brokerFields = structured ? structuredToBrokerFields(structured) : null;
  const hasCore = brokerFields?.purpose && brokerFields?.propertyType && brokerFields?.opportunityKind === "OFFER";
  return {
    sourceSite: "aqar",
    externalListingId,
    rawText,
    listingTitle: title,
    structured,
    brokerFields,
    fieldSources,
    extractionStatus: hasCore ? LISTING_EXTRACTION_STATUS.EXTRACTED : LISTING_EXTRACTION_STATUS.FALLBACK_REQUIRED,
    classificationStatus: hasCore ? "confirmed" : "fallback_required"
  };
}

function parseHarajHtml(html, url) {
  const meta = extractMetaFromHtml(html);
  const rawText = extractListingTextFromHtml(html);
  const externalListingId = (String(url).match(/\/(\d{6,})/) || [])[1] || "";
  const parsed = buildStructuredFromListingNode({
    title: meta.title,
    description: rawText,
    category: meta.title
  }, { transactionType: "haraj_meta", propertyType: "haraj_meta" });
  const structured = parsed.structured;
  const brokerFields = structuredToBrokerFields(structured);
  const blocked = isBlockedListingPageText(rawText);
  const hasSignal = Boolean(brokerFields.purpose || brokerFields.propertyType);
  return {
    sourceSite: "haraj",
    externalListingId,
    rawText,
    listingTitle: meta.title,
    structured,
    brokerFields: hasSignal ? brokerFields : null,
    fieldSources: fieldSourcesFromStructured(structured),
    extractionStatus: blocked || !hasSignal
      ? LISTING_EXTRACTION_STATUS.FALLBACK_REQUIRED
      : (parsed.transactionConflict ? LISTING_EXTRACTION_STATUS.NEEDS_REVIEW : LISTING_EXTRACTION_STATUS.EXTRACTED),
    classificationStatus: blocked ? "fallback_required" : (parsed.transactionConflict ? "needs_review" : "confirmed")
  };
}

function parseDealHtml(html, url) {
  const meta = extractMetaFromHtml(html);
  const nextData = extractNextDataJson(html);
  const listingNode = nextData ? deepFindListingObject(nextData) : null;
  const rawText = extractListingTextFromHtml(html);
  const externalListingId = (String(url).match(/\/(?:property|listing|share)\/([a-zA-Z0-9_-]+)/i) || [])[1] || "";
  const baseNode = listingNode || { title: meta.title, description: rawText, category: meta.title };
  const parsed = buildStructuredFromListingNode(baseNode, {
    transactionType: "deal_structured",
    propertyType: "deal_structured"
  });
  const structured = parsed.structured;
  const brokerFields = structuredToBrokerFields(structured);
  const hasSignal = Boolean(brokerFields.purpose && brokerFields.opportunityKind);
  return {
    sourceSite: "deal",
    externalListingId,
    rawText,
    listingTitle: meta.title,
    structured,
    brokerFields: hasSignal ? brokerFields : null,
    fieldSources: fieldSourcesFromStructured(structured),
    extractionStatus: hasSignal
      ? (parsed.transactionConflict ? LISTING_EXTRACTION_STATUS.NEEDS_REVIEW : LISTING_EXTRACTION_STATUS.EXTRACTED)
      : LISTING_EXTRACTION_STATUS.FALLBACK_REQUIRED,
    classificationStatus: hasSignal
      ? (parsed.transactionConflict ? "needs_review" : "confirmed")
      : "fallback_required"
  };
}

function parseGenericHtml(html) {
  const meta = extractMetaFromHtml(html);
  const rawText = extractListingTextFromHtml(html);
  const parsed = buildStructuredFromListingNode({
    title: meta.title,
    description: rawText
  }, { transactionType: "generic_meta" });
  const structured = parsed.structured;
  const brokerFields = structuredToBrokerFields(structured);
  const hasSignal = Boolean(brokerFields.purpose || brokerFields.propertyType);
  return {
    sourceSite: "generic",
    externalListingId: "",
    rawText,
    listingTitle: meta.title,
    structured,
    brokerFields: hasSignal ? brokerFields : null,
    fieldSources: fieldSourcesFromStructured(structured),
    extractionStatus: hasSignal
      ? (parsed.transactionConflict ? LISTING_EXTRACTION_STATUS.NEEDS_REVIEW : LISTING_EXTRACTION_STATUS.EXTRACTED)
      : LISTING_EXTRACTION_STATUS.FALLBACK_REQUIRED,
    classificationStatus: hasSignal
      ? (parsed.transactionConflict ? "needs_review" : "confirmed")
      : "fallback_required"
  };
}

const ADAPTERS = [
  createAdapter({
    id: "aqar",
    matchHost: (host) => host === "aqar.fm" || host.endsWith(".aqar.fm"),
    extractId: (url) => (String(url).match(/\/(?:r|ad)\/([a-f0-9]+)/i) || [])[1] || "",
    parseHtml: parseAqarHtml
  }),
  createAdapter({
    id: "haraj",
    matchHost: (host) => host === "haraj.com.sa" || host.endsWith(".haraj.com.sa"),
    extractId: (url) => (String(url).match(/\/(\d{6,})/) || [])[1] || "",
    parseHtml: parseHarajHtml
  }),
  createAdapter({
    id: "deal",
    matchHost: (host) => host === "dealapp.sa" || host.endsWith(".dealapp.sa"),
    extractId: (url) => (String(url).match(/\/(?:property|listing|share)\/([a-zA-Z0-9_-]+)/i) || [])[1] || "",
    parseHtml: parseDealHtml
  }),
  createAdapter({
    id: "generic",
    matchHost: () => true,
    extractId: () => "",
    parseHtml: parseGenericHtml
  })
];

export function matchListingAdapter(url = "") {
  const host = hostFromUrl(url);
  return ADAPTERS.find((adapter) => adapter.id !== "generic" && adapter.matchHost(host))
    || ADAPTERS.find((adapter) => adapter.id === "generic");
}

export function resolveListingSourceSiteId(url = "") {
  return matchListingAdapter(url).id;
}

export function resolveListingSourceSiteLabel(url = "") {
  const id = resolveListingSourceSiteId(url);
  const labels = { aqar: "عقار", haraj: "حراج", deal: "ديل", generic: "الموقع" };
  return labels[id] || "الموقع";
}

export function parseListingHtmlWithAdapter(html, url, adapter = matchListingAdapter(url)) {
  return adapter.parseHtml(html, url);
}

export function listingFetchHeaders() {
  return {
    "User-Agent": BROWSER_USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ar-SA,ar;q=0.9,en;q=0.8"
  };
}

export const __test = {
  parseAqarHtml,
  parseHarajHtml,
  parseDealHtml,
  parseGenericHtml,
  mapTransactionTypeFromSignals,
  mapOpportunityKindFromText,
  mapPropertyTypeLabel,
  structuredToBrokerFields,
  extractNextDataJson,
  isBlockedListingPageText
};
