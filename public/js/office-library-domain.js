/**
 * Office library — private file storage metadata per office.
 */

import { safeText } from "./opportunity-intake-domain.js";

export const LIBRARY_ITEM_KINDS = Object.freeze({
  MANUAL: "manual",
  AGREEMENT: "agreement"
});

export const LIBRARY_CATEGORIES = Object.freeze({
  OWNER_BROKERAGE: "owner_brokerage",
  BUYER_BROKERAGE: "buyer_brokerage",
  TENANT_BROKERAGE: "tenant_brokerage",
  BROKER_COOPERATION: "broker_cooperation",
  SUB_BROKERAGE: "sub_brokerage",
  SALE_CONTRACT: "sale_contract",
  LEASE_CONTRACT: "lease_contract",
  CONTRACT_ADDENDUM: "contract_addendum",
  FAL_LICENSE: "fal_license",
  OFFICE_DOCUMENT: "office_document",
  OFFICE_MEDIA: "office_media",
  OTHER: "other"
});

export const LIBRARY_CATEGORY_SET = new Set(Object.values(LIBRARY_CATEGORIES));

export const LIBRARY_MAIN_SECTIONS = Object.freeze([
  {
    id: "brokerage",
    label: "عقود الوساطة والتوثيق",
    categories: [
      LIBRARY_CATEGORIES.OWNER_BROKERAGE,
      LIBRARY_CATEGORIES.BUYER_BROKERAGE,
      LIBRARY_CATEGORIES.TENANT_BROKERAGE,
      LIBRARY_CATEGORIES.BROKER_COOPERATION,
      LIBRARY_CATEGORIES.SUB_BROKERAGE
    ]
  },
  {
    id: "deals",
    label: "عقود الصفقات",
    categories: [
      LIBRARY_CATEGORIES.SALE_CONTRACT,
      LIBRARY_CATEGORIES.LEASE_CONTRACT,
      LIBRARY_CATEGORIES.CONTRACT_ADDENDUM
    ]
  },
  {
    id: "office",
    label: "ملفات المكتب",
    categories: [
      LIBRARY_CATEGORIES.FAL_LICENSE,
      LIBRARY_CATEGORIES.OFFICE_DOCUMENT,
      LIBRARY_CATEGORIES.OFFICE_MEDIA,
      LIBRARY_CATEGORIES.OTHER
    ]
  }
]);

export const LIBRARY_CATEGORY_LABELS = Object.freeze({
  [LIBRARY_CATEGORIES.OWNER_BROKERAGE]: "عقد وساطة بين المالك والوسيط",
  [LIBRARY_CATEGORIES.BUYER_BROKERAGE]: "عقد وساطة بين المشتري والوسيط",
  [LIBRARY_CATEGORIES.TENANT_BROKERAGE]: "عقد وساطة بين المستأجر والوسيط",
  [LIBRARY_CATEGORIES.BROKER_COOPERATION]: "عقد وساطة بين وسيط ووسيط",
  [LIBRARY_CATEGORIES.SUB_BROKERAGE]: "عقد الوساطة الفرعي",
  [LIBRARY_CATEGORIES.SALE_CONTRACT]: "عقود البيع",
  [LIBRARY_CATEGORIES.LEASE_CONTRACT]: "عقود الإيجار",
  [LIBRARY_CATEGORIES.CONTRACT_ADDENDUM]: "ملاحق العقود والتجديدات",
  [LIBRARY_CATEGORIES.FAL_LICENSE]: "رخصة فال",
  [LIBRARY_CATEGORIES.OFFICE_DOCUMENT]: "مستندات المكتب",
  [LIBRARY_CATEGORIES.OFFICE_MEDIA]: "صور وملفات المكتب",
  [LIBRARY_CATEGORIES.OTHER]: "ملفات أخرى"
});

export const DOCUMENT_STATUS_LABELS = Object.freeze({
  ACTIVE: "نشط",
  EXPIRED: "منتهي",
  PENDING: "قيد المراجعة",
  CANCELLED: "ملغى"
});

export const AGREEMENT_STATUS_LABELS = Object.freeze({
  ACTIVE: "سارية",
  EXPIRED: "منتهية",
  CANCELLED: "ملغاة"
});

export const DEFAULT_LIBRARY_MAIN_SECTION = "brokerage";

export function isLibraryCategory(value) {
  return LIBRARY_CATEGORY_SET.has(value);
}

export function resolveLibraryCategory(item = {}) {
  const raw = safeText(item.category, 40);
  if (isLibraryCategory(raw)) return raw;
  if (item.kind === LIBRARY_ITEM_KINDS.AGREEMENT) return LIBRARY_CATEGORIES.OFFICE_DOCUMENT;
  return LIBRARY_CATEGORIES.OTHER;
}

export function libraryCategoryLabel(category) {
  return LIBRARY_CATEGORY_LABELS[category] || LIBRARY_CATEGORY_LABELS[LIBRARY_CATEGORIES.OTHER];
}

export function libraryDocumentTitle(item = {}) {
  const title = safeText(item.documentTitle, 240);
  if (title) return title;
  if (item.kind === LIBRARY_ITEM_KINDS.AGREEMENT) {
    const counterpart = item.counterpartOfficeName || item.counterpartOfficeId || "مكتب آخر";
    return `اتفاقية تعاون مع ${counterpart}`;
  }
  return item.fileName || "ملف";
}

export function libraryRowLabel(item = {}) {
  return libraryDocumentTitle(item);
}

