import { formatCooperationReference } from "./reference-code-domain.js";

/**
 * Office-collaboration workflow V1 — living task, ranking helpers, privacy.
 * Does not rewrite the matching engine. Proximity never creates a match.
 */

export const COOPERATION_WORKFLOW_PATH = "/cooperation/workflow";

export const COOPERATION_STAGE = Object.freeze({
  MATCH_FOUND: "COOPERATION_MATCH_FOUND",
  REVIEW: "COOPERATION_REVIEW",
  REQUEST_SENT: "COOPERATION_REQUEST_SENT",
  WAITING_PARTNER: "WAITING_PARTNER",
  ACCEPTED: "COOPERATION_ACCEPTED",
  CUSTOMER_ACTION: "CUSTOMER_ACTION",
  OWNER_ACTION: "OWNER_ACTION",
  APPOINTMENT: "APPOINTMENT",
  APPOINTMENT_CONFIRMED: "APPOINTMENT_CONFIRMED",
  FOLLOW_UP_AFTER_VIEWING: "FOLLOW_UP_AFTER_VIEWING",
  PRELIMINARY_AGREEMENT: "PRELIMINARY_AGREEMENT",
  DEAL_COMPLETION_PENDING: "DEAL_COMPLETION_PENDING",
  COMPLETED: "COMPLETED",
  REJECTED: "REJECTED"
});

export const COOPERATION_RECORD_STATUS = Object.freeze({
  SUGGESTED: "SUGGESTED",
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  COMPLETED: "COMPLETED",
  REVOKED: "REVOKED",
  ENDED: "ENDED"
});

export const COOPERATION_ROLE = Object.freeze({
  CLIENT_OFFICE: "CLIENT_OFFICE",
  PROPERTY_OFFICE: "PROPERTY_OFFICE"
});

export const COOPERATION_ROLE_LABELS = Object.freeze({
  CLIENT_OFFICE: "مكتب العميل",
  PROPERTY_OFFICE: "مكتب العقار"
});

export const PROXIMITY_SCOPE = Object.freeze({
  SAME_DISTRICT: "SAME_DISTRICT",
  NEARBY_DISTRICTS: "NEARBY_DISTRICTS",
  DISTANCE: "DISTANCE"
});

export const SORT_GROUP = Object.freeze({
  NEEDS_ACTION: "NEEDS_ACTION",
  NEW_RESPONSE: "NEW_RESPONSE",
  TODAY_APPOINTMENT: "TODAY_APPOINTMENT",
  WAITING_OTHER_OFFICE: "WAITING_OTHER_OFFICE",
  INFORMATIONAL: "INFORMATIONAL"
});

export const SORT_GROUP_RANK = Object.freeze({
  NEEDS_ACTION: 1,
  TODAY_APPOINTMENT: 3,
  NEW_RESPONSE: 4,
  WAITING_OTHER_OFFICE: 5,
  INFORMATIONAL: 6
});

export const COOPERATION_ACTION = Object.freeze({
  REQUEST: "REQUEST",
  ACCEPT: "ACCEPT",
  REJECT: "REJECT",
  FOLLOW_CUSTOMER: "FOLLOW_CUSTOMER",
  FOLLOW_OWNER: "FOLLOW_OWNER",
  CUSTOMER_INTERESTED: "CUSTOMER_INTERESTED",
  CUSTOMER_NOT_SUITABLE: "CUSTOMER_NOT_SUITABLE",
  PROPERTY_AVAILABLE: "PROPERTY_AVAILABLE",
  PROPERTY_UNAVAILABLE: "PROPERTY_UNAVAILABLE",
  CONFIRM_APPOINTMENT: "CONFIRM_APPOINTMENT",
  PRELIMINARY_AGREEMENT: "PRELIMINARY_AGREEMENT",
  CONFIRM_COMPLETION: "CONFIRM_COMPLETION"
});

export const DEFAULT_MAX_CONCURRENT = 1;
export const HARD_MAX_CONCURRENT = 2;
export const DEFAULT_SHARE_PERCENT = 50;

const PRIVATE_KEYS = Object.freeze([
  "phone", "clientPhone", "ownerPhone", "contactPhone", "buyerPhone", "advertiserPhone",
  "whatsapp", "email", "mail", "notes", "internalNotes", "privateNotes", "brokerNotes",
  "token", "accessToken", "idToken", "fcmToken", "refreshToken",
  "uid", "firebaseUid", "authUid",
  "score", "opportunityScore", "breakdown", "matchScore", "rankingScore",
  "rawText", "ocrText"
]);

const ARCHIVE_STAGES = new Set([
  COOPERATION_STAGE.COMPLETED,
  COOPERATION_STAGE.REJECTED
]);

const ARCHIVE_STATUSES = new Set([
  COOPERATION_RECORD_STATUS.COMPLETED,
  COOPERATION_RECORD_STATUS.REJECTED,
  COOPERATION_RECORD_STATUS.REVOKED,
  COOPERATION_RECORD_STATUS.ENDED
]);

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

export function normalizeProximityScope(value) {
  const key = upper(value);
  return Object.values(PROXIMITY_SCOPE).includes(key) ? key : PROXIMITY_SCOPE.SAME_DISTRICT;
}

export function normalizeMaxConcurrent(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 1) return DEFAULT_MAX_CONCURRENT;
  return HARD_MAX_CONCURRENT;
}

export function collaborationEnabled(mode) {
  return upper(mode) !== "DISABLED";
}

export function shouldSearchCrossOffice({ internalMatchCount = 0, mode } = {}) {
  if (Number(internalMatchCount || 0) > 0) return false;
  return collaborationEnabled(mode);
}

export function livingCooperationTaskId(cooperationId) {
  return text(cooperationId);
}

