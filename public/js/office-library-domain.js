/**
 * Office library — private file storage metadata per office.
 */

import { safeText } from "./opportunity-intake-domain.js";

export const LIBRARY_ITEM_KINDS = Object.freeze({
  MANUAL: "manual",
  AGREEMENT: "agreement"
});

export const AGREEMENT_STATUS_LABELS = Object.freeze({
  ACTIVE: "سارية",
  EXPIRED: "منتهية",
  CANCELLED: "ملغاة"
});

export function buildLibraryItem({
  officeId,
  fileName,
  contentType,
  mediaPath,
  note = "",
  kind = LIBRARY_ITEM_KINDS.MANUAL,
  agreementId = "",
  counterpartOfficeId = "",
  counterpartOfficeName = "",
  commissionRate = null,
  agreementStatus = "ACTIVE",
  createdBy = "",
  now = new Date()
}) {
  const id = `lib_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    officeId: safeText(officeId, 80),
    fileName: safeText(fileName, 240),
    contentType: safeText(contentType, 120),
    mediaPath: safeText(mediaPath, 500),
    note: safeText(note, 500),
    kind: safeText(kind, 20) || LIBRARY_ITEM_KINDS.MANUAL,
    agreementId: safeText(agreementId, 120),
    counterpartOfficeId: safeText(counterpartOfficeId, 80),
    counterpartOfficeName: safeText(counterpartOfficeName, 120),
    commissionRate: commissionRate == null || commissionRate === "" ? null : Number(commissionRate),
    agreementStatus: safeText(agreementStatus, 20) || "ACTIVE",
    createdBy: safeText(createdBy, 120),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    schemaVersion: 1
  };
}

export function buildAgreementLibraryEntries({
  agreementId,
  originatingOfficeId,
  targetOfficeId,
  originatingOfficeName,
  targetOfficeName,
  commissionRate = null,
  mediaPath = "",
  fileName = "اتفاقية-تعاون.pdf",
  status = "ACTIVE",
  createdBy = "",
  now = new Date()
}) {
  const base = {
    kind: LIBRARY_ITEM_KINDS.AGREEMENT,
    agreementId,
    commissionRate,
    mediaPath: safeText(mediaPath, 500),
    fileName: safeText(fileName, 240),
    agreementStatus: status,
    createdBy,
    now
  };
  return [
    buildLibraryItem({
      ...base,
      officeId: originatingOfficeId,
      counterpartOfficeId: targetOfficeId,
      counterpartOfficeName: targetOfficeName,
      note: `اتفاقية تعاون مع ${targetOfficeName || targetOfficeId}`
    }),
    buildLibraryItem({
      ...base,
      officeId: targetOfficeId,
      counterpartOfficeId: originatingOfficeId,
      counterpartOfficeName: originatingOfficeName,
      note: `اتفاقية تعاون مع ${originatingOfficeName || originatingOfficeId}`
    })
  ];
}

export function libraryRowLabel(item = {}) {
  if (item.kind === LIBRARY_ITEM_KINDS.AGREEMENT) {
    const status = AGREEMENT_STATUS_LABELS[item.agreementStatus] || item.agreementStatus;
    const counterpart = item.counterpartOfficeName || item.counterpartOfficeId || "مكتب آخر";
    const commission = item.commissionRate != null ? ` — عمولة ${item.commissionRate}%` : "";
    return `اتفاقية مع ${counterpart}${commission} (${status})`;
  }
  return item.fileName || "ملف";
}