export function libraryDocumentStatusLabel(item = {}) {
  if (item.kind === LIBRARY_ITEM_KINDS.AGREEMENT) {
    return AGREEMENT_STATUS_LABELS[item.agreementStatus] || item.agreementStatus || "—";
  }
  const status = safeText(item.documentStatus, 20) || "ACTIVE";
  return DOCUMENT_STATUS_LABELS[status] || status;
}

export function isLibraryDocumentExpired(item = {}, now = new Date()) {
  if (!item.expiryDate) return false;
  const expiry = new Date(item.expiryDate);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry < now;
}

export function buildLibraryItem({
  officeId,
  fileName,
  contentType,
  mediaPath,
  note = "",
  kind = LIBRARY_ITEM_KINDS.MANUAL,
  category = LIBRARY_CATEGORIES.OTHER,
  documentTitle = "",
  referenceNumber = "",
  opportunityId = "",
  cooperationId = "",
  startDate = "",
  expiryDate = "",
  documentStatus = "ACTIVE",
  fileSizeBytes = null,
  agreementId = "",
  counterpartOfficeId = "",
  counterpartOfficeName = "",
  commissionRate = null,
  agreementStatus = "ACTIVE",
  createdBy = "",
  now = new Date()
}) {
  const id = `lib_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const resolvedCategory = isLibraryCategory(category) ? category : LIBRARY_CATEGORIES.OTHER;
  return {
    id,
    officeId: safeText(officeId, 80),
    fileName: safeText(fileName, 240),
    contentType: safeText(contentType, 120),
    mediaPath: safeText(mediaPath, 500),
    note: safeText(note, 500),
    kind: safeText(kind, 20) || LIBRARY_ITEM_KINDS.MANUAL,
    category: resolvedCategory,
    documentTitle: safeText(documentTitle, 240),
    referenceNumber: safeText(referenceNumber, 120),
    opportunityId: safeText(opportunityId, 120),
    cooperationId: safeText(cooperationId, 120),
    startDate: safeText(startDate, 40),
    expiryDate: safeText(expiryDate, 40),
    documentStatus: safeText(documentStatus, 20) || "ACTIVE",
    fileSizeBytes: fileSizeBytes == null || fileSizeBytes === "" ? null : Number(fileSizeBytes),
    agreementId: safeText(agreementId, 120),
    counterpartOfficeId: safeText(counterpartOfficeId, 80),
    counterpartOfficeName: safeText(counterpartOfficeName, 120),
    commissionRate: commissionRate == null || commissionRate === "" ? null : Number(commissionRate),
    agreementStatus: safeText(agreementStatus, 20) || "ACTIVE",
    createdBy: safeText(createdBy, 120),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    schemaVersion: 2
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
    category: LIBRARY_CATEGORIES.OFFICE_DOCUMENT,
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

export function groupLibraryItemsByCategory(items = []) {
  const grouped = Object.fromEntries(Object.values(LIBRARY_CATEGORIES).map((key) => [key, []]));
  for (const item of items) {
    const category = resolveLibraryCategory(item);
    grouped[category].push(item);
  }
  return grouped;
}

export function countLibraryItemsByCategory(items = []) {
  const grouped = groupLibraryItemsByCategory(items);
  return Object.fromEntries(Object.entries(grouped).map(([key, rows]) => [key, rows.length]));
}

export function countLibraryItemsByMainSection(items = []) {
  const byCategory = countLibraryItemsByCategory(items);
  return Object.fromEntries(
    LIBRARY_MAIN_SECTIONS.map((section) => [
      section.id,
      section.categories.reduce((sum, category) => sum + (byCategory[category] || 0), 0)
    ])
  );
}

export function filterLibraryItems(items = [], filters = {}, opportunityTitles = {}) {
  const {
    officeId = "",
    search = "",
    mainSection = "",
    category = "",
    documentStatus = "",
    activeFilter = ""
  } = filters;
  const needle = safeText(search, 200).trim().toLowerCase();
  const now = new Date();

  return items.filter((item) => {
    if (officeId && item.officeId !== officeId) return false;

    const resolvedCategory = resolveLibraryCategory(item);
    if (mainSection) {
      const section = LIBRARY_MAIN_SECTIONS.find((row) => row.id === mainSection);
      if (!section || !section.categories.includes(resolvedCategory)) return false;
    }
    if (category && resolvedCategory !== category) return false;

    const status = item.kind === LIBRARY_ITEM_KINDS.AGREEMENT
      ? item.agreementStatus || "ACTIVE"
      : item.documentStatus || "ACTIVE";
    if (documentStatus && status !== documentStatus) return false;

    const expired = isLibraryDocumentExpired(item, now) || status === "EXPIRED";
    if (activeFilter === "active" && expired) return false;
    if (activeFilter === "expired" && !expired) return false;

    if (!needle) return true;
    const title = libraryDocumentTitle(item).toLowerCase();
    const reference = safeText(item.referenceNumber, 120).toLowerCase();
    const oppTitle = safeText(opportunityTitles[item.opportunityId], 240).toLowerCase();
    return title.includes(needle) || reference.includes(needle) || oppTitle.includes(needle);
  });
}

export function formatLibraryFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function libraryFileTypeLabel(contentType = "") {
  const type = String(contentType || "").toLowerCase().split(";")[0].trim();
  if (type === "application/pdf") return "PDF";
  if (type === "image/jpeg") return "JPG";
  if (type === "image/png") return "PNG";
  if (type === "image/webp") return "WEBP";
  if (type === "application/msword") return "DOC";
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "DOCX";
  return type || "—";
}