export function selectBestCooperationOffices(ranked = [], { maxConcurrent = DEFAULT_MAX_CONCURRENT } = {}) {
  const cap = Math.min(HARD_MAX_CONCURRENT, normalizeMaxConcurrent(maxConcurrent));
  const seen = new Set();
  const picked = [];
  for (const row of ranked) {
    const officeId = text(row.officeId || row.partnerOfficeId).toLowerCase();
    if (!officeId || seen.has(officeId)) continue;
    seen.add(officeId);
    picked.push(row);
    if (picked.length >= cap) break;
  }
  return picked;
}

export function parseCoords(record = {}) {
  const lat = Number(record.lat ?? record.latitude ?? record.geoLat ?? record.locationLat);
  const lng = Number(record.lng ?? record.longitude ?? record.geoLng ?? record.locationLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

export function haversineKm(a, b) {
  if (!a || !b) return null;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  const km = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  return Number.isFinite(km) ? km : null;
}

export function formatRealDistanceKm(km) {
  if (!Number.isFinite(km) || km < 0) return "";
  return `${km.toFixed(1)} كم`;
}

export function resolveProximity({
  source = {},
  candidate = {},
  adjacentDistrictIds = [],
  resolveDistrictId = () => ""
} = {}) {
  const coordsA = parseCoords(source);
  const coordsB = parseCoords(candidate);
  const km = haversineKm(coordsA, coordsB);
  const districtA = text(source.district);
  const districtB = text(candidate.district);
  const idA = resolveDistrictId(districtA, source.city) || text(source.districtId);
  const idB = resolveDistrictId(districtB, candidate.city) || text(candidate.districtId);
  const sameName = Boolean(districtA && districtB && districtA === districtB);
  const sameId = Boolean(idA && idB && idA === idB);
  const sameDistrict = sameName || sameId;
  const nearby = Boolean(
    idA && idB && !sameDistrict && Array.isArray(adjacentDistrictIds) && adjacentDistrictIds.includes(idB)
  );

  let label = "";
  if (km != null) label = formatRealDistanceKm(km);
  else if (sameDistrict) label = "نفس الحي";
  else if (nearby) label = "حي قريب";

  return {
    km,
    label,
    sameDistrict,
    nearby,
    hasRealDistance: km != null
  };
}

export function proximityAllowedForScope(proximity, scope) {
  const mode = normalizeProximityScope(scope);
  if (mode === PROXIMITY_SCOPE.SAME_DISTRICT) return Boolean(proximity?.sameDistrict);
  if (mode === PROXIMITY_SCOPE.NEARBY_DISTRICTS) {
    return Boolean(proximity?.sameDistrict || proximity?.nearby);
  }
  if (proximity?.hasRealDistance) return true;
  return Boolean(proximity?.sameDistrict);
}

export function proximityRankBoost(proximity) {
  if (!proximity) return 0;
  if (proximity.hasRealDistance) {
    if (proximity.km <= 2) return 6;
    if (proximity.km <= 5) return 3;
    return 1;
  }
  if (proximity.sameDistrict) return 8;
  if (proximity.nearby) return 4;
  return 0;
}

export function rankCooperationScore(scored = {}, proximity = {}) {
  const b = scored.breakdown || {};
  return (
    Number(b.propertyType || 0) + Number(b.transactionType || 0)
    + Number(b.district || 0) + Number(b.city || 0)
    + Number(b.price || 0)
    + Number(b.area || 0) + Number(b.rooms || 0)
    + Number(scored.score || 0)
    + proximityRankBoost(proximity)
  );
}

export function compatibilityLabel(scored = {}) {
  const score = Number(scored.score || 0);
  if (score >= 80) return "توافق مرتفع";
  if (score >= 65) return "توافق جيد";
  return "توافق مناسب";
}

export function resolveCooperationRoles({
  originatingKind = "",
  counterpartKind = "",
  originatingOfficeId = "",
  targetOfficeId = ""
} = {}) {
  const originKind = upper(originatingKind);
  const counterpart = upper(counterpartKind);
  const originIsRequest = originKind === "REQUEST" || originKind === "CLIENT"
    || counterpart === "OFFER" || counterpart === "OWNER";
  const originIsOffer = originKind === "OFFER" || originKind === "OWNER";
  if (originIsOffer && !originIsRequest) {
    return {
      clientOfficeId: text(targetOfficeId),
      propertyOfficeId: text(originatingOfficeId)
    };
  }
  return {
    clientOfficeId: text(originatingOfficeId),
    propertyOfficeId: text(targetOfficeId)
  };
}

export function viewerRoleFor(record = {}, officeId = "") {
  const id = text(officeId).toLowerCase();
  if (id && id === text(record.clientOfficeId).toLowerCase()) return COOPERATION_ROLE.CLIENT_OFFICE;
  if (id && id === text(record.propertyOfficeId).toLowerCase()) return COOPERATION_ROLE.PROPERTY_OFFICE;
  if (id && id === text(record.originatingOfficeId).toLowerCase()) {
    return resolveCooperationRoles(record).clientOfficeId === record.originatingOfficeId
      ? COOPERATION_ROLE.CLIENT_OFFICE
      : COOPERATION_ROLE.PROPERTY_OFFICE;
  }
  return COOPERATION_ROLE.PROPERTY_OFFICE;
}

export function partnerOfficeNameFor(record = {}, officeId = "") {
  const id = text(officeId).toLowerCase();
  if (id === text(record.originatingOfficeId).toLowerCase()) {
    return text(record.targetOfficeName);
  }
  return text(record.originatingOfficeName);
}

export function waitingPartnerLabel(partnerName = "") {
  const name = text(partnerName);
  return name ? `بانتظار رد ${name}` : "";
}

export function cooperationRequestedLabel(partnerName = "") {
  const name = text(partnerName);
  return name ? `تم إرسال طلب التعاون إلى ${name}` : "تم إرسال طلب التعاون";
}

export function sanitizeCooperationView(record = {}) {
  const out = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (PRIVATE_KEYS.includes(key)) continue;
    if (/phone|email|token|uid|notes|score|breakdown/i.test(key)) continue;
    out[key] = value;
  }
  return {
    ...out,
    phone: "",
    clientPhone: "",
    ownerPhone: "",
    contactPhone: "",
    notes: "",
    internalNotes: "",
    token: "",
    score: undefined,
    opportunityScore: undefined,
    breakdown: undefined
  };
}

export function publicListingSlice(listing = {}) {
  const price = listing.salePrice ?? listing.price ?? listing.priceOrBudget ?? listing.budget;
  return {
    propertyType: text(listing.propertyType),
    purpose: text(listing.purpose),
    district: text(listing.district),
    city: text(listing.city),
    area: listing.area ?? "",
    rooms: listing.rooms ?? "",
    priceOrBudget: price == null || price === "" ? "" : price,
    opportunityKind: text(listing.opportunityKind)
  };
}

export function cooperationSettingsExtras(raw = {}) {
  return {
    proximityScope: normalizeProximityScope(raw.proximityScope),
    maxConcurrentRequests: normalizeMaxConcurrent(raw.maxConcurrentRequests),
    notifyNewMatch: raw.notifyNewMatch !== false,
    notifyPartnerReply: raw.notifyPartnerReply !== false,
    notifyActionRequired: raw.notifyActionRequired !== false,
    notifyDealUpdate: raw.notifyDealUpdate !== false,
    defaultSharePercent: Number.isFinite(Number(raw.defaultSharePercent))
      ? Math.max(0, Math.min(100, Number(raw.defaultSharePercent)))
      : DEFAULT_SHARE_PERCENT
  };
}

export function isArchivedCooperation(record = {}) {
  const stage = upper(record.currentStage);
  const status = upper(record.status);
  return ARCHIVE_STAGES.has(stage) || ARCHIVE_STATUSES.has(status);
}

export function actorOfficeForAction(stage, role) {
  const s = upper(stage);
  const r = upper(role);
  if (s === COOPERATION_STAGE.MATCH_FOUND || s === COOPERATION_STAGE.REVIEW) return "origin";
  if (s === COOPERATION_STAGE.WAITING_PARTNER || s === COOPERATION_STAGE.REQUEST_SENT) return "target";
  if (s === COOPERATION_STAGE.CUSTOMER_ACTION) return COOPERATION_ROLE.CLIENT_OFFICE;
  if (s === COOPERATION_STAGE.OWNER_ACTION) return COOPERATION_ROLE.PROPERTY_OFFICE;
  if (s === COOPERATION_STAGE.FOLLOW_UP_AFTER_VIEWING) return r;
  if (s === COOPERATION_STAGE.DEAL_COMPLETION_PENDING) return r;
  if (s === COOPERATION_STAGE.ACCEPTED) return r;
  return "";
}

export function isWaitingOnOtherOffice(stage, role, record = {}, officeId = "") {
  const s = upper(stage);
  if (s === COOPERATION_STAGE.WAITING_PARTNER || s === COOPERATION_STAGE.REQUEST_SENT) {
    return text(officeId).toLowerCase() === text(record.originatingOfficeId).toLowerCase();
  }
  if (s === COOPERATION_STAGE.CUSTOMER_ACTION) return role === COOPERATION_ROLE.PROPERTY_OFFICE;
  if (s === COOPERATION_STAGE.OWNER_ACTION) return role === COOPERATION_ROLE.CLIENT_OFFICE;
  return false;
}

export function sortGroupForCooperation({
  stage,
  role,
  record = {},
  officeId = "",
  now = new Date()
} = {}) {
  if (isArchivedCooperation(record)) return SORT_GROUP.INFORMATIONAL;
  if (record.hasNewResponse === true || (record.newResponseByOffice || {})[officeId] === true) {
    return SORT_GROUP.NEW_RESPONSE;
  }
  const viewing = record.appointmentAt || record.viewingAt;
  if (viewing && upper(stage) === COOPERATION_STAGE.APPOINTMENT_CONFIRMED) {
    const at = new Date(viewing);
    if (Number.isFinite(at.getTime())) {
      const sameDay = at.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" })
        === now.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
      if (sameDay) return SORT_GROUP.TODAY_APPOINTMENT;
    }
  }
  if (isWaitingOnOtherOffice(stage, role, record, officeId)) {
    return SORT_GROUP.WAITING_OTHER_OFFICE;
  }
  const turn = yourTurnFor({ stage, role, record, officeId });
  if (turn.needsAction) return SORT_GROUP.NEEDS_ACTION;
  if (upper(stage) === COOPERATION_STAGE.APPOINTMENT_CONFIRMED) return SORT_GROUP.TODAY_APPOINTMENT;
  return SORT_GROUP.INFORMATIONAL;
}

export function yourTurnFor({ stage, role, record = {}, officeId = "" } = {}) {
  const s = upper(stage) || upper(record.currentStage);
  const r = role || viewerRoleFor(record, officeId);
  const partnerName = partnerOfficeNameFor(record, officeId);
  const waiting = (label) => ({
    needsAction: false,
    label: "",
    waitingLabel: label,
    emptyAction: "لا يوجد إجراء مطلوب منك الآن."
  });

  if (s === COOPERATION_STAGE.MATCH_FOUND || s === COOPERATION_STAGE.REVIEW) {
    if (text(officeId).toLowerCase() === text(record.originatingOfficeId).toLowerCase()) {
      return {
        needsAction: true,
        label: "راجع المطابقة وقرر طلب التعاون.",
        waitingLabel: "",
        emptyAction: ""
      };
    }
    return waiting(waitingPartnerLabel(partnerName));
  }

  if (s === COOPERATION_STAGE.WAITING_PARTNER || s === COOPERATION_STAGE.REQUEST_SENT) {
    if (text(officeId).toLowerCase() === text(record.targetOfficeId).toLowerCase()) {
      return {
        needsAction: true,
        label: "راجع طلب التعاون وقرر القبول أو أنه غير مناسب.",
        waitingLabel: "",
        emptyAction: ""
      };
    }
    return waiting(waitingPartnerLabel(partnerName));
  }

  if (s === COOPERATION_STAGE.ACCEPTED) {
    if (r === COOPERATION_ROLE.CLIENT_OFFICE) {
      return { needsAction: true, label: "متابعة العميل", waitingLabel: "", emptyAction: "" };
    }
    if (cooperationNeedsOwnerOutreach(record)) {
      return { needsAction: true, label: "إرسال للمالك", waitingLabel: "", emptyAction: "" };
    }
    return waiting(partnerName ? `بانتظار ${partnerName} لمتابعة العميل.` : "");
  }

  if (s === COOPERATION_STAGE.CUSTOMER_ACTION) {
    if (r === COOPERATION_ROLE.CLIENT_OFFICE) {
      return { needsAction: true, label: "تحديث نتيجة العميل", waitingLabel: "", emptyAction: "" };
    }
    return waiting(partnerName ? `بانتظار ${partnerName}.` : "");
  }

  if (s === COOPERATION_STAGE.OWNER_ACTION) {
    if (r === COOPERATION_ROLE.PROPERTY_OFFICE) {
      return { needsAction: true, label: "متابعة التنسيق مع المالك", waitingLabel: "", emptyAction: "" };
    }
    return waiting(partnerName ? `بانتظار ${partnerName} لمتابعة التنسيق مع المالك.` : "");
  }

  if (s === COOPERATION_STAGE.APPOINTMENT) {
    return {
      needsAction: true,
      label: "تأكيد وقت المعاينة المتاح",
      waitingLabel: "",
      emptyAction: ""
    };
  }

  if (s === COOPERATION_STAGE.APPOINTMENT_CONFIRMED) {
    return waiting("");
  }

  if (s === COOPERATION_STAGE.FOLLOW_UP_AFTER_VIEWING) {
    if (r === COOPERATION_ROLE.CLIENT_OFFICE) {
      return { needsAction: true, label: "تحديث نتيجة العميل", waitingLabel: "", emptyAction: "" };
    }
    return waiting(waitingPartnerLabel(partnerName) || (partnerName ? `بانتظار ${partnerName}` : ""));
  }

  if (s === COOPERATION_STAGE.PRELIMINARY_AGREEMENT) {
    return {
      needsAction: true,
      label: "تأكيد إغلاق الصفقة",
      waitingLabel: "",
      emptyAction: ""
    };
  }

  if (s === COOPERATION_STAGE.DEAL_COMPLETION_PENDING) {
    const conf = record.completionConfirmations || {};
    if (conf[officeId]) return waiting(`بانتظار تأكيد ${partnerName}`);
    return { needsAction: true, label: "تأكيد إتمام الصفقة", waitingLabel: "", emptyAction: "" };
  }

  if (s === COOPERATION_STAGE.COMPLETED) {
    return { needsAction: false, label: "", waitingLabel: "", emptyAction: "تم إغلاق التعاون بنجاح." };
  }

  if (s === COOPERATION_STAGE.REJECTED) {
    return { needsAction: false, label: "", waitingLabel: "", emptyAction: "لا تعاون نشط." };
  }

  return waiting("");
}

export function applyCooperationWorkflowTransition(record = {}, action, { actorOfficeId = "", now = new Date() } = {}) {
  const act = upper(action);
  const stage = upper(record.currentStage) || COOPERATION_STAGE.MATCH_FOUND;
  const status = upper(record.status) || COOPERATION_RECORD_STATUS.SUGGESTED;
  const actor = text(actorOfficeId).toLowerCase();
  const origin = text(record.originatingOfficeId).toLowerCase();
  const target = text(record.targetOfficeId).toLowerCase();
  const iso = now.toISOString();

  if (!actor || (actor !== origin && actor !== target)) {
    return { ok: false, error: "cooperation_forbidden", message: "هذا المكتب ليس طرفًا في التعاون." };
  }

  if (act === COOPERATION_ACTION.REQUEST) {
    if (actor !== origin) return { ok: false, error: "origin_only", message: "طلب التعاون يصدر من المكتب الذي راجع المطابقة." };
    if (status === COOPERATION_RECORD_STATUS.PENDING || status === COOPERATION_RECORD_STATUS.ACCEPTED) {
      return { ok: true, duplicate: true, patch: null };
    }
    if (status !== COOPERATION_RECORD_STATUS.SUGGESTED && stage !== COOPERATION_STAGE.MATCH_FOUND && stage !== COOPERATION_STAGE.REVIEW) {
      return { ok: false, error: "invalid_stage", message: "لا يمكن إرسال طلب التعاون في هذه الحالة." };
    }
    return {
      ok: true,
      patch: {
        status: COOPERATION_RECORD_STATUS.PENDING,
        currentStage: COOPERATION_STAGE.WAITING_PARTNER,
        requestedAt: iso,
        updatedAt: iso
      }
    };
  }

  if (act === COOPERATION_ACTION.ACCEPT) {
    if (actor !== target) return { ok: false, error: "target_only", message: "قبول التعاون من مكتب الطرف الثاني فقط." };
    if (status === COOPERATION_RECORD_STATUS.ACCEPTED) return { ok: true, duplicate: true, patch: null };
    if (status !== COOPERATION_RECORD_STATUS.PENDING) {
      return { ok: false, error: "not_pending", message: "لا يوجد طلب تعاون معلّق." };
    }
    return {
      ok: true,
      patch: {
        status: COOPERATION_RECORD_STATUS.ACCEPTED,
        currentStage: COOPERATION_STAGE.ACCEPTED,
        acceptedAt: iso,
        updatedAt: iso
      }
    };
  }

  if (act === COOPERATION_ACTION.REJECT) {
    if (actor !== target) return { ok: false, error: "target_only", message: "رفض التعاون من مكتب الطرف الثاني فقط." };
    if (status === COOPERATION_RECORD_STATUS.REJECTED) return { ok: true, duplicate: true, patch: null };
    if (status !== COOPERATION_RECORD_STATUS.PENDING && status !== COOPERATION_RECORD_STATUS.SUGGESTED) {
      return { ok: false, error: "not_pending", message: "لا يمكن رفض هذا التعاون الآن." };
    }
    return {
      ok: true,
      patch: {
        status: COOPERATION_RECORD_STATUS.REJECTED,
        currentStage: COOPERATION_STAGE.REJECTED,
        rejectedAt: iso,
        updatedAt: iso
      }
    };
  }

  if (status !== COOPERATION_RECORD_STATUS.ACCEPTED && status !== COOPERATION_RECORD_STATUS.COMPLETED) {
    if (![COOPERATION_ACTION.CONFIRM_COMPLETION].includes(act)) {
      return { ok: false, error: "not_accepted", message: "يلزم قبول التعاون أولًا." };
    }
  }

  if (act === COOPERATION_ACTION.FOLLOW_CUSTOMER) {
    return { ok: true, patch: { currentStage: COOPERATION_STAGE.CUSTOMER_ACTION, updatedAt: iso } };
  }
  if (act === COOPERATION_ACTION.FOLLOW_OWNER) {
    return { ok: true, patch: { currentStage: COOPERATION_STAGE.OWNER_ACTION, updatedAt: iso } };
  }
  if (act === COOPERATION_ACTION.CUSTOMER_INTERESTED) {
    return {
      ok: true,
      patch: {
        currentStage: COOPERATION_STAGE.OWNER_ACTION,
        customerOutcome: "INTERESTED",
        updatedAt: iso
      }
    };
  }
  if (act === COOPERATION_ACTION.CUSTOMER_NOT_SUITABLE) {
    return {
      ok: true,
      patch: {
        currentStage: COOPERATION_STAGE.FOLLOW_UP_AFTER_VIEWING,
        customerOutcome: "NOT_SUITABLE",
        updatedAt: iso
      }
    };
  }
  if (act === COOPERATION_ACTION.PROPERTY_AVAILABLE) {
    return {
      ok: true,
      patch: {
        currentStage: COOPERATION_STAGE.APPOINTMENT,
        propertyOutcome: "AVAILABLE",
        updatedAt: iso
      }
    };
  }
  if (act === COOPERATION_ACTION.PROPERTY_UNAVAILABLE) {
    return {
      ok: true,
      patch: {
        currentStage: COOPERATION_STAGE.REJECTED,
        status: COOPERATION_RECORD_STATUS.ENDED,
        propertyOutcome: "UNAVAILABLE",
        updatedAt: iso
      }
    };
  }
  if (act === COOPERATION_ACTION.CONFIRM_APPOINTMENT) {
    return {
      ok: true,
      patch: {
        currentStage: COOPERATION_STAGE.APPOINTMENT_CONFIRMED,
        appointmentConfirmedAt: iso,
        updatedAt: iso
      }
    };
  }
  if (act === COOPERATION_ACTION.PRELIMINARY_AGREEMENT) {
    return {
      ok: true,
      patch: {
        currentStage: COOPERATION_STAGE.PRELIMINARY_AGREEMENT,
        updatedAt: iso
      }
    };
  }
  if (act === COOPERATION_ACTION.CONFIRM_COMPLETION) {
    const conf = { ...(record.completionConfirmations || {}) };
    conf[actorOfficeId] = iso;
    const originDone = Boolean(conf[record.originatingOfficeId]);
    const targetDone = Boolean(conf[record.targetOfficeId]);
    const both = originDone && targetDone;
    return {
      ok: true,
      patch: {
        completionConfirmations: conf,
        currentStage: both ? COOPERATION_STAGE.COMPLETED : COOPERATION_STAGE.DEAL_COMPLETION_PENDING,
        status: both ? COOPERATION_RECORD_STATUS.COMPLETED : COOPERATION_RECORD_STATUS.ACCEPTED,
        completedAt: both ? iso : record.completedAt || "",
        updatedAt: iso
      }
    };
  }

  return { ok: false, error: "unknown_action", message: "إجراء غير معروف." };
}

function purposeWord(purpose) {
  const p = upper(purpose);
  if (p === "RENT" || p === "LEASE_REQUEST") return "للإيجار";
  if (p === "SALE" || p === "PURCHASE") return "للبيع";
  return "";
}

export function cooperationPropertyLine(listing = {}) {
  const type = text(listing.propertyType);
  const purpose = purposeWord(listing.purpose);
  const district = text(listing.district).replace(/^حي\s+/u, "");
  const place = district ? `حي ${district}` : "";
  return [type, purpose].filter(Boolean).join(" ") + (place ? ` · ${place}` : "");
}

function moneyLabel(listing = {}) {
  const n = Number(listing.priceOrBudget ?? listing.salePrice ?? listing.budget ?? listing.price);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${n.toLocaleString("en-US")} ر.س`;
}

export function collapsedKindLabel(stage, record = {}, officeId = "") {
  const s = upper(stage);
  const isTarget = text(officeId).toLowerCase() === text(record.targetOfficeId).toLowerCase();
  if ((s === COOPERATION_STAGE.WAITING_PARTNER || s === COOPERATION_STAGE.REQUEST_SENT) && isTarget) {
    return "طلب تعاون جديد";
  }
  if (s === COOPERATION_STAGE.WAITING_PARTNER || s === COOPERATION_STAGE.REQUEST_SENT) return "طلب تعاون";
  if (s === COOPERATION_STAGE.ACCEPTED) return "تم قبول التعاون";
  if (s === COOPERATION_STAGE.APPOINTMENT_CONFIRMED) return "المعاينة مؤكدة";
  if (s === COOPERATION_STAGE.COMPLETED) return "تمت الصفقة ✓";
  if (s === COOPERATION_STAGE.REJECTED) return "التعاون غير مناسب";
  if (s === COOPERATION_STAGE.CUSTOMER_ACTION) return "متابعة العميل";
  if (s === COOPERATION_STAGE.OWNER_ACTION) return "متابعة العقار";
  if (s === COOPERATION_STAGE.PRELIMINARY_AGREEMENT) return "اتفاق مبدئي";
  if (s === COOPERATION_STAGE.DEAL_COMPLETION_PENDING) return "بانتظار تأكيد الإتمام";
  return "مطابقة تعاون جديدة";
}

export function cooperationOwnerContactNeeded(record = {}) {
  return record.ownerContactNeeded === true
    || String(record.ownerContactNeeded || "").toLowerCase() === "true";
}

export function cooperationNeedsOwnerOutreach(record = {}) {
  const stage = upper(record.currentStage) || upper(record.stage);
  const status = upper(record.status);
  return (
    (status === COOPERATION_RECORD_STATUS.ACCEPTED || stage === COOPERATION_STAGE.ACCEPTED)
    && text(record.matchId)
    && cooperationOwnerContactNeeded(record)
  );
}

export function collapsedStatusLabel(stage, turn, partnerName = "") {
  const s = upper(stage);
  if (s === COOPERATION_STAGE.WAITING_PARTNER || s === COOPERATION_STAGE.REQUEST_SENT) {
    if (turn.needsAction) return "تحتاج مراجعتك";
    return waitingPartnerLabel(partnerName) || turn.waitingLabel || "";
  }
  if (s === COOPERATION_STAGE.APPOINTMENT_CONFIRMED) return "لا يوجد إجراء مطلوب الآن.";
  if (s === COOPERATION_STAGE.COMPLETED) return "تم إغلاق التعاون بنجاح.";
  if (turn.needsAction) return "تحتاج مراجعتك";
  return turn.waitingLabel || turn.emptyAction || "لا يوجد إجراء مطلوب منك الآن.";
}

export function cooperationActionsFor({ stage, role, record = {}, officeId = "" } = {}) {
  const r = role || viewerRoleFor(record, officeId);
  const s = upper(stage) || upper(record.currentStage);
  const isTarget = text(officeId).toLowerCase() === text(record.targetOfficeId).toLowerCase();
  const details = { id: "open_details", label: "عرض التفاصيل", variant: "text" };

  if (cooperationNeedsOwnerOutreach(record) && r === COOPERATION_ROLE.PROPERTY_OFFICE) {
    return {
      primaryAction: { id: "send_to_owner", label: "إرسال للمالك" },
      secondaryActions: [details]
    };
  }

  const turn = yourTurnFor({ stage: s, role: r, record, officeId });
  if (!turn.needsAction) return { primaryAction: null, secondaryActions: [] };

  if (s === COOPERATION_STAGE.MATCH_FOUND || s === COOPERATION_STAGE.REVIEW) {
    return {
      primaryAction: { id: "request_cooperation", label: "طلب التعاون" },
      secondaryActions: [details]
    };
  }
  if ((s === COOPERATION_STAGE.WAITING_PARTNER || s === COOPERATION_STAGE.REQUEST_SENT) && isTarget) {
    return {
      primaryAction: { id: "accept_cooperation", label: "قبول التعاون" },
      secondaryActions: [{ id: "reject_cooperation", label: "غير مناسب" }]
    };
  }
  if (s === COOPERATION_STAGE.ACCEPTED && role === COOPERATION_ROLE.CLIENT_OFFICE) {
    return {
      primaryAction: { id: "follow_customer", label: "متابعة العميل" },
      secondaryActions: [details]
    };
  }
  if (s === COOPERATION_STAGE.CUSTOMER_ACTION && role === COOPERATION_ROLE.CLIENT_OFFICE) {
    return {
      primaryAction: { id: "customer_interested", label: "مهتم بالاستمرار" },
      secondaryActions: [{ id: "customer_not_suitable", label: "لم يناسبه" }]
    };
  }
  if (s === COOPERATION_STAGE.OWNER_ACTION && role === COOPERATION_ROLE.PROPERTY_OFFICE) {
    return {
      primaryAction: { id: "property_available", label: "متابعة التنسيق" },
      secondaryActions: [{ id: "property_unavailable", label: "العقار لم يعد متاحًا" }]
    };
  }
  if (s === COOPERATION_STAGE.APPOINTMENT) {
    return {
      primaryAction: { id: "confirm_appointment", label: "تأكيد الموعد" },
      secondaryActions: [details]
    };
  }
  if (s === COOPERATION_STAGE.FOLLOW_UP_AFTER_VIEWING && role === COOPERATION_ROLE.CLIENT_OFFICE) {
    return {
      primaryAction: { id: "customer_interested", label: "مهتم بالاستمرار" },
      secondaryActions: [{ id: "customer_not_suitable", label: "لم يناسبه" }]
    };
  }
  if (s === COOPERATION_STAGE.PRELIMINARY_AGREEMENT || s === COOPERATION_STAGE.DEAL_COMPLETION_PENDING) {
    return {
      primaryAction: { id: "confirm_completion", label: "تأكيد إتمام الصفقة" },
      secondaryActions: [details]
    };
  }
  return { primaryAction: null, secondaryActions: [] };
}

export function cooperationTimeline(record = {}, { officeId = "", partnerName = "", referenceCode = "" } = {}) {
  const name = text(partnerName) || partnerOfficeNameFor(record, officeId);
  const events = [];
  const push = (at, type, actor, label) => {
    if (!at || !label) return;
    events.push({ type, actor, label, createdAt: at, referenceCode });
  };
  push(record.createdAt || record.matchedAt, "match_found", "BROKER", "تم العثور على مطابقة تعاون");
  push(record.requestedAt, "requested", "BROKER", cooperationRequestedLabel(name));
  push(record.acceptedAt, "accepted", "PARTNER_OFFICE", name ? `${name} قبل التعاون` : "تم قبول التعاون");
  push(record.rejectedAt, "rejected", "PARTNER_OFFICE", name ? `${name} اعتبر التعاون غير مناسب` : "التعاون غير مناسب");
  push(record.appointmentConfirmedAt, "appointment", "BROKER", "موعد مؤكد");
  push(record.completedAt, "completed", "BROKER", "تم إتمام الصفقة");
  const extra = Array.isArray(record.livingTimeline) ? record.livingTimeline : [];
  for (const event of extra) {
    if (event?.label) events.push({ ...event, referenceCode: event.referenceCode || referenceCode });
  }
  return events.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function matchReasonLines(record = {}) {
  const lines = [];
  if (record.proximityLabel) lines.push(record.proximityLabel);
  const reasons = Array.isArray(record.matchReasons) ? record.matchReasons : [];
  for (const reason of reasons.slice(0, 4)) {
    const line = text(reason);
    if (line && !/score|id|token|phone/i.test(line) && !lines.includes(line)) lines.push(line);
  }
  if (!lines.length && record.compatibilityLabel) lines.push(record.compatibilityLabel);
  return lines;
}

export function appointmentWhenLabel(record = {}, now = new Date()) {
  const at = record.appointmentAt || record.viewingAt;
  if (!at) return "";
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("ar-SA", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Riyadh"
  });
}

export function buildCooperationDailyTaskView(record = {}, { officeId = "", now = new Date() } = {}) {
  const id = livingCooperationTaskId(record.cooperationTaskId || record.cooperationId || record.id);
  const stage = upper(record.currentStage) || COOPERATION_STAGE.MATCH_FOUND;
  const role = viewerRoleFor(record, officeId);
  const turn = yourTurnFor({ stage, role, record, officeId });
  const originListing = publicListingSlice(record.originListing || record.ownListing || {});
  const counterpartListing = publicListingSlice(record.counterpartListing || record.partnerListing || {});
  const isOriginViewer = text(officeId).toLowerCase() === text(record.originatingOfficeId).toLowerCase();
  const ownListing = isOriginViewer ? originListing : counterpartListing;
  const partnerListing = isOriginViewer ? counterpartListing : originListing;
  const listing = text(officeId).toLowerCase() === text(record.originatingOfficeId).toLowerCase()
    ? ownListing
    : partnerListing;
  const isPropertyViewer = text(officeId).toLowerCase() === text(record.propertyOfficeId).toLowerCase();
  const isClientViewer = text(officeId).toLowerCase() === text(record.clientOfficeId).toLowerCase();
  const resolvedOfferId = text(
    record.offerId
    || record.ownerOfferId
    || (isPropertyViewer
      ? (record.originOpportunityId || record.opportunityId || record.counterpartOpportunityId)
      : (record.counterpartOpportunityId || record.originOpportunityId))
  );
  const resolvedRequestId = text(
    record.requestId
    || record.clientRequestId
    || (isClientViewer
      ? (record.originOpportunityId || record.opportunityId || record.counterpartOpportunityId)
      : (record.counterpartOpportunityId || record.originOpportunityId))
  );
  const { primaryAction, secondaryActions } = cooperationActionsFor({ stage, role, record, officeId });
  const sortGroup = sortGroupForCooperation({ stage, role, record, officeId, now });
  const partnerName = partnerOfficeNameFor(record, officeId);
  const isTarget = text(officeId).toLowerCase() === text(record.targetOfficeId).toLowerCase();
  const inbound = (stage === COOPERATION_STAGE.WAITING_PARTNER || stage === COOPERATION_STAGE.REQUEST_SENT) && isTarget;
  const propertyLine = cooperationPropertyLine(listing.propertyType ? listing : ownListing);
  const when = appointmentWhenLabel(record, now);

  const referenceCode = formatCooperationReference(id);
  let partnerLine = "";
  if (partnerName) {
    if (inbound) partnerLine = `من:\n${partnerName}`;
    else if (stage === COOPERATION_STAGE.WAITING_PARTNER || stage === COOPERATION_STAGE.REQUEST_SENT) {
      partnerLine = waitingPartnerLabel(partnerName);
    } else {
      partnerLine = `المكتب المقترح:\n${partnerName}`;
    }
  }

  const proximityBits = [record.proximityLabel, record.compatibilityLabel].filter(Boolean).join(" · ");
  let summaryExtra = partnerLine;
  if (stage === COOPERATION_STAGE.APPOINTMENT_CONFIRMED && when) summaryExtra = when;
  if (inbound && partnerName) {
    summaryExtra = propertyLine
      ? `${propertyLine}\nمن:\n${partnerName}`
      : `من:\n${partnerName}`;
  }
  const yourTurnLine = turn.needsAction
    ? (stage === COOPERATION_STAGE.MATCH_FOUND || stage === COOPERATION_STAGE.REVIEW
      ? "راجع التعاون"
      : turn.label)
    : (turn.waitingLabel || turn.emptyAction);

  return {
    id,
    taskKind: "cooperation",
    cooperationTaskId: id,
    cooperationId: id,
    workflowId: id,
    referenceCode,
    stateKey: "cooperation",
    kindLabel: collapsedKindLabel(stage, record, officeId),
    badgeKey: sortGroup === SORT_GROUP.NEEDS_ACTION ? "now"
      : sortGroup === SORT_GROUP.TODAY_APPOINTMENT ? "today"
        : "",
    badgeLabel: sortGroup === SORT_GROUP.NEEDS_ACTION ? "الآن"
      : sortGroup === SORT_GROUP.TODAY_APPOINTMENT ? "اليوم"
        : "",
    propertyType: text(listing.propertyType || ownListing.propertyType),
    purpose: text(listing.purpose || ownListing.purpose),
    city: text(listing.city || ownListing.city),
    district: text(listing.district || ownListing.district),
    priceOrBudget: moneyLabel(listing.propertyType ? listing : ownListing),
    propertyLine: inbound ? propertyLine : propertyLine,
    moneyLine: "",
    partnerLine: summaryExtra,
    proximityLine: inbound ? "" : proximityBits,
    statusLabel: collapsedStatusLabel(stage, turn, partnerName),
    nextActionLine: turn.needsAction ? "دورك الآن" : (turn.waitingLabel || ""),
    yourTurnLine,
    waiting: !turn.needsAction,
    requiresAction: Boolean(turn.needsAction),
    requiresActionBy: turn.needsAction ? "BROKER" : (turn.waitingLabel ? "PARTNER_OFFICE" : "NONE"),
    primaryAction,
    secondaryActions,
    matchId: text(record.matchId),
    offerId: resolvedOfferId,
    requestId: resolvedRequestId,
    opportunityId: text(record.opportunityId || record.originOpportunityId),
    counterpartOpportunityId: text(record.counterpartOpportunityId),
    clientPhone: "",
    ownerPhone: "",
    clientName: "",
    ownerName: "",
    sessionKind: "",
    exposeCounterpartyContact: false,
    sortGroup,
    priorityGroup: sortGroup === SORT_GROUP.NEEDS_ACTION ? "action_now"
      : sortGroup === SORT_GROUP.NEW_RESPONSE ? "new_reply"
        : sortGroup === SORT_GROUP.TODAY_APPOINTMENT ? "appointment_today"
          : sortGroup === SORT_GROUP.WAITING_OTHER_OFFICE ? "awaiting_reply"
            : "closed",
    currentStage: stage,
    livingStage: stage,
    viewerRole: role,
    viewerRoleLabel: COOPERATION_ROLE_LABELS[role],
    partnerOfficeName: partnerName,
    partnerOfficeId: isOriginViewer ? text(record.targetOfficeId) : text(record.originatingOfficeId),
    ownListing,
    partnerListing,
    matchReasons: matchReasonLines(record),
    ownMoney: moneyLabel(ownListing),
    partnerMoney: moneyLabel(partnerListing),
    timeline: cooperationTimeline(record, { officeId, partnerName, referenceCode }),
    revealClosedLabel: inbound ? "مراجعة التعاون" : "فتح التعاون",
    revealOpenLabel: "إخفاء",
    appointmentWhen: when,
    archived: isArchivedCooperation({ ...record, currentStage: stage }),
    originatingOfficeId: text(record.originatingOfficeId),
    targetOfficeId: text(record.targetOfficeId),
    livingUpdatedAt: text(record.updatedAt || record.requestedAt || record.createdAt),
    hasNewResponse: Boolean(record.hasNewResponse)
  };
}

export function summarizeCooperationHistory(rows = [], { officeId = "" } = {}) {
  const byOffice = new Map();
  for (const row of rows) {
    if (!row) continue;
    const self = text(officeId).toLowerCase();
    const origin = text(row.originatingOfficeId).toLowerCase();
    const target = text(row.targetOfficeId).toLowerCase();
    const partnerId = self === origin ? target : origin;
    const partnerName = partnerOfficeNameFor(row, officeId) || partnerId;
    if (!partnerId) continue;
    if (!byOffice.has(partnerId)) {
      byOffice.set(partnerId, { partnerOfficeId: partnerId, partnerName, active: 0, waiting: 0, completed: 0 });
    }
    const bucket = byOffice.get(partnerId);
    const status = upper(row.status);
    const stage = upper(row.currentStage);
    if (status === "PENDING" || stage === COOPERATION_STAGE.WAITING_PARTNER) bucket.waiting += 1;
    if (!isArchivedCooperation(row) && status !== "SUGGESTED") bucket.active += 1;
    if (isArchivedCooperation(row)) bucket.completed += 1;
  }
  return [...byOffice.values()].filter((row) => row.active || row.waiting);
}

export function cooperationHistorySummaryLine(row) {
  const bits = [];
  if (row.active) bits.push(`${row.active} تعاونات نشطة`);
  if (row.waiting) bits.push(`${row.waiting} بانتظار رد`);
  return bits.join(" · ");
}

const WORKFLOW_ACTION_BY_BUTTON = Object.freeze({
  request_cooperation: COOPERATION_ACTION.REQUEST,
  accept_cooperation: COOPERATION_ACTION.ACCEPT,
  reject_cooperation: COOPERATION_ACTION.REJECT,
  follow_customer: COOPERATION_ACTION.FOLLOW_CUSTOMER,
  follow_owner: COOPERATION_ACTION.FOLLOW_OWNER,
  customer_interested: COOPERATION_ACTION.CUSTOMER_INTERESTED,
  customer_not_suitable: COOPERATION_ACTION.CUSTOMER_NOT_SUITABLE,
  property_available: COOPERATION_ACTION.PROPERTY_AVAILABLE,
  property_unavailable: COOPERATION_ACTION.PROPERTY_UNAVAILABLE,
  confirm_appointment: COOPERATION_ACTION.CONFIRM_APPOINTMENT,
  preliminary_agreement: COOPERATION_ACTION.PRELIMINARY_AGREEMENT,
  confirm_completion: COOPERATION_ACTION.CONFIRM_COMPLETION
});

export function workflowActionFromButton(buttonId) {
  return WORKFLOW_ACTION_BY_BUTTON[buttonId] || "";
}

export async function requestCooperationWorkflow({
  workerBase,
  idToken,
  officeId,
  cooperationId,
  action,
  reason = "",
  fetchImpl = globalThis.fetch
} = {}) {
  if (!workerBase) return { ok: false, error: "worker_base_required", message: "تعذر الاتصال بالخادم." };
  if (!idToken) return { ok: false, error: "auth_required", message: "سجل الدخول ثم أعد المحاولة." };
  const response = await fetchImpl(new URL(COOPERATION_WORKFLOW_PATH, workerBase).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({
      officeId: text(officeId),
      cooperationId: text(cooperationId),
      action: upper(action),
      reason: text(reason).slice(0, 200)
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    return {
      ok: false,
      error: payload.error || "cooperation_workflow_failed",
      message: payload.message || "تعذر حفظ حالة التعاون. أبقينا الحالة السابقة.",
      status: response.status,
      payload
    };
  }
  return { ok: true, ...payload };
}
