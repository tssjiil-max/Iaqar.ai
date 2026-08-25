/**
 * Match grouping + living daily-task state.
 * A match is a relationship (requestId ↔ offerId), not a property copy.
 * One living task per source opportunity group.
 */

export const LIVING_TASK_STAGE = Object.freeze({
  MATCH_FOUND: "MATCH_FOUND",
  BROKER_REVIEW: "BROKER_REVIEW",
  CLIENT_SENT: "CLIENT_SENT",
  WAITING_CLIENT: "WAITING_CLIENT",
  CLIENT_NEEDS_DETAILS: "CLIENT_NEEDS_DETAILS",
  CLIENT_NEEDS_MISSING_INFO: "CLIENT_NEEDS_MISSING_INFO",
  CLIENT_INTERESTED: "CLIENT_INTERESTED",
  CLIENT_REJECTED: "CLIENT_REJECTED",
  WAITING_PROPERTY_CONFIRMATION: "WAITING_PROPERTY_CONFIRMATION",
  PROPERTY_AVAILABLE: "PROPERTY_AVAILABLE",
  PROPERTY_UNAVAILABLE: "PROPERTY_UNAVAILABLE",
  VIEWING_DECISION: "VIEWING_DECISION",
  APPOINTMENT_COORDINATION: "APPOINTMENT_COORDINATION",
  APPOINTMENT_CONFIRMED: "APPOINTMENT_CONFIRMED",
  FOLLOW_UP: "FOLLOW_UP",
  COMPLETED: "COMPLETED",
  MATCH_EXHAUSTED: "MATCH_EXHAUSTED"
});

export const TASK_SORT_GROUP = Object.freeze({
  NEEDS_BROKER_ACTION: "NEEDS_BROKER_ACTION",
  NEW_EXTERNAL_RESPONSE: "NEW_EXTERNAL_RESPONSE",
  TODAY_APPOINTMENT: "TODAY_APPOINTMENT",
  WAITING_EXTERNAL_PARTY: "WAITING_EXTERNAL_PARTY",
  PASSIVE_STATUS: "PASSIVE_STATUS"
});

export const TASK_SORT_GROUP_RANK = Object.freeze({
  NEEDS_BROKER_ACTION: 1,
  NEW_EXTERNAL_RESPONSE: 2,
  TODAY_APPOINTMENT: 3,
  WAITING_EXTERNAL_PARTY: 4,
  PASSIVE_STATUS: 5
});

export const LIVING_TASK_ID_PREFIX = "mg_";

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function list(value) {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  const raw = text(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => text(item)).filter(Boolean);
  } catch {
    /* ignore */
  }
  return raw.split(",").map((item) => text(item)).filter(Boolean);
}

export function livingTaskId(groupKey) {
  const key = text(groupKey).replace(/[^A-Za-z0-9_-]/g, "_");
  return key ? `${LIVING_TASK_ID_PREFIX}${key}` : "";
}

export function isRequestSource(item = {}) {
  const kind = upper(item.opportunityKind || item.kind || item.sourceKind);
  const collection = text(item.sourceCollection).toLowerCase();
  const contact = text(item.contactType).toLowerCase();
  if (collection === "clients" || contact === "client") return true;
  if (collection === "owners" || contact === "owner") return false;
  if (kind === "REQUEST" || kind === "CLIENT" || kind === "CLIENT_REQUEST") return true;
  if (kind === "OFFER" || kind === "OWNER" || kind === "OWNER_OFFER") return false;
  return Boolean(text(item.clientRequestId || item.requestId));
}

export function matchGroupKey(item = {}) {
  const explicit = text(item.matchGroupId || item.groupKey);
  if (explicit) return explicit;
  const requestId = text(item.clientRequestId || item.requestId);
  const offerId = text(item.ownerOfferId || item.offerId);
  const sourceId = text(item.opportunityId || item.sourceRecordId);
  if (isRequestSource(item)) return requestId || sourceId || offerId;
  return offerId || sourceId || requestId || text(item.matchId);
}

export function candidateScore(item = {}) {
  const opportunityScore = Number(item.opportunityScore || item.metadata?.opportunityScore || 0);
  const score = Number(item.score || item.metadata?.score || 0);
  if (opportunityScore > 0) return opportunityScore;
  return score;
}

