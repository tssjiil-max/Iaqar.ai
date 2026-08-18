const LIFECYCLE_STATUS = Object.freeze({
  NEW: "NEW",
  CONTACT_PENDING: "CONTACT_PENDING",
  CONTACTED: "CONTACTED",
  FOLLOW_UP: "FOLLOW_UP",
  NEGOTIATION: "NEGOTIATION",
  MATCHED: "MATCHED",
  CLOSED_WON: "CLOSED_WON",
  CLOSED_LOST: "CLOSED_LOST",
  ARCHIVED: "ARCHIVED"
});

const LIFECYCLE_STATUS_LABELS = Object.freeze({
  NEW: "جديدة",
  CONTACT_PENDING: "بانتظار التواصل",
  CONTACTED: "تم التواصل",
  FOLLOW_UP: "متابعة",
  NEGOTIATION: "تفاوض",
  MATCHED: "تمت المطابقة",
  CLOSED_WON: "مكتملة",
  CLOSED_LOST: "لم تتم",
  ARCHIVED: "منتهية / مؤرشفة"
});

const CLOSED_LOST_REASONS = Object.freeze([
  ["client_not_interested", "العميل لم يعد مهتمًا"],
  ["property_unavailable", "العقار غير متاح"],
  ["price_not_suitable", "السعر غير مناسب"],
  ["no_agreement", "لم يتم الاتفاق"],
  ["no_match", "لا يوجد تطابق مناسب"],
  ["contact_failed", "تعذر التواصل"],
  ["other", "أخرى"]
]);

const OPPORTUNITY_FINAL_CLOSE_REASONS = Object.freeze([
  "deal_done",
  "deal_failed",
  "not_interested",
  "contact_failed",
  "duplicate",
  "cancelled"
]);

const OPPORTUNITY_FINAL_CLOSE_REASON_LABELS = Object.freeze({
  deal_done: "تمت الصفقة",
  deal_failed: "لم تتم الصفقة",
  not_interested: "غير مهتم",
  contact_failed: "تعذر التواصل",
  duplicate: "طلب مكرر",
  cancelled: "ألغى العميل أو المالك"
});

const OPPORTUNITY_FINAL_OUTCOMES = Object.freeze([
  "sold",
  "rented",
  "purchased",
  "leased"
]);

const ACTIVE_LIFECYCLE_STATUSES = new Set([
  LIFECYCLE_STATUS.NEW,
  LIFECYCLE_STATUS.CONTACT_PENDING,
  LIFECYCLE_STATUS.CONTACTED,
  LIFECYCLE_STATUS.FOLLOW_UP,
  LIFECYCLE_STATUS.NEGOTIATION,
  LIFECYCLE_STATUS.MATCHED,
  LIFECYCLE_STATUS.CLOSED_WON,
  LIFECYCLE_STATUS.CLOSED_LOST
]);

const SOURCE_ALIASES = Object.freeze({
  office_public_link: "office_link",
  platform_public: "public_site",
  whatsapp_cloud_api: "whatsapp",
  pwa_share_target: "whatsapp",
  manual_intake: "manual",
  voice_intake: "voice",
  activepieces: "other"
});

const SELECT_ALIASES = Object.freeze({
  "شقه": "شقة",
  "شقه": "شقة",
  "فله": "فيلا",
  "فيله": "فيلا",
  "ارض": "أرض",
  "ارض سكنيه": "أرض سكنية",
  "ارض تجاريه": "أرض تجارية",
  "شراء": "sale",
  "بيع": "sale",
  "ايجار": "rent",
  "إيجار": "rent",
  "للايجار": "rent"
});

