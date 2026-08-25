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
  NEW_COOPERATION_RESPONSE: "NEW_COOPERATION_RESPONSE",
  WAITING_EXTERNAL_PARTY: "WAITING_EXTERNAL_PARTY",
  PASSIVE_STATUS: "PASSIVE_STATUS"
});

export const TASK_SORT_GROUP_RANK = Object.freeze({
  NEEDS_BROKER_ACTION: 1,
  NEW_EXTERNAL_RESPONSE: 2,
  TODAY_APPOINTMENT: 3,
  NEW_COOPERATION_RESPONSE: 4,
  WAITING_EXTERNAL_PARTY: 5,
  PASSIVE_STATUS: 6
});

export const TASK_ACTOR = Object.freeze({
  BROKER: "BROKER",
  CLIENT: "CLIENT",
  OWNER: "OWNER",
  PARTNER_OFFICE: "PARTNER_OFFICE",
  NONE: "NONE"
});

export const LIVING_TASK_ID_PREFIX = "mg_";

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function parseLivingTimeline(raw) {
  if (Array.isArray(raw)) {
    return raw.map(normalizeTimelineEvent).filter(Boolean);
  }
  const source = text(raw);
  if (!source) return [];
  try {
    const parsed = JSON.parse(source);
    return Array.isArray(parsed) ? parsed.map(normalizeTimelineEvent).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeTimelineEvent(event = {}) {
  const label = text(event.label || event.note);
  if (!label) return null;
  return {
    type: text(event.type || event.eventType || "event"),
    actor: upper(event.actor || event.createdBy || "") || TASK_ACTOR.BROKER,
    label,
    createdAt: text(event.createdAt || event.at || "")
  };
}

export function mergeTimelines(groups = []) {
  const seen = new Set();
  const out = [];
  for (const group of groups) {
    for (const event of parseLivingTimeline(group)) {
      const key = `${event.createdAt}|${event.type}|${event.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(event);
    }
  }
  return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(-40);
}

export function appendLivingTimeline(existing, event, { now = new Date() } = {}) {
  const next = normalizeTimelineEvent({
    ...event,
    createdAt: text(event?.createdAt) || now.toISOString()
  });
  if (!next) return parseLivingTimeline(existing);
  return mergeTimelines([existing, [next]]);
}

export function nextActorForLivingStage(stage, { ownerContactNeeded = false } = {}) {
  const key = upper(stage);
  if (ownerContactNeeded && key !== LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION) {
    return TASK_ACTOR.BROKER;
  }
  if (
    key === LIVING_TASK_STAGE.MATCH_FOUND
    || key === LIVING_TASK_STAGE.BROKER_REVIEW
    || key === LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO
    || key === LIVING_TASK_STAGE.PROPERTY_AVAILABLE
    || key === LIVING_TASK_STAGE.VIEWING_DECISION
    || key === LIVING_TASK_STAGE.APPOINTMENT_COORDINATION
    || key === LIVING_TASK_STAGE.FOLLOW_UP
    || key === LIVING_TASK_STAGE.CLIENT_INTERESTED
  ) {
    return TASK_ACTOR.BROKER;
  }
  if (key === LIVING_TASK_STAGE.CLIENT_SENT || key === LIVING_TASK_STAGE.WAITING_CLIENT) {
    return TASK_ACTOR.CLIENT;
  }
  if (key === LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION) return TASK_ACTOR.OWNER;
  if (key === LIVING_TASK_STAGE.COMPLETED || key === LIVING_TASK_STAGE.MATCH_EXHAUSTED) {
    return TASK_ACTOR.NONE;
  }
  return TASK_ACTOR.BROKER;
}

export function partyReplyTimelineLabel(party, action) {
  const side = text(party).toLowerCase();
  const id = text(action);
  if (side === "owner") {
    if (id === "property_available") return "المالك أكد أن العقار متاح";
    if (id === "not_available") return "المالك أبلغ أن العقار غير متاح";
    if (id === "confirm_appointment") return "المالك أكد موعد المعاينة";
    if (id === "opened") return "فتح المالك الرابط";
    return "المالك رد على المعاينة";
  }
  if (id === "interested") return "العميل مهتم بالعقار";
  if (id === "needs_details") return "العميل طلب تفاصيل أكثر";
  if (id === "not_suitable") return "العميل اعتبر المطابقة غير مناسبة";
  if (id === "want_viewing") return "العميل طلب معاينة";
  if (id === "info_sufficient") return "العميل أكد أن التفاصيل كافية";
  if (id === "opened") return "فتح العميل الرابط";
  if (id.startsWith("detail_")) return "العميل طلب تفاصيل أكثر";
  return "العميل رد على المعاينة";
}

export function livingStatusLabel(stage) {
  const key = upper(stage);
  if (key === LIVING_TASK_STAGE.WAITING_CLIENT || key === LIVING_TASK_STAGE.CLIENT_SENT) {
    return "بانتظار العميل";
  }
  if (key === LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION) return "بانتظار المالك";
  if (key === LIVING_TASK_STAGE.APPOINTMENT_COORDINATION || key === LIVING_TASK_STAGE.VIEWING_DECISION) {
    return "موعد تحت التنسيق";
  }
  if (key === LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED) return "موعد مؤكد";
  if (key === LIVING_TASK_STAGE.FOLLOW_UP) return "قيد المتابعة";
  if (key === LIVING_TASK_STAGE.COMPLETED) return "الصفقة مكتملة";
  if (key === LIVING_TASK_STAGE.CLIENT_REJECTED || key === LIVING_TASK_STAGE.MATCH_EXHAUSTED) {
    return "المطابقة غير مناسبة";
  }
  if (key === LIVING_TASK_STAGE.CLIENT_INTERESTED) return "قيد المتابعة";
  if (key === LIVING_TASK_STAGE.PROPERTY_AVAILABLE) return "قيد المتابعة";
  if (key === LIVING_TASK_STAGE.MATCH_FOUND || key === LIVING_TASK_STAGE.BROKER_REVIEW) {
    return "تم العثور على مطابقة";
  }
  return "";
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
    hasNewResponse: Boolean(item.hasNewResponse || meta.hasNewResponse),
    nextActor: upper(item.nextActor || meta.nextActor || ""),
    timeline: parseLivingTimeline(item.livingTimeline || item.livingTimelineJson || meta.livingTimeline || meta.livingTimelineJson),
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
      && stage !== LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION
      && stage !== LIVING_TASK_STAGE.WAITING_CLIENT
      && stage !== LIVING_TASK_STAGE.CLIENT_SENT,
    hasNewResponse: Boolean(latest?.hasNewResponse),
    nextActor: latest?.nextActor || nextActorForLivingStage(stage, {
      ownerContactNeeded: Boolean(latest?.ownerContactNeeded)
    }),
    timeline: mergeTimelines(members.map((item) => livingFromItem(item).timeline)),
    livingUpdatedAt: latest?.updatedAt || "",
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

export function sortGroupForLivingStage(stage, {
  overdue = false,
  appointmentToday = false,
  ownerContactNeeded = false,
  hasNewResponse = false
} = {}) {
  if (appointmentToday || stage === LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED) {
    return TASK_SORT_GROUP.TODAY_APPOINTMENT;
  }
  if (overdue) return TASK_SORT_GROUP.NEEDS_BROKER_ACTION;
  const key = upper(stage);
  if (ownerContactNeeded && key === LIVING_TASK_STAGE.CLIENT_INTERESTED) {
    return TASK_SORT_GROUP.NEEDS_BROKER_ACTION;
  }
  if (
    key === LIVING_TASK_STAGE.MATCH_FOUND
    || key === LIVING_TASK_STAGE.BROKER_REVIEW
    || key === LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO
    || key === LIVING_TASK_STAGE.PROPERTY_AVAILABLE
    || key === LIVING_TASK_STAGE.VIEWING_DECISION
    || key === LIVING_TASK_STAGE.APPOINTMENT_COORDINATION
    || key === LIVING_TASK_STAGE.FOLLOW_UP
  ) {
    return TASK_SORT_GROUP.NEEDS_BROKER_ACTION;
  }
  if (hasNewResponse || key === LIVING_TASK_STAGE.CLIENT_INTERESTED || key === LIVING_TASK_STAGE.CLIENT_NEEDS_DETAILS) {
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
  appointmentLine = "",
  ownerContactNeeded = false
} = {}) {
  const key = upper(stage);
  const reveal = { revealClosedLabel: "عرض البيانات", revealOpenLabel: "إخفاء البيانات" };
  if (key === LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO) {
    const label = missingInfoLabel(missingInfoKey);
    return {
      kindLabel: "العميل يحتاج معلومة",
      statusLabel: label ? `${label} غير متوفر` : "معلومة غير متوفرة",
      happenedLine: "العميل يحتاج معلومة",
      turnLine: "دورك الآن",
      yourTurnLine: "استكمال المعلومة",
      nextActionLine: "استكمال المعلومة",
      waiting: false,
      ...reveal
    };
  }
  if (key === LIVING_TASK_STAGE.WAITING_CLIENT || key === LIVING_TASK_STAGE.CLIENT_SENT) {
    return {
      kindLabel: "بانتظار رد العميل",
      statusLabel: "بانتظار العميل",
      happenedLine: "تم فتح واتساب للعميل",
      turnLine: "",
      yourTurnLine: "بانتظار رد العميل",
      nextActionLine: "لا يوجد إجراء مطلوب منك الآن.",
      waiting: true,
      ...reveal
    };
  }
  if (key === LIVING_TASK_STAGE.CLIENT_INTERESTED) {
    if (ownerContactNeeded) {
      return {
        kindLabel: "العميل مهتم",
        statusLabel: "قيد المتابعة",
        happenedLine: "العميل مهتم بالعقار",
        turnLine: "دورك الآن",
        yourTurnLine: "تأكيد توفر العقار",
        nextActionLine: "تأكيد توفر العقار",
        waiting: false,
        ...reveal
      };
    }
    return {
      kindLabel: "العميل مهتم",
      statusLabel: "قيد المتابعة",
      happenedLine: "العميل مهتم بالعقار",
      turnLine: "دورك الآن",
      yourTurnLine: "متابعة المعاينة",
      nextActionLine: "متابعة المعاينة",
      waiting: false,
      ...reveal
    };
  }
  if (key === LIVING_TASK_STAGE.CLIENT_NEEDS_DETAILS) {
    return {
      kindLabel: "العميل يحتاج تفاصيل",
      statusLabel: "قيد المتابعة",
      happenedLine: "العميل طلب تفاصيل أكثر",
      turnLine: "دورك الآن",
      yourTurnLine: "مشاركة التفاصيل مع العميل",
      nextActionLine: "مشاركة التفاصيل",
      waiting: false,
      ...reveal
    };
  }
  if (key === LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION) {
    return {
      kindLabel: "بانتظار تأكيد المالك",
      statusLabel: "بانتظار المالك",
      happenedLine: "تم طلب تأكيد توفر العقار من المالك",
      turnLine: "",
      yourTurnLine: "بانتظار رد المالك",
      nextActionLine: "لا يوجد إجراء مطلوب منك الآن.",
      waiting: true,
      ...reveal
    };
  }
  if (key === LIVING_TASK_STAGE.PROPERTY_AVAILABLE) {
    return {
      kindLabel: "العقار متاح",
      statusLabel: "قيد المتابعة",
      happenedLine: "المالك أكد أن العقار متاح",
      turnLine: "دورك الآن",
      yourTurnLine: "تنسيق موعد المعاينة",
      nextActionLine: "تنسيق موعد المعاينة",
      waiting: false,
      ...reveal
    };
  }
  if (key === LIVING_TASK_STAGE.APPOINTMENT_COORDINATION || key === LIVING_TASK_STAGE.VIEWING_DECISION) {
    return {
      kindLabel: "موعد تحت التنسيق",
      statusLabel: "موعد تحت التنسيق",
      happenedLine: "",
      turnLine: "دورك الآن",
      yourTurnLine: "تنسيق موعد المعاينة",
      nextActionLine: "تنسيق موعد المعاينة",
      waiting: false,
      ...reveal
    };
  }
  if (key === LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED) {
    return {
      kindLabel: appointmentLine ? `الموعد مؤكد — ${appointmentLine}` : "الموعد مؤكد",
      statusLabel: "",
      happenedLine: appointmentLine ? `موعد مؤكد — ${appointmentLine}` : "موعد مؤكد",
      turnLine: "دورك الآن",
      yourTurnLine: "الصفقة جاهزة للإغلاق",
      nextActionLine: "تأكيد إتمام الصفقة",
      waiting: false,
      ...reveal
    };
  }
  if (key === LIVING_TASK_STAGE.FOLLOW_UP) {
    return {
      kindLabel: "الصفقة جاهزة للإغلاق",
      statusLabel: "قيد المتابعة",
      happenedLine: "",
      turnLine: "دورك الآن",
      yourTurnLine: "الصفقة جاهزة للإغلاق",
      nextActionLine: "تأكيد إتمام الصفقة",
      waiting: false,
      ...reveal
    };
  }
  if (key === LIVING_TASK_STAGE.COMPLETED) {
    return {
      kindLabel: "الصفقة مكتملة",
      statusLabel: "الصفقة مكتملة",
      happenedLine: "تم إتمام الصفقة",
      turnLine: "",
      yourTurnLine: "",
      nextActionLine: "",
      waiting: true,
      ...reveal
    };
  }
  if (key === LIVING_TASK_STAGE.MATCH_FOUND && hasNextCandidate) {
    return {
      kindLabel: "مطابقة جديدة",
      statusLabel: "المطابقة غير مناسبة",
      happenedLine: "المطابقة الأولى غير مناسبة",
      turnLine: "دورك الآن",
      yourTurnLine: "يوجد عرض آخر مناسب",
      nextActionLine: "يوجد عرض آخر مناسب",
      waiting: false,
      ...reveal
    };
  }
  return {
    kindLabel: "مطابقة جديدة",
    statusLabel: "تم العثور على مطابقة",
    happenedLine: "تم العثور على مطابقة",
    turnLine: "دورك الآن",
    yourTurnLine: "إرسال العرض للعميل",
    nextActionLine: "إرسال العرض للعميل",
    waiting: false,
    ...reveal
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
    return { stage: LIVING_TASK_STAGE.CLIENT_INTERESTED, ownerContactNeeded: true };
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
