/**
 * Public Opportunity Router — pure domain.
 * Scores and ranks offices for PLATFORM_PUBLIC intake. No DOM, no I/O.
 */

export const ORIGIN_SOURCE_TYPE = Object.freeze({
  OFFICE_DIRECT: "OFFICE_DIRECT",
  PLATFORM_PUBLIC: "PLATFORM_PUBLIC",
  DIRECT_ADD: "DIRECT_ADD",
  IMPORT: "IMPORT"
});

export const ROUTING_STATUS = Object.freeze({
  NEEDS_COMPLETION: "NEEDS_COMPLETION",
  ROUTING: "ROUTING",
  OFFERED_TO_OFFICE: "OFFERED_TO_OFFICE",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  EXPIRED: "EXPIRED",
  REASSIGNED: "REASSIGNED",
  ASSIGNED: "ASSIGNED",
  NO_ELIGIBLE_OFFICE: "NO_ELIGIBLE_OFFICE"
});

export const ATTEMPT_DECISION = Object.freeze({
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  DECLINED: "DECLINED",
  EXPIRED: "EXPIRED"
});

export const DECLINE_REASON = Object.freeze({
  OUTSIDE_SPECIALTY: "OUTSIDE_SPECIALTY",
  TOO_BUSY: "TOO_BUSY",
  LOCATION: "LOCATION",
  NOT_INTERESTED: "NOT_INTERESTED",
  OTHER: "OTHER"
});

export const ASSIGNMENT_REASON = Object.freeze({
  DIRECT_OFFICE_LINK: "DIRECT_OFFICE_LINK",
  PLATFORM_ROUTER: "PLATFORM_ROUTER"
});

export const ROUTER_REASON_CODE = Object.freeze({
  DISTRICT_SPECIALIZATION: "DISTRICT_SPECIALIZATION",
  CITY_MATCH: "CITY_MATCH",
  PROPERTY_SPECIALIZATION: "PROPERTY_SPECIALIZATION",
  STRONG_RESPONSE: "STRONG_RESPONSE",
  GOOD_FOLLOW_UP: "GOOD_FOLLOW_UP",
  PLATFORM_FAIRNESS: "PLATFORM_FAIRNESS"
});

export const ROUTER_REASON_LABELS = Object.freeze({
  DISTRICT_SPECIALIZATION: "داخل نطاق تخصصك",
  CITY_MATCH: "تعمل في نفس المدينة",
  PROPERTY_SPECIALIZATION: "متخصص في هذا النوع",
  STRONG_RESPONSE: "استجابتك مرتفعة",
  GOOD_FOLLOW_UP: "متابعتك للفرص منتظمة",
  PLATFORM_FAIRNESS: "توزيع عادل لفرص المنصة"
});

export const OPPORTUNITY_ROUTER_WEIGHTS = Object.freeze({
  location: 30,
  specialization: 20,
  response: 20,
  followUp: 15,
  rating: 10,
  fairness: 5
});

export const PLATFORM_OPPORTUNITY_ACCEPT_WINDOW_MINUTES = 30;
export const RATING_PRIOR_MEAN = 3.5;
export const RATING_PRIOR_STRENGTH = 10;
export const NEW_OFFICE_RESPONSE_BASELINE = 10;
export const NEW_OFFICE_FOLLOWUP_BASELINE = 7.5;

export const PLATFORM_ONBOARDING_COPY = Object.freeze({
  title: "كيف تصلك الفرص؟",
  lines: Object.freeze([
    "الفرص التي تصل من رابط مكتبك تكون لمكتبك مباشرة.",
    "الفرص العامة ترشحها المنصة للمكتب الأنسب حسب الموقع والتخصص والنشاط وسرعة الاستجابة.",
    "تقييم العملاء عامل مساعد ضمن جودة الخدمة، وليس العامل الوحيد في توزيع الفرص.",
    "تابع الفرص وحدّث حالتها باستمرار لتحصل على ترشيحات أدق."
  ]),
  action: "فهمت، ابدأ"
});

