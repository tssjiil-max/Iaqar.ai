/**
 * Canonical transaction intent — independent from propertyType.
 * SELL / BUY / RENT_OUT / RENT_IN only. No inference from role or property type.
 */

import { safeText } from "./opportunity-intake-domain.js";

export const TRANSACTION_INTENT = Object.freeze({
  SELL: "SELL",
  BUY: "BUY",
  RENT_OUT: "RENT_OUT",
  RENT_IN: "RENT_IN"
});

export const TRANSACTION_INTENT_VALUES = Object.freeze([
  TRANSACTION_INTENT.SELL,
  TRANSACTION_INTENT.BUY,
  TRANSACTION_INTENT.RENT_OUT,
  TRANSACTION_INTENT.RENT_IN
]);

export const TRANSACTION_INTENT_LABELS = Object.freeze({
  SELL: "بيع",
  BUY: "شراء",
  RENT_OUT: "إيجار",
  RENT_IN: "استئجار"
});

export function isValidTransactionIntent(value) {
  return TRANSACTION_INTENT_VALUES.includes(String(value || "").trim().toUpperCase());
}

export function normalizeTransactionIntent(value) {
  const upper = String(value || "").trim().toUpperCase();
  return isValidTransactionIntent(upper) ? upper : "";
}

export function opportunityKindFromTransactionIntent(intent) {
  const normalized = normalizeTransactionIntent(intent);
  if (normalized === TRANSACTION_INTENT.SELL || normalized === TRANSACTION_INTENT.RENT_OUT) return "OFFER";
  if (normalized === TRANSACTION_INTENT.BUY || normalized === TRANSACTION_INTENT.RENT_IN) return "REQUEST";
  return "";
}

export function purposeFromTransactionIntent(intent) {
  const normalized = normalizeTransactionIntent(intent);
  switch (normalized) {
    case TRANSACTION_INTENT.SELL:
      return "SALE";
    case TRANSACTION_INTENT.BUY:
      return "PURCHASE";
    case TRANSACTION_INTENT.RENT_OUT:
      return "RENT";
    case TRANSACTION_INTENT.RENT_IN:
      return "LEASE_REQUEST";
    default:
      return "";
  }
}

export function transactionIntentFromOwnerChoice(choice = "") {
  const text = safeText(choice, 40);
  if (!text) return "";
  const upper = text.toUpperCase();
  if (upper === TRANSACTION_INTENT.SELL || upper === "SALE" || text === "بيع") return TRANSACTION_INTENT.SELL;
  if (upper === TRANSACTION_INTENT.RENT_OUT || upper === "RENT" || text === "إيجار" || text === "ايجار") {
    return TRANSACTION_INTENT.RENT_OUT;
  }
  return normalizeTransactionIntent(text);
}

export function transactionIntentFromClientChoice(choice = "") {
  const text = safeText(choice, 40);
  if (!text) return "";
  const upper = text.toUpperCase();
  if (upper === TRANSACTION_INTENT.BUY || upper === "PURCHASE" || upper === "BUY" || text === "شراء") {
    return TRANSACTION_INTENT.BUY;
  }
  if (upper === TRANSACTION_INTENT.RENT_IN || upper === "LEASE_REQUEST" || text === "استئجار") {
    return TRANSACTION_INTENT.RENT_IN;
  }
  if (text === "rent" || text === "إيجار" || text === "ايجار") return TRANSACTION_INTENT.RENT_IN;
  return normalizeTransactionIntent(text);
}

