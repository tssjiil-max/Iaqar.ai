/**
 * Browser-safe active-opportunity duplicate detection — office-scoped, not phone-only.
 * Mirrors worker/src/opportunity-duplicate.mjs for client-side import-advert flows.
 */

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

function isActiveLifecycle(opportunity = {}) {
  const status = getOpportunityLifecycleStatus(opportunity);
  return ACTIVE_LIFECYCLE_STATUSES.has(status) && status !== LIFECYCLE_STATUS.ARCHIVED;
}

function normalizeArabicLite(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDuplicatePhone(phone) {
  const digits = normalizeSaudiPhoneForWhatsApp(phone);
  return digits || "";
}

export function resolveOpportunityKind(record = {}) {
  const kind = String(record.opportunityKind || record.kind || record.recordType || "").toUpperCase();
  if (kind === "OFFER" || kind === "OWNER" || kind === "OWNER_OFFER" || record.contactType === "owner") {
    return "offer";
  }
  if (kind === "REQUEST" || kind === "CLIENT" || kind === "CLIENT_REQUEST" || record.contactType === "buyer") {
    return "request";
  }
  return "";
}

export function isActiveOpportunityForDuplicate(record = {}) {
  const status = getOpportunityLifecycleStatus(record);
  if (!isActiveLifecycle(record)) return false;
  if ([LIFECYCLE_STATUS.CLOSED_WON, LIFECYCLE_STATUS.CLOSED_LOST, LIFECYCLE_STATUS.ARCHIVED].includes(status)) {
    return false;
  }
  if (String(record.lifecycleStatus || "").toUpperCase() === "DELETED" || record.deletedAt) return false;
  return true;
}

/**
 * @param {object} existing — Firestore opportunity document
 * @param {object} criteria — incoming intake criteria
 */
export function matchesDuplicateCriteria(existing = {}, criteria = {}) {
  if (!isActiveOpportunityForDuplicate(existing)) return false;

  const officeId = String(criteria.officeId || "").trim();
  if (officeId && String(existing.officeId || "").trim() !== officeId) return false;

  const phone = normalizeDuplicatePhone(criteria.phone || criteria.contactPhone);
  const existingPhone = normalizeDuplicatePhone(
    existing.contactPhone || existing.advertiserPhoneNormalized || existing.phone
  );
  if (!phone || !existingPhone || phone !== existingPhone) return false;

  const contactType = String(criteria.contactType || "").trim().toLowerCase();
  const existingContact = String(existing.contactType || "").trim().toLowerCase();
  if (contactType && existingContact && contactType !== existingContact) return false;

  const kind = String(criteria.opportunityKind || criteria.kind || "").trim().toLowerCase();
  const existingKind = resolveOpportunityKind(existing);
  if (kind === "owner" || kind === "offer") {
    if (existingKind && existingKind !== "offer") return false;
  } else if (kind === "client" || kind === "request") {
    if (existingKind && existingKind !== "request") return false;
  }

  const propertyType = normalizeArabicLite(criteria.propertyType);
  const existingProperty = normalizeArabicLite(existing.propertyType);
  if (propertyType && existingProperty && propertyType !== existingProperty) return false;

  const city = normalizeArabicLite(criteria.city);
  const existingCity = normalizeArabicLite(existing.city);
  if (city && existingCity && city !== existingCity) return false;

  const district = normalizeArabicLite(criteria.district);
  const existingDistrict = normalizeArabicLite(existing.district);
  if (district && existingDistrict && district !== existingDistrict) return false;

  return true;
}

export function findDuplicateOpportunity(docs = [], criteria = {}) {
  for (const doc of docs) {
    const data = doc.data || doc;
    const opportunityId = doc.id || data.id || data.opportunityId || "";
    if (matchesDuplicateCriteria(data, criteria)) {
      return { opportunityId, data };
    }
  }
  return null;
}