export const PLATFORM_ROUTING_HELP = "الفرص القادمة من رابط مكتبك تصل إليك مباشرة. أما الفرص العامة فتُرشح بحسب المدينة والحي، تخصص المكتب، نوع العقار، سرعة الاستجابة، متابعة الفرص، والتقييم. تستخدم المنصة كذلك توزيعًا عادلًا لمنع احتكار الفرص.";

function text(value) {
  return String(value == null ? "" : value).trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function livingTaskIdForOpportunity(opportunityId) {
  const id = text(opportunityId).slice(0, 160);
  return id ? `po_${id}` : "";
}

export function originSourceFromIntake({ officeId = "", source = "", originSourceType = "" } = {}) {
  const explicit = upper(originSourceType);
  if (Object.values(ORIGIN_SOURCE_TYPE).includes(explicit)) {
    return {
      type: explicit,
      officeId: explicit === ORIGIN_SOURCE_TYPE.OFFICE_DIRECT ? text(officeId) : ""
    };
  }
  const oid = text(officeId).toLowerCase();
  const src = text(source).toLowerCase();
  if (oid && oid !== "platform" && (src === "office_public_link" || src === "office_direct" || !src)) {
    return { type: ORIGIN_SOURCE_TYPE.OFFICE_DIRECT, officeId: oid };
  }
  if (oid === "platform" || src === "platform_public") {
    return { type: ORIGIN_SOURCE_TYPE.PLATFORM_PUBLIC, officeId: "" };
  }
  if (src === "direct_add") return { type: ORIGIN_SOURCE_TYPE.DIRECT_ADD, officeId: oid };
  if (src === "import") return { type: ORIGIN_SOURCE_TYPE.IMPORT, officeId: oid };
  return oid && oid !== "platform"
    ? { type: ORIGIN_SOURCE_TYPE.OFFICE_DIRECT, officeId: oid }
    : { type: ORIGIN_SOURCE_TYPE.PLATFORM_PUBLIC, officeId: "" };
}

export function routerCompleteness(opportunity = {}) {
  const missing = [];
  const kind = upper(opportunity.opportunityKind || opportunity.kind);
  const purpose = upper(opportunity.purpose);
  if (kind !== "OFFER" && kind !== "REQUEST") missing.push("opportunityType");
  if (!purpose) missing.push("purpose");
  if (!text(opportunity.propertyType)) missing.push("propertyType");
  if (!text(opportunity.city)) missing.push("city");
  return {
    ok: missing.length === 0,
    missing,
    status: missing.length ? ROUTING_STATUS.NEEDS_COMPLETION : ROUTING_STATUS.ROUTING
  };
}

export function publicOfferPreview(opportunity = {}) {
  return {
    opportunityId: text(opportunity.opportunityId || opportunity.id),
    opportunityKind: upper(opportunity.opportunityKind),
    purpose: upper(opportunity.purpose),
    propertyType: text(opportunity.propertyType),
    city: text(opportunity.city),
    district: text(opportunity.district),
    salePrice: Number(opportunity.salePrice || 0) || null,
    budget: Number(opportunity.budget || opportunity.priceOrBudget || 0) || null,
    annualRent: Number(opportunity.annualRent || 0) || null,
    reasonCodes: Array.isArray(opportunity.reasonCodes) ? opportunity.reasonCodes.slice(0, 6) : []
  };
}

export function isAcceptPlatformPublic(office = {}) {
  if (office.acceptPlatformPublicOpportunities === false) return false;
  return true;
}

export function isOfficeActiveForRouter(office = {}) {
  const account = String(office.accountStatus || "active").toLowerCase();
  const approval = String(office.approvalStatus || "approved").toLowerCase();
  if (account === "suspended" || account === "blocked" || account === "inactive") return false;
  if (approval === "rejected" || approval === "blocked" || approval === "suspended") return false;
  const id = text(office.officeId).toLowerCase();
  if (!id || id === "platform") return false;
  return true;
}

export function cityEquals(a = "", b = "") {
  const left = text(a);
  const right = text(b);
  if (!left || !right) return false;
  return left === right;
}

function officeCoverageIds(office = {}) {
  const ids = [];
  const primary = text(office.primaryNeighborhoodId);
  if (primary) ids.push(primary);
  const list = Array.isArray(office.serviceNeighborhoodIds) ? office.serviceNeighborhoodIds : [];
  for (const id of list) {
    const value = text(id);
    if (value && !ids.includes(value)) ids.push(value);
  }
  return ids;
}

export function locationFitScore({ office = {}, opportunity = {} } = {}) {
  if (!cityEquals(office.city, opportunity.city)) {
    return { points: 0, eligible: false, code: "", label: "" };
  }
  const coverage = officeCoverageIds(office);
  const districtId = text(opportunity.districtId || opportunity.primaryNeighborhoodId);
  const districtLabel = text(opportunity.district);
  const coversId = districtId && coverage.includes(districtId);
  const coversLabel = districtLabel && (
    text(office.district) === districtLabel
    || (Array.isArray(office.serviceNeighborhoodLabels) && office.serviceNeighborhoodLabels.includes(districtLabel))
  );
  if (coversId || coversLabel) {
    return {
      points: OPPORTUNITY_ROUTER_WEIGHTS.location,
      eligible: true,
      code: ROUTER_REASON_CODE.DISTRICT_SPECIALIZATION,
      label: ROUTER_REASON_LABELS.DISTRICT_SPECIALIZATION
    };
  }
  return {
    points: 18,
    eligible: true,
    code: ROUTER_REASON_CODE.CITY_MATCH,
    label: ROUTER_REASON_LABELS.CITY_MATCH
  };
}

export function specializationFitScore({ office = {}, opportunity = {} } = {}) {
  const specialties = Array.isArray(office.specialties) ? office.specialties.map((row) => String(row).toLowerCase()) : [];
  const kind = upper(opportunity.opportunityKind);
  const purpose = upper(opportunity.purpose);
  let exact = false;
  let partial = false;
  if (kind === "OFFER" && purpose === "SALE" && specialties.includes("sale")) exact = true;
  if (kind === "REQUEST" && (purpose === "SALE" || purpose === "PURCHASE") && specialties.includes("purchase")) exact = true;
  if ((purpose === "RENT" || purpose === "LEASE_REQUEST") && specialties.includes("rent")) exact = true;
  if (specialties.includes("property_management") && (purpose === "RENT" || kind === "OFFER")) partial = true;
  if (!specialties.length) {
    return { points: 10, exact: false, code: "", label: "" };
  }
  if (exact) {
    return {
      points: OPPORTUNITY_ROUTER_WEIGHTS.specialization,
      exact: true,
      code: ROUTER_REASON_CODE.PROPERTY_SPECIALIZATION,
      label: ROUTER_REASON_LABELS.PROPERTY_SPECIALIZATION
    };
  }
  if (partial) return { points: 8, exact: false, code: "", label: "" };
  return { points: 4, exact: false, code: "", label: "" };
}

export function bayesianRating(average, count, priorMean = RATING_PRIOR_MEAN, priorStrength = RATING_PRIOR_STRENGTH) {
  const n = Math.max(0, Number(count) || 0);
  const avg = clamp(average, 1, 5);
  const mean = ((n * avg) + (priorStrength * priorMean)) / (n + priorStrength);
  return clamp(mean, 1, 5);
}

export function ratingFitScore({ office = {} } = {}) {
  const count = Math.max(0, Number(office.ratingCount) || 0);
  const raw = Number(office.ratingAverage);
  if (!count || !Number.isFinite(raw)) {
    return { points: 5, adjusted: RATING_PRIOR_MEAN, count: 0 };
  }
  const adjusted = bayesianRating(raw, count);
  const points = ((adjusted - 1) / 4) * OPPORTUNITY_ROUTER_WEIGHTS.rating;
  return { points: clamp(points, 0, OPPORTUNITY_ROUTER_WEIGHTS.rating), adjusted, count };
}

export function responseFitScore({ stats = {} } = {}) {
  const samples = Number(stats.responseSampleCount || 0);
  if (samples <= 0) {
    return {
      points: NEW_OFFICE_RESPONSE_BASELINE,
      code: "",
      label: ""
    };
  }
  const avgMs = Number(stats.averageResponseMs || 0);
  const hours = avgMs > 0 ? avgMs / 3600000 : 24;
  let points = 4;
  if (hours <= 1) points = 20;
  else if (hours <= 6) points = 16;
  else if (hours <= 24) points = 12;
  else if (hours <= 72) points = 8;
  return {
    points,
    code: points >= 16 ? ROUTER_REASON_CODE.STRONG_RESPONSE : "",
    label: points >= 16 ? ROUTER_REASON_LABELS.STRONG_RESPONSE : ""
  };
}

export function followUpFitScore({ stats = {} } = {}) {
  const samples = Number(stats.followUpSampleCount || 0);
  if (samples <= 0) {
    return { points: NEW_OFFICE_FOLLOWUP_BASELINE, code: "", label: "" };
  }
  const rate = clamp(stats.followUpRate, 0, 1);
  const points = Math.round(rate * OPPORTUNITY_ROUTER_WEIGHTS.followUp);
  return {
    points,
    code: points >= 11 ? ROUTER_REASON_CODE.GOOD_FOLLOW_UP : "",
    label: points >= 11 ? ROUTER_REASON_LABELS.GOOD_FOLLOW_UP : ""
  };
}

export function fairnessFitScore({ office = {}, stats = {}, eligibleLoad = [] } = {}) {
  const recent = Math.max(0, Number(
    stats.recentPlatformAssignments
    || office.recentPlatformAssignments
    || statsFromOffice(office).recentPlatformAssignments
    || 0
  ));
  const loads = eligibleLoad.map((row) => Math.max(0, Number(row) || 0));
  if (!loads.length) {
    return { points: OPPORTUNITY_ROUTER_WEIGHTS.fairness, code: ROUTER_REASON_CODE.PLATFORM_FAIRNESS, label: ROUTER_REASON_LABELS.PLATFORM_FAIRNESS };
  }
  const max = Math.max(...loads, 1);
  const ratio = recent / max;
  let points = OPPORTUNITY_ROUTER_WEIGHTS.fairness;
  if (ratio >= 0.8 && recent >= 3) points = 1;
  else if (ratio >= 0.5 && recent >= 2) points = 3;
  return {
    points,
    code: points >= 3 ? ROUTER_REASON_CODE.PLATFORM_FAIRNESS : "",
    label: points >= 3 ? ROUTER_REASON_LABELS.PLATFORM_FAIRNESS : ""
  };
}

export function isOfficeEligibleForPlatformRouter(office = {}, opportunity = {}) {
  if (!isOfficeActiveForRouter(office)) return { ok: false, reason: "inactive" };
  if (!isAcceptPlatformPublic(office)) return { ok: false, reason: "opt_out" };
  if (!cityEquals(office.city, opportunity.city)) return { ok: false, reason: "city" };
  return { ok: true, reason: "" };
}

export function scoreOfficeForOpportunity({
  office = {},
  opportunity = {},
  stats = {},
  eligibleLoad = []
} = {}) {
  const eligibility = isOfficeEligibleForPlatformRouter(office, opportunity);
  if (!eligibility.ok) {
    return {
      officeId: text(office.officeId),
      eligible: false,
      ineligibleReason: eligibility.reason,
      totalScore: 0,
      breakdown: {},
      reasonCodes: []
    };
  }
  const location = locationFitScore({ office, opportunity });
  if (!location.eligible) {
    return {
      officeId: text(office.officeId),
      eligible: false,
      ineligibleReason: "city",
      totalScore: 0,
      breakdown: {},
      reasonCodes: []
    };
  }
  const specialization = specializationFitScore({ office, opportunity });
  const response = responseFitScore({ stats });
  const followUp = followUpFitScore({ stats });
  const rating = ratingFitScore({ office });
  const fairness = fairnessFitScore({ office, stats, eligibleLoad });
  const breakdown = {
    location: location.points,
    specialization: specialization.points,
    response: response.points,
    followUp: followUp.points,
    rating: Number(rating.points.toFixed(2)),
    fairness: fairness.points
  };
  const totalScore = Number((
    breakdown.location
    + breakdown.specialization
    + breakdown.response
    + breakdown.followUp
    + breakdown.rating
    + breakdown.fairness
  ).toFixed(2));
  const reasonCodes = [location.code, specialization.code, response.code, followUp.code, fairness.code]
    .filter(Boolean);
  return {
    officeId: text(office.officeId),
    eligible: true,
    ineligibleReason: "",
    totalScore,
    breakdown,
    reasonCodes,
    reasonLabels: reasonCodes.map((code) => ROUTER_REASON_LABELS[code]).filter(Boolean)
  };
}

export function rankRouterCandidates(scored = []) {
  return [...scored]
    .filter((row) => row && row.eligible)
    .sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      const loc = (b.breakdown?.location || 0) - (a.breakdown?.location || 0);
      if (loc) return loc;
      const resp = (b.breakdown?.response || 0) - (a.breakdown?.response || 0);
      if (resp) return resp;
      const recent = (a.recentPlatformAt || "").localeCompare(b.recentPlatformAt || "");
      if (recent) return recent;
      return String(a.officeId || "").localeCompare(String(b.officeId || ""));
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function nextPendingCandidate(ranked = [], attemptedOfficeIds = []) {
  const used = new Set((attemptedOfficeIds || []).map((id) => text(id).toLowerCase()));
  return ranked.find((row) => !used.has(text(row.officeId).toLowerCase())) || null;
}

export function attemptExpiresAt(offeredAt = new Date(), minutes = PLATFORM_OPPORTUNITY_ACCEPT_WINDOW_MINUTES) {
  const start = offeredAt instanceof Date ? offeredAt : new Date(offeredAt);
  const windowMinutes = Math.max(1, Number(minutes) || PLATFORM_OPPORTUNITY_ACCEPT_WINDOW_MINUTES);
  return new Date(start.getTime() + windowMinutes * 60 * 1000);
}

export function isAttemptExpired(attempt = {}, now = new Date()) {
  if (!attempt || upper(attempt.decision) !== ATTEMPT_DECISION.PENDING) return false;
  const expires = new Date(attempt.expiresAt || 0);
  return Number.isFinite(expires.getTime()) && expires.getTime() <= now.getTime();
}

export function canAcceptAttempt({ attempt = {}, opportunity = {}, officeId = "", now = new Date() } = {}) {
  if (!attempt || !opportunity) return { ok: false, error: "not_found" };
  if (text(attempt.officeId).toLowerCase() !== text(officeId).toLowerCase()) {
    return { ok: false, error: "wrong_office" };
  }
  if (upper(attempt.decision) !== ATTEMPT_DECISION.PENDING) {
    return { ok: false, error: "not_pending" };
  }
  const status = upper(opportunity.routingStatus);
  if (status === ROUTING_STATUS.ASSIGNED || status === ROUTING_STATUS.ACCEPTED) {
    return { ok: false, error: "already_assigned" };
  }
  if (text(opportunity.currentAttemptId) && text(opportunity.currentAttemptId) !== text(attempt.attemptId || attempt.id)) {
    return { ok: false, error: "stale_attempt" };
  }
  if (isAttemptExpired(attempt, now)) return { ok: false, error: "expired" };
  return { ok: true, error: "" };
}

export function ratingUniquenessKey({ opportunityId = "", raterId = "", raterRole = "" } = {}) {
  return [text(opportunityId), text(raterId), text(raterRole).toLowerCase()].filter(Boolean).join("__");
}

export function applyRatingAggregate({ ratingAverage = 0, ratingCount = 0, stars = 0 } = {}) {
  const count = Math.max(0, Number(ratingCount) || 0);
  const nextStars = clamp(stars, 1, 5);
  const nextCount = count + 1;
  const nextAverage = ((Number(ratingAverage) || 0) * count + nextStars) / nextCount;
  return {
    ratingCount: nextCount,
    ratingAverage: Number(nextAverage.toFixed(2))
  };
}

export function officeRatingDisplay({ ratingAverage = 0, ratingCount = 0 } = {}) {
  const count = Math.max(0, Number(ratingCount) || 0);
  if (!count) return { text: "", average: 0, count: 0 };
  const average = Number(ratingAverage || 0).toFixed(1);
  return {
    text: `${average} ★\n${count} تقييمًا`,
    average: Number(average),
    count
  };
}

export function sanitizeRouterLog(event = "") {
  const name = text(event);
  if (!name.startsWith("opportunityRouter.")) return "";
  return name;
}

export function routingLogEvent(suffix = "") {
  const name = text(suffix).replace(/^opportunityRouter\./, "");
  return sanitizeRouterLog(`opportunityRouter.${name}`);
}

export function isValidStarRating(stars) {
  const n = Number(stars);
  return Number.isInteger(n) && n >= 1 && n <= 5;
}

export const DECLINE_REASON_VALUES = Object.freeze(Object.values(DECLINE_REASON));

export function platformOpportunityMoneyLine(opportunity = {}) {
  const kind = upper(opportunity.opportunityKind || opportunity.kind);
  const purpose = upper(opportunity.purpose);
  const budget = Number(opportunity.budget || opportunity.priceOrBudget || opportunity.priceMax || 0);
  const price = Number(opportunity.askingPrice || opportunity.salePrice || opportunity.price || 0);
  const rent = Number(opportunity.annualRent || 0);
  const amount = kind === "REQUEST"
    ? (budget || price)
    : (purpose === "RENT" || purpose === "LEASE_REQUEST" ? (rent || price || budget) : (price || budget));
  if (!(amount > 0)) return "";
  return `${Number(amount).toLocaleString("en-US")} ر.س`;
}

export function platformOpportunityHeadline(opportunity = {}) {
  const kind = upper(opportunity.opportunityKind);
  const purpose = upper(opportunity.purpose);
  const kindLabel = kind === "OFFER" ? "عرض" : "طلب";
  let purposeLabel = "";
  if (purpose === "SALE" || purpose === "PURCHASE") purposeLabel = kind === "OFFER" ? "بيع" : "شراء";
  else if (purpose === "RENT" || purpose === "LEASE_REQUEST") purposeLabel = "إيجار";
  const propertyType = text(opportunity.propertyType);
  const district = text(opportunity.district);
  return [kindLabel, purposeLabel, propertyType, district].filter(Boolean).join(" · ");
}

export function statsFromOffice(office = {}) {
  const raw = office.platformRouterStats && typeof office.platformRouterStats === "object"
    ? office.platformRouterStats
    : {};
  const followUpSampleCount = Number(raw.followUpSampleCount || 0);
  const followUpCompletedCount = Number(raw.followUpCompletedCount || 0);
  return {
    responseSampleCount: Number(raw.responseSampleCount || 0),
    averageResponseMs: Number(raw.averageResponseMs || 0),
    followUpSampleCount,
    followUpRate: followUpSampleCount > 0 ? followUpCompletedCount / followUpSampleCount : 0,
    recentPlatformAssignments: Number(raw.recentPlatformAssignments || office.recentPlatformAssignments || 0),
    lastPlatformAssignedAt: text(raw.lastPlatformAssignedAt || office.lastPlatformAssignedAt)
  };
}

export function mergeRouterStats(existing = {}, event = {}) {
  const next = { ...statsFromOffice({ platformRouterStats: existing }), ...existing };
  if (Number.isFinite(Number(event.responseMs))) {
    const n = Number(next.responseSampleCount || 0);
    const avg = Number(next.averageResponseMs || 0);
    const sample = Math.max(0, Number(event.responseMs));
    next.responseSampleCount = n + 1;
    next.averageResponseMs = n ? Math.round(((avg * n) + sample) / (n + 1)) : sample;
  }
  if (event.followed === true || event.followed === false) {
    next.followUpSampleCount = Number(next.followUpSampleCount || 0) + 1;
    next.followUpCompletedCount = Number(next.followUpCompletedCount || 0) + (event.followed ? 1 : 0);
    next.followUpRate = next.followUpSampleCount
      ? next.followUpCompletedCount / next.followUpSampleCount
      : 0;
  }
  if (event.assigned) {
    next.recentPlatformAssignments = Number(next.recentPlatformAssignments || 0) + 1;
    next.lastPlatformAssignedAt = text(event.at) || new Date().toISOString();
  }
  return next;
}