function normalizeArabicLite(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOpportunitySource(source) {
  const raw = String(source || "").trim();
  if (!raw) return "other";
  if (SOURCE_ALIASES[raw]) return SOURCE_ALIASES[raw];
  if (["office_link", "manual", "whatsapp", "public_site", "voice", "other"].includes(raw)) return raw;
  return "other";
}

function getOpportunityLifecycleStatus(opportunity = {}) {
  const direct = String(opportunity.lifecycleStatus || "").trim();
  if (direct && LIFECYCLE_STATUS_LABELS[direct]) return direct;

  const legacyStatus = String(opportunity.status || "").trim().toLowerCase();
  const legacyStage = String(opportunity.workflowStage || "").trim().toLowerCase();

  if (legacyStatus === "processed" || legacyStage === "processed") return LIFECYCLE_STATUS.CONTACTED;
  if (legacyStatus === "archived" || legacyStage === "archived") return LIFECYCLE_STATUS.ARCHIVED;
  if (legacyStatus === "fulfilled" || legacyStage === "closed" || legacyStage === "sold") return LIFECYCLE_STATUS.CLOSED_WON;
  if (legacyStatus === "closed" && opportunity.closedAt) return LIFECYCLE_STATUS.CLOSED_LOST;
  if (legacyStage === "negotiation") return LIFECYCLE_STATUS.NEGOTIATION;
  if (legacyStage === "contact" || legacyStage === "intake") return LIFECYCLE_STATUS.NEW;
  if (legacyStatus === "new" || legacyStage === "new") return LIFECYCLE_STATUS.NEW;
  if (legacyStatus === "active" || legacyStatus === "open") return LIFECYCLE_STATUS.NEW;

  return LIFECYCLE_STATUS.NEW;
}

function normalizeArabicDigits(value) {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  return String(value || "").replace(/[٠-٩]/g, (ch) => {
    const index = arabic.indexOf(ch);
    return index >= 0 ? String(index) : ch;
  });
}

function normalizeSaudiPhoneForWhatsApp(phone) {
  let digits = normalizeArabicDigits(phone).replace(/[\s\-()+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00966")) digits = digits.slice(2);
  if (digits.startsWith("+966")) digits = digits.slice(1);
  if (digits.startsWith("966") && digits.length === 12) return digits;
  if (digits.startsWith("05") && digits.length === 10) return `966${digits.slice(1)}`;
  if (digits.startsWith("5") && digits.length === 9) return `966${digits}`;
  if (/^9665\d{8}$/.test(digits)) return digits;
  return "";
}

function formatMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return `${amount.toLocaleString("ar-SA")} ريال`;
}

function buildOpportunitySummary(opportunity = {}) {
  const parts = [];
  const propertyType = String(opportunity.propertyType || "").trim();
  const district = String(opportunity.district || "").trim();
  const transactionType = String(opportunity.transactionType || "").trim();
  const isOwner = opportunity.contactType === "owner"
    || opportunity.kind === "owner"
    || opportunity.recordType === "owner_offer"
    || opportunity.kind === "owner_offer";

  if (propertyType) parts.push(propertyType);
  if (district) parts.push(`حي ${district}`);

  const rooms = Number(opportunity.rooms || 0);
  if (rooms > 0) parts.push(`${rooms} غرف`);

  const area = Number(opportunity.area || 0);
  if (area > 0) parts.push(`مساحة ${area.toLocaleString("ar-SA")} م²`);

  const price = Number(opportunity.price || opportunity.amount || 0);
  const priceMax = Number(opportunity.priceMax || 0);
  if (isOwner && price > 0) parts.push(`سعر ${formatMoney(price)}`);
  else if (!isOwner && priceMax > 0) parts.push(`ميزانية حتى ${formatMoney(priceMax)}`);
  else if (price > 0) parts.push(formatMoney(price));

  if (transactionType === "rent") parts.push("إيجار");
  else if (transactionType === "sale") parts.push("تمليك");

  return parts.filter(Boolean).join(" – ") || "طلب عقاري";
}

function buildOpportunityWhatsAppMessage(opportunity = {}, actionType = "first_contact", context = {}) {
  const brokerName = String(context.brokerName || "الوسيط").trim();
  const officeName = String(context.officeName || "المكتب العقاري").trim();
  const propertySummary = buildOpportunitySummary(opportunity);
  const matchSummary = String(context.matchSummary || propertySummary).trim();
  const isOwner = opportunity.contactType === "owner"
    || opportunity.kind === "owner"
    || opportunity.recordType === "owner_offer"
    || opportunity.kind === "owner_offer";

  if (actionType === "follow_up") {
    return `السلام عليكم\nمتابعة بخصوص طلبكم/عرضكم العقاري:\n${propertySummary}\n\nهل ما زال الطلب/العرض قائمًا؟`;
  }
  if (actionType === "match_customer") {
    return `السلام عليكم\n\nلدينا عقار قد يكون مناسبًا لطلبكم:\n\n${matchSummary}\n\nإذا كان مناسبًا لكم يمكنني تزويدكم بالتفاصيل واستكمال التنسيق.`;
  }
  if (actionType === "match_owner") {
    return `السلام عليكم\n\nيوجد لدينا طلب قد يتوافق مع عقاركم:\n${matchSummary}\n\nفي حال استمرار توفر العقار يمكننا استكمال التنسيق والمطابقة.`;
  }
  if (actionType === "negotiation_follow_up") {
    return `السلام عليكم\n\nمتابعة معكم بخصوص العقار محل التواصل السابق.\n\nهل نكمل الإجراءات والتنسيق؟`;
  }
  if (isOwner) {
    return `السلام عليكم ورحمة الله وبركاته\nمعك ${brokerName} من ${officeName}.\n\nوصلني عرضكم العقاري بخصوص:\n${propertySummary}\n\nوأتواصل معكم للتأكد من تفاصيل العقار واستكمال إجراءات التسويق والمطابقة مع الطلبات المناسبة.\n\nهل العرض ما زال متاحًا؟`;
  }
  return `السلام عليكم ورحمة الله وبركاته\nمعك ${brokerName} من ${officeName}.\n\nوصلني طلبك العقاري بخصوص:\n${propertySummary}\n\nوأتواصل معك للتأكد من التفاصيل ومساعدتك في الوصول للخيار المناسب.\n\nهل الطلب ما زال قائمًا؟`;
}

function resolveSelectOption(spokenValue, availableOptions = [], aliases = SELECT_ALIASES) {
  const spoken = normalizeArabicLite(spokenValue);
  if (!spoken) return { value: "", matched: false };

  const options = (availableOptions || []).map(option => {
    if (typeof option === "string") return { label: option, value: option };
    return { label: String(option.label || option.value || ""), value: String(option.value || option.label || "") };
  }).filter(option => option.label);

  for (const option of options) {
    const label = normalizeArabicLite(option.label);
    const value = normalizeArabicLite(option.value);
    if (spoken === label || spoken === value) return { value: option.value, matched: true };
  }

  const aliasTarget = aliases[spoken];
  if (aliasTarget) {
    for (const option of options) {
      if (normalizeArabicLite(option.label) === normalizeArabicLite(aliasTarget)
        || normalizeArabicLite(option.value) === normalizeArabicLite(aliasTarget)) {
        return { value: option.value, matched: true };
      }
    }
  }

  return { value: "", matched: false };
}

function extractDistrictFromVoice(text, districts = []) {
  const normalized = normalizeArabicLite(text);
  const sorted = [...districts].sort((a, b) => b.length - a.length);
  for (const district of sorted) {
    const key = normalizeArabicLite(district);
    if (!key) continue;
    const index = normalized.indexOf(key);
    if (index >= 0) {
      const after = normalized.slice(index + key.length).trim();
      if (/^(مساح|مساحت|متر|م2|م²|\d)/.test(after)) return district;
      if (after && !/^(في|ب|و|،|,)/.test(after) && after.split(" ").length > 2) continue;
      return district;
    }
  }
  return "";
}

function parseVoiceOpportunityFields(text, options = {}) {
  const propertyTypes = options.propertyTypes || [];
  const districts = options.districts || [];
  const transactionOptions = options.transactionOptions || [
    { label: "بيع", value: "sale" },
    { label: "شراء", value: "sale" },
    { label: "إيجار", value: "rent" }
  ];
  const result = { unmatched: [] };
  const normalized = normalizeArabicLite(text);

  let propertyMatch = resolveSelectOption(text, propertyTypes);
  if (!propertyMatch.matched) {
    const sortedTypes = [...propertyTypes].sort((a, b) => b.length - a.length);
    for (const type of sortedTypes) {
      if (normalized.includes(normalizeArabicLite(type))) {
        propertyMatch = { value: type, matched: true };
        break;
      }
    }
  }
  if (propertyMatch.matched) result.propertyType = propertyMatch.value;
  else if (/شق|فيل|ارض|عمار|دور|دوبل|محل|مكتب/.test(normalized)) result.unmatched.push("propertyType");

  const district = extractDistrictFromVoice(text, districts);
  if (district) result.district = district;

  let transactionMatch = resolveSelectOption(text, transactionOptions);
  if (!transactionMatch.matched) {
    if (/شراء|بيع|تمليك/.test(normalized)) transactionMatch = { value: "sale", matched: true };
    else if (/ايجار|إيجار/.test(normalized)) transactionMatch = { value: "rent", matched: true };
  }
  if (transactionMatch.matched) result.transactionType = transactionMatch.value;
  else if (/شراء|بيع|ايجار|إيجار|تمليك/.test(normalized)) result.unmatched.push("transactionType");

  const areaMatch = String(text || "").match(/(?:مساح(?:ة|تها|ه)?)\s*(\d{2,6})|(\d{2,6})\s*(?:متر|م2|م²)/);
  const area = Number(areaMatch && (areaMatch[1] || areaMatch[2]) || 0);
  if (area >= 20 && area <= 200000) result.area = area;

  return result;
}

function whatsappActionTypeForStatus(status) {
  const lifecycle = getOpportunityLifecycleStatus({ lifecycleStatus: status });
  if (lifecycle === LIFECYCLE_STATUS.FOLLOW_UP) return "follow_up";
  if (lifecycle === LIFECYCLE_STATUS.NEGOTIATION) return "negotiation_follow_up";
  if (lifecycle === LIFECYCLE_STATUS.MATCHED) return "match_customer";
  return "first_contact";
}

function isArchivedLifecycle(status) {
  return getOpportunityLifecycleStatus({ lifecycleStatus: status }) === LIFECYCLE_STATUS.ARCHIVED;
}

function isActiveLifecycle(opportunity = {}) {
  const status = getOpportunityLifecycleStatus(opportunity);
  return ACTIVE_LIFECYCLE_STATUSES.has(status) && status !== LIFECYCLE_STATUS.ARCHIVED;
}

export {
  LIFECYCLE_STATUS,
  LIFECYCLE_STATUS_LABELS,
  CLOSED_LOST_REASONS,
  OPPORTUNITY_FINAL_CLOSE_REASONS,
  OPPORTUNITY_FINAL_CLOSE_REASON_LABELS,
  OPPORTUNITY_FINAL_OUTCOMES,
  ACTIVE_LIFECYCLE_STATUSES,
  normalizeOpportunitySource,
  getOpportunityLifecycleStatus,
  normalizeArabicDigits,
  normalizeSaudiPhoneForWhatsApp,
  buildOpportunitySummary,
  buildOpportunityWhatsAppMessage,
  resolveSelectOption,
  extractDistrictFromVoice,
  parseVoiceOpportunityFields,
  whatsappActionTypeForStatus,
  isArchivedLifecycle,
  isActiveLifecycle,
  normalizeArabicLite
};