export function rankMatchCandidates(items = []) {
  return [...items].sort((a, b) => {
    const best = Number(Boolean(b.isBestOpportunity)) - Number(Boolean(a.isBestOpportunity));
    if (best !== 0) return best;
    const score = candidateScore(b) - candidateScore(a);
    if (score !== 0) return score;
    return text(a.matchId).localeCompare(text(b.matchId));
  });
}

function livingFromItem(item = {}) {
  const meta = item.livingTask && typeof item.livingTask === "object"
    ? item.livingTask
    : (item.metadata && typeof item.metadata === "object" ? item.metadata : {});
  return {
    matchId: text(item.matchId || (String(item.recordType || "").toLowerCase() === "match" ? item.recordId || item.id : "")),
    stage: upper(item.livingStage || meta.livingStage || LIVING_TASK_STAGE.MATCH_FOUND),
    rejectedMatchIds: list(item.rejectedMatchIds || meta.rejectedMatchIds),
    activeMatchId: text(item.activeMatchId || meta.activeMatchId),
    missingInfoKey: text(item.missingInfoKey || meta.missingInfoKey),
    ownerContactNeeded: Boolean(item.ownerContactNeeded || meta.ownerContactNeeded),
    updatedAt: text(item.livingUpdatedAt || meta.livingUpdatedAt || item.updatedAt || item.replyAt || "")
  };
}

export function mergeMatchGroupLivingState(members = []) {
  const rejected = new Set();
  let latest = null;
  for (const member of members) {
    const living = livingFromItem(member);
    for (const id of living.rejectedMatchIds) rejected.add(id);
    if (living.stage === LIVING_TASK_STAGE.CLIENT_REJECTED && living.matchId) {
      rejected.add(living.matchId);
    }
    if (living.stage === LIVING_TASK_STAGE.PROPERTY_UNAVAILABLE && living.matchId) {
      rejected.add(living.matchId);
    }
    if (!latest || String(living.updatedAt) > String(latest.updatedAt)) latest = living;
  }
  const remaining = rankMatchCandidates(
    members.filter((item) => {
      const id = text(item.matchId || item.recordId || item.id);
      return id && !rejected.has(id);
    })
  );
  const active = remaining[0] || null;
  const latestStage = latest?.stage || LIVING_TASK_STAGE.MATCH_FOUND;
  let stage = latestStage;
  if (!remaining.length && (latestStage === LIVING_TASK_STAGE.CLIENT_REJECTED
    || latestStage === LIVING_TASK_STAGE.PROPERTY_UNAVAILABLE)) {
    stage = LIVING_TASK_STAGE.MATCH_EXHAUSTED;
  } else if (remaining.length && (latestStage === LIVING_TASK_STAGE.CLIENT_REJECTED
    || latestStage === LIVING_TASK_STAGE.PROPERTY_UNAVAILABLE)) {
    stage = LIVING_TASK_STAGE.MATCH_FOUND;
  }
  return {
    stage,
    rejectedMatchIds: [...rejected],
    activeMatchId: text(active?.matchId || latest?.activeMatchId || ""),
    remaining,
    missingInfoKey: latest?.missingInfoKey || "",
    ownerContactNeeded: Boolean(latest?.ownerContactNeeded)
      || stage === LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION
      || stage === LIVING_TASK_STAGE.APPOINTMENT_COORDINATION
      || stage === LIVING_TASK_STAGE.VIEWING_DECISION,
    hasNextCandidate: remaining.length > 1
  };
}