function normalizeArabicForIntent(value = "") {
  return String(value || "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Extract intent only from explicit Arabic phrases (voice / WhatsApp / import text).
 * Returns null when no explicit evidence — never guesses.
 */
export function extractTransactionIntentFromText(input = "") {
  const text = normalizeArabicForIntent(input);
  if (!text) return null;

  if (/(?:^|\s)(ابحث عن شراء|اريد اشتري)/.test(text)) {
    return TRANSACTION_INTENT.BUY;
  }
  if (/(?:^|\s)(ابحث عن ايجار|اريد استاجر)/.test(text)) {
    return TRANSACTION_INTENT.RENT_IN;
  }
  if (/(?:^|\s)ابيع/.test(text)) return TRANSACTION_INTENT.SELL;
  if (/(?:^|\s)للبيع/.test(text)) return TRANSACTION_INTENT.SELL;
  if (/(?:^|\s)اؤجر/.test(text)) return TRANSACTION_INTENT.RENT_OUT;
  if (/(?:^|\s)(للإيجار|للايجار)/.test(text)) return TRANSACTION_INTENT.RENT_OUT;

  return null;
}

/**
 * Legacy records: map only when opportunityKind + purpose (or intake kind) give explicit evidence.
 * Never infer from contactType alone or propertyType.
 */
export function resolveTransactionIntentFromRecord(record = {}) {
  const direct = normalizeTransactionIntent(record.transactionIntent);
  if (direct) return direct;

  const kind = safeText(record.opportunityKind || record.kind, 40).toUpperCase();
  const purpose = safeText(record.purpose, 30).toUpperCase();
  const intakeKind = safeText(record.kind, 20).toLowerCase();
  const tx = safeText(record.transactionType, 20).toLowerCase();

  if (kind === "OFFER" && purpose === "SALE") return TRANSACTION_INTENT.SELL;
  if (kind === "OFFER" && purpose === "RENT") return TRANSACTION_INTENT.RENT_OUT;
  if (kind === "REQUEST" && purpose === "PURCHASE") return TRANSACTION_INTENT.BUY;
  if (kind === "REQUEST" && purpose === "LEASE_REQUEST") return TRANSACTION_INTENT.RENT_IN;

  if (intakeKind === "owner" && purpose === "SALE") return TRANSACTION_INTENT.SELL;
  if (intakeKind === "owner" && purpose === "RENT") return TRANSACTION_INTENT.RENT_OUT;
  if (intakeKind === "client" && purpose === "PURCHASE") return TRANSACTION_INTENT.BUY;
  if (intakeKind === "client" && purpose === "LEASE_REQUEST") return TRANSACTION_INTENT.RENT_IN;

  if (kind === "OFFER" && tx === "sale") return TRANSACTION_INTENT.SELL;
  if (kind === "OFFER" && tx === "rent") return TRANSACTION_INTENT.RENT_OUT;
  if (kind === "REQUEST" && tx === "purchase") return TRANSACTION_INTENT.BUY;
  if (kind === "REQUEST" && tx === "rent") return TRANSACTION_INTENT.RENT_IN;

  return null;
}

export function areTransactionIntentsCompatible(left, right) {
  const a = normalizeTransactionIntent(left);
  const b = normalizeTransactionIntent(right);
  if (!a || !b) return false;
  return (
    (a === TRANSACTION_INTENT.SELL && b === TRANSACTION_INTENT.BUY)
    || (a === TRANSACTION_INTENT.BUY && b === TRANSACTION_INTENT.SELL)
    || (a === TRANSACTION_INTENT.RENT_OUT && b === TRANSACTION_INTENT.RENT_IN)
    || (a === TRANSACTION_INTENT.RENT_IN && b === TRANSACTION_INTENT.RENT_OUT)
  );
}

export function isOwnerOfferRecord(record = {}) {
  const kind = safeText(record.opportunityKind || record.kind || record.recordType, 40).toUpperCase();
  return record.contactType === "owner"
    || kind === "OWNER"
    || kind === "OWNER_OFFER"
    || kind === "OFFER";
}

export function transactionIntentOptionsForRecord(record = {}) {
  if (isOwnerOfferRecord(record)) {
    return [
      { value: TRANSACTION_INTENT.SELL, label: TRANSACTION_INTENT_LABELS.SELL },
      { value: TRANSACTION_INTENT.RENT_OUT, label: TRANSACTION_INTENT_LABELS.RENT_OUT }
    ];
  }
  return [
    { value: TRANSACTION_INTENT.BUY, label: TRANSACTION_INTENT_LABELS.BUY },
    { value: TRANSACTION_INTENT.RENT_IN, label: TRANSACTION_INTENT_LABELS.RENT_IN }
  ];
}

export function transactionIntentLabel(intent) {
  const normalized = normalizeTransactionIntent(intent);
  return TRANSACTION_INTENT_LABELS[normalized] || "";
}

export function applyTransactionIntentToRecord(record = {}, intent) {
  const normalized = normalizeTransactionIntent(intent);
  if (!normalized) {
    return {
      ...record,
      transactionIntent: null,
      opportunityKind: record.opportunityKind || "",
      purpose: record.purpose || ""
    };
  }
  return {
    ...record,
    transactionIntent: normalized,
    opportunityKind: opportunityKindFromTransactionIntent(normalized),
    purpose: purposeFromTransactionIntent(normalized),
    transactionType: normalized === TRANSACTION_INTENT.SELL || normalized === TRANSACTION_INTENT.BUY
      ? (normalized === TRANSACTION_INTENT.SELL ? "sale" : "purchase")
      : "rent"
  };
}

export function recordTypeFromTransactionIntent(intent) {
  const kind = opportunityKindFromTransactionIntent(intent);
  if (kind === "OFFER") return "owner_offer";
  if (kind === "REQUEST") return "client_request";
  return "unknown";
}

if (typeof window !== "undefined") {
  window.IAQARTransactionIntent = {
    TRANSACTION_INTENT,
    TRANSACTION_INTENT_LABELS,
    normalizeTransactionIntent,
    transactionIntentFromOwnerChoice,
    transactionIntentFromClientChoice,
    purposeFromTransactionIntent,
    opportunityKindFromTransactionIntent,
    transactionIntentLabel
  };
}