export function groupMatchItems(items = []) {
  const groups = new Map();
  for (const item of items) {
    const key = matchGroupKey(item);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].map(([groupKey, members]) => {
    const unique = [];
    const seen = new Set();
    for (const member of members) {
      const id = text(member.matchId || member.recordId || member.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      unique.push(member);
    }
    const living = mergeMatchGroupLivingState(unique);
    return {
      groupKey,
      taskId: livingTaskId(groupKey),
      members: rankMatchCandidates(unique),
      living
    };
  });
}

export function sortGroupForLivingStage(stage, { overdue = false, appointmentToday = false } = {}) {
  if (appointmentToday || stage === LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED) {
    return TASK_SORT_GROUP.TODAY_APPOINTMENT;
  }
  if (overdue) return TASK_SORT_GROUP.NEEDS_BROKER_ACTION;
  const key = upper(stage);
  if (
    key === LIVING_TASK_STAGE.MATCH_FOUND
    || key === LIVING_TASK_STAGE.BROKER_REVIEW
    || key === LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO
    || key === LIVING_TASK_STAGE.PROPERTY_AVAILABLE
    || key === LIVING_TASK_STAGE.VIEWING_DECISION
    || key === LIVING_TASK_STAGE.APPOINTMENT_COORDINATION
  ) {
    return TASK_SORT_GROUP.NEEDS_BROKER_ACTION;
  }
  if (key === LIVING_TASK_STAGE.CLIENT_INTERESTED || key === LIVING_TASK_STAGE.CLIENT_NEEDS_DETAILS) {
    return TASK_SORT_GROUP.NEW_EXTERNAL_RESPONSE;
  }
  if (
    key === LIVING_TASK_STAGE.CLIENT_SENT
    || key === LIVING_TASK_STAGE.WAITING_CLIENT
    || key === LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION
  ) {
    return TASK_SORT_GROUP.WAITING_EXTERNAL_PARTY;
  }
  return TASK_SORT_GROUP.PASSIVE_STATUS;
}

export function livingCopy(stage, {
  missingInfoKey = "",
  hasNextCandidate = false,
  appointmentLine = ""
} = {}) {
  const key = upper(stage);
  if (key === LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO) {
    const label = missingInfoLabel(missingInfoKey);
    return {
      kindLabel: "العميل يحتاج معلومة",
      statusLabel: label ? `${label} غير متوفر` : "معلومة غير متوفرة",
      happenedLine: "العميل يحتاج معلومة",
      turnLine: "دورك الآن",
      nextActionLine: "استكمال المعلومة",
      revealClosedLabel: "عرض البيانات"
    };
  }
  if (key === LIVING_TASK_STAGE.WAITING_CLIENT || key === LIVING_TASK_STAGE.CLIENT_SENT) {
    return {
      kindLabel: "بانتظار رد العميل",
      statusLabel: "",
      happenedLine: "",
      turnLine: "",
      nextActionLine: "",
      revealClosedLabel: "عرض البيانات"
    };
  }
  if (key === LIVING_TASK_STAGE.CLIENT_INTERESTED) {
    return {
      kindLabel: "العميل مهتم",
      statusLabel: "",
      happenedLine: "✓ العميل مهتم",
      turnLine: "",
      nextActionLine: "",
      revealClosedLabel: "عرض البيانات"
    };
  }
  if (key === LIVING_TASK_STAGE.CLIENT_NEEDS_DETAILS) {
    return {
      kindLabel: "العميل يحتاج تفاصيل",
      statusLabel: "العميل يحتاج تفاصيل أكثر",
      happenedLine: "",
      turnLine: "",
      nextActionLine: "",
      revealClosedLabel: "عرض البيانات"
    };
  }
  if (key === LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION) {
    return {
      kindLabel: "بانتظار تأكيد المالك",
      statusLabel: "",
      happenedLine: "العميل مهتم",
      turnLine: "",
      nextActionLine: "",
      revealClosedLabel: "عرض البيانات"
    };
  }
  if (key === LIVING_TASK_STAGE.PROPERTY_AVAILABLE) {
    return {
      kindLabel: "العقار متاح",
      statusLabel: "",
      happenedLine: "المالك أكد التوفر",
      turnLine: "دورك الآن",
      nextActionLine: "متابعة المعاينة",
      revealClosedLabel: "عرض البيانات"
    };
  }
  if (key === LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED) {
    return {
      kindLabel: appointmentLine ? `الموعد مؤكد — ${appointmentLine}` : "الموعد مؤكد",
      statusLabel: "",
      happenedLine: "",
      turnLine: "",
      nextActionLine: "",
      revealClosedLabel: "عرض البيانات"
    };
  }
  if (key === LIVING_TASK_STAGE.MATCH_FOUND && hasNextCandidate) {
    return {
      kindLabel: "مطابقة جديدة",
      statusLabel: "المطابقة الأولى غير مناسبة",
      happenedLine: "المطابقة الأولى غير مناسبة",
      turnLine: "دورك الآن",
      nextActionLine: "يوجد عرض آخر مناسب",
      revealClosedLabel: "مراجعة العرض التالي"
    };
  }
  return {
    kindLabel: "مطابقة جديدة",
    statusLabel: "تم العثور على مطابقة",
    happenedLine: "تم العثور على مطابقة",
    turnLine: "دورك الآن",
    nextActionLine: "",
    revealClosedLabel: "مراجعة المطابقات"
  };
}

export function missingInfoLabel(key = "") {
  const id = text(key).toLowerCase();
  if (id === "price" || id === "detail_price") return "السعر";
  if (id === "location" || id === "detail_location") return "الموقع";
  if (id === "photos" || id === "detail_photos") return "الصور";
  if (id === "specs" || id === "detail_specs") return "المواصفات";
  if (id === "other" || id === "detail_other") return "تفاصيل إضافية";
  return "";
}

export const DETAIL_ACTION_FIELDS = Object.freeze({
  detail_price: ["priceLabel"],
  detail_location: ["locationUrl", "locationLabel"],
  detail_photos: ["photos", "photoCount", "mediaPaths"],
  detail_specs: ["specs", "areaLabel", "streetWidthLabel", "facade", "plotNumber", "description"],
  detail_other: []
});

export function snapshotHasPermittedDetail(snapshot = {}, actionId = "") {
  const fields = DETAIL_ACTION_FIELDS[actionId];
  if (!fields) return false;
  if (!fields.length) return false;
  return fields.some((field) => {
    const value = snapshot[field];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "number") return value > 0;
    return Boolean(text(value));
  });
}

export function livingStageAfterPartyAction({
  party = "client",
  action = "",
  followUp = false,
  snapshot = {},
  hasNextCandidate = false
} = {}) {
  const id = text(action);
  if (party === "owner") {
    if (id === "property_available") return { stage: LIVING_TASK_STAGE.PROPERTY_AVAILABLE, ownerContactNeeded: false };
    if (id === "not_available") {
      return {
        stage: hasNextCandidate ? LIVING_TASK_STAGE.MATCH_FOUND : LIVING_TASK_STAGE.MATCH_EXHAUSTED,
        rejectCandidate: true
      };
    }
    if (id === "confirm_appointment") return { stage: LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED };
    return { stage: LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION };
  }
  if (id === "interested") {
    return { stage: LIVING_TASK_STAGE.CLIENT_INTERESTED, ownerContactNeeded: false };
  }
  if (id === "not_suitable") {
    return {
      stage: hasNextCandidate ? LIVING_TASK_STAGE.MATCH_FOUND : LIVING_TASK_STAGE.MATCH_EXHAUSTED,
      rejectCandidate: true
    };
  }
  if (id === "needs_details") {
    return { stage: LIVING_TASK_STAGE.CLIENT_NEEDS_DETAILS, ownerContactNeeded: false };
  }
  if (id === "want_viewing") {
    return {
      stage: LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION,
      ownerContactNeeded: true
    };
  }
  if (id === "info_sufficient") {
    return { stage: LIVING_TASK_STAGE.CLIENT_INTERESTED, ownerContactNeeded: false };
  }
  if (followUp && id.startsWith("detail_")) {
    if (snapshotHasPermittedDetail(snapshot, id)) {
      return {
        stage: LIVING_TASK_STAGE.CLIENT_NEEDS_DETAILS,
        revealed: true,
        missingInfoKey: "",
        ownerContactNeeded: false
      };
    }
    return {
      stage: LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO,
      missingInfoKey: id,
      ownerContactNeeded: false
    };
  }
  return { stage: LIVING_TASK_STAGE.WAITING_CLIENT };
}

export function formatCandidateCountLine(count, sourceIsRequest = true) {
  const n = Number(count || 0);
  if (n <= 0) return "";
  if (sourceIsRequest) {
    return n === 1 ? "عرض مناسب واحد" : `${n} عروض مناسبة`;
  }
  return n === 1 ? "طلب مناسب واحد" : `${n} طلبات مناسبة`;
}

export function formatBestResultLine({ money = "", area = "" } = {}) {
  const bits = [text(money), text(area)].filter(Boolean);
  if (!bits.length) return "";
  return `أفضل نتيجة:\n${bits.join(" · ")}`;
}
