/**
 * «باحث الفرص» — judging one find. Pure functions (no storage, no network), used by the scout service and its tests.
 *
 *   • Fit comes from the platform's matching engine (scoreMatch) — the same rules that match the office's own
 *     offers and requests. The scout only prepares the two sides and adds what the engine has no notion of:
 *     a neighbouring district is better than «another district», and a budget is a ceiling, not a point.
 *   • Quality, level and what reaches the broker come from scout-domain.js (shared with the UI).
 */

import { MATCH_THRESHOLD, opportunityToMatchInput, scoreMatch } from "../matching-engine.js";
import {
  ADVERTISER, BAND, MODE_CONFIG, RING, SCOUT_MODE, SEEK, TASK_ORIGIN, allowedRing, bandRank, classifyAdvertiser, districtRing, modeOf,
  normDistrict, normPhone, normText, profileFromRecord, qualityScore, relatedTypes, sameEntity, scoutScore, tokenSet, freshness
} from "../../../public/os/domain/scout-domain.js";

/** What a neighbouring district gets back of the engine's «other district» penalty (same 30 · neighbouring 12 · other −12). */
const ADJACENT_BONUS = 24;
/** Engine reasons that say nothing to a broker reading a find. */
const QUIET_REASONS = /^(نفس المدينة|نفس نوع العملية|فرق السعر 0٪|بيانات الطرفين مكتملة)$/;

const mid = (a, b) => (a && b ? Math.round((a + b) / 2) : a || b || 0);
const ceilingRange = (max, min = 0) => (max ? { priceMax: max, priceMin: min || Math.round(max * 0.6), priceOrBudget: max } : {});

/**
 * How well a find fits one search. Returns null when it is simply not what the search is for (other kind, operation,
 * type, city, a district outside the allowed ring, too old, price outside the mode's tolerance).
 */
export function fitFor({ profile = {}, seek = SEEK.OFFER, exactPrice = 0, entity = {}, mode = SCOUT_MODE.GENERAL, ring = RING.SAME, now = new Date() }) {
  const config = MODE_CONFIG[modeOf(mode)];
  if (!entity.kind) return null;
  if ((seek === SEEK.OFFER || seek === SEEK.OWNER) && entity.kind !== "OFFER") return null;
  if (seek === SEEK.REQUEST && entity.kind !== "REQUEST") return null;
  if (profile.tx && entity.tx && profile.tx !== entity.tx) return null;
  if (profile.city && entity.city && normText(profile.city) !== normText(entity.city)) return null;
  const types = profile.propertyTypes || [];
  const exactType = !types.length || !entity.propertyType || types.includes(entity.propertyType);
  if (!exactType && !(config.relatedTypes && types.flatMap(relatedTypes).includes(entity.propertyType))) return null;
  const place = districtRing(profile.districts || [], entity.district);
  if (place.ring === RING.ADJACENT && ring < RING.ADJACENT) return null;
  if (place.ring === RING.CITY && ring < RING.CITY) return null;
  const age = freshness(entity, now).hours;
  const maxDays = profile.freshnessDays || config.backfillDays;
  if (age !== null && age > maxDays * 24) return null;

  const tx = profile.tx || entity.tx || "sale";
  const ourKind = entity.kind === "OFFER" ? "REQUEST" : "OFFER";
  const wantedDistrict = !(profile.districts || []).length ? "" : place.ring === RING.SAME ? entity.district : profile.districts[0];
  const wantedType = !types.length ? "" : exactType ? (entity.propertyType || types[0]) : types[0];
  const ourPrice = ourKind === "REQUEST" ? profile.priceMax : (exactPrice || profile.priceMax);
  // The mode's price tolerance: a general round is strict, an urgent one a little wider, a deep one the widest.
  if (ourKind === "REQUEST" && ourPrice && entity.price && entity.price > ourPrice * (1 + config.priceTolerance)) return null;
  if (ourKind === "OFFER" && ourPrice && entity.price && entity.price < ourPrice * (1 - config.priceTolerance)) return null;
  const ours = {
    opportunityKind: ourKind, purpose: ourKind === "REQUEST" ? (tx === "rent" ? "LEASE_REQUEST" : "PURCHASE") : (tx === "rent" ? "RENT" : "SALE"),
    city: profile.city || entity.city || "", district: wantedDistrict, propertyType: wantedType,
    ...(ourKind === "REQUEST" ? ceilingRange(profile.priceMax, profile.priceMin) : { priceOrBudget: ourPrice || 0 }),
    area: mid(profile.areaMin, profile.areaMax), rooms: profile.rooms || 0, lifecycleStatus: "ACTIVE"
  };
  const theirs = {
    opportunityKind: entity.kind, purpose: entity.kind === "OFFER" ? (tx === "rent" ? "RENT" : "SALE") : (tx === "rent" ? "LEASE_REQUEST" : "PURCHASE"),
    city: entity.city || profile.city || "", district: entity.district || "", propertyType: entity.propertyType || "",
    ...(entity.kind === "REQUEST" ? ceilingRange(entity.price) : { priceOrBudget: entity.price || 0 }),
    area: entity.area || 0, rooms: entity.rooms || 0, lifecycleStatus: "ACTIVE"
  };
  const scored = scoreMatch(opportunityToMatchInput(ours), opportunityToMatchInput(theirs));
  if (!scored.eligible) return null;
  const adjacent = place.ring === RING.ADJACENT;
  const reasons = scored.reasons.filter((reason) => !QUIET_REASONS.test(reason));
  const warnings = scored.warnings.filter((warning) => !(adjacent && warning === "الحي مختلف") && !/غير مكتمل في أحد الطرفين/.test(warning));
  if (adjacent) reasons.unshift(`حي مجاور لـ${place.near}`);
  if (place.ring === RING.CITY) warnings.unshift("حي آخر داخل المدينة");
  if (!exactType) warnings.unshift(`نوع قريب: ${entity.propertyType}`);
  return { fit: Math.max(0, Math.min(100, scored.score + (adjacent ? ADJACENT_BONUS : 0))), ring: place.ring, reasons, warnings };
}

/** Compact record of the office (kept in the scout state) → the search for its other side, as a general-mode lens. */
function recordLens(record) {
  const lens = profileFromRecord({ ...record, notes: (record.xd || []).length ? `أحياء مقبولة أيضًا: ${record.xd.join("، ")}` : "" });
  return lens ? { ...lens, recordId: record.id, recordKind: lens.recordKind } : null;
}

/**
 * One find against every search that may want it (the due tasks, and the office's open records that have no task of
 * their own). Returns the links ordered best first, the advertiser reading and the level of the best link.
 */
export function evaluateFind({ entity, tasks = [], records = [], settings = {}, sourceQuality = 0.5, repeat = 0, now = new Date() }) {
  const advertiser = classifyAdvertiser(entity, { repeat });
  const links = [];
  const judge = ({ profile, seek, exactPrice, mode, ring, origin, taskId = "", recordId = "", recordKind = "" }) => {
    const fit = fitFor({ profile, seek, exactPrice, entity, mode, ring, now });
    if (!fit) return;
    const preferDirectOwner = profile.preferDirectOwner === true || settings.preferDirectOwner === true;
    const quality = qualityScore({ ...entity, advertiser: advertiser.kind }, { now, sourceQuality, preferDirectOwner, advertiser: advertiser.kind, repeat });
    // No record and no search of the office behind it: never «very strong». An owners-only search never surfaces a broker's ad.
    const capBand = seek === SEEK.OWNER && advertiser.kind === ADVERTISER.BROKER_LIKELY ? BAND.MEDIUM : origin === TASK_ORIGIN.DISCOVERY ? BAND.STRONG : "";
    const { score, band } = scoutScore({ fit: fit.fit, quality: quality.quality, capBand });
    links.push({
      taskId, mode: modeOf(mode), origin: origin || "", recordId, recordKind, fit: fit.fit, quality: quality.quality, score, band, ring: fit.ring,
      reasons: [...fit.reasons, ...quality.reasons].slice(0, 6), warnings: [...fit.warnings, ...quality.warnings].slice(0, 4)
    });
  };
  const covered = new Set();
  for (const task of tasks) {
    if (task.recordId) covered.add(task.recordId);
    judge({ profile: task.profile || {}, seek: task.seek, exactPrice: Number(task.exactPrice || 0), mode: task.mode, ring: allowedRing(task), origin: task.origin, taskId: task.id, recordId: task.recordId || "", recordKind: task.recordKind || "" });
  }
  // The office's other open records: a find that fits one of them is worth knowing even when no search was started for it.
  for (const record of records) {
    if (covered.has(record.id)) continue;
    const lens = recordLens(record);
    if (!lens || (lens.seek === SEEK.OFFER ? "OFFER" : "REQUEST") !== entity.kind) continue;
    const before = links.length;
    judge({ profile: lens.profile, seek: lens.seek, exactPrice: lens.exactPrice, mode: SCOUT_MODE.GENERAL, ring: RING.ADJACENT, origin: "INVENTORY", recordId: record.id, recordKind: lens.recordKind });
    if (links.length > before && links.at(-1).fit < MATCH_THRESHOLD) links.pop();
  }
  links.sort((a, b) => b.score - a.score || Number(Boolean(b.recordId)) - Number(Boolean(a.recordId)));
  const best = links[0] || null;
  return { advertiser, links: links.slice(0, 4), best, band: best ? best.band : BAND.WEAK, score: best ? best.score : 0 };
}

// ------------------------------------------------------------------ the office's compact index of kept finds

/** What is kept in the scout state for each find: enough to recognise it again and to judge it for a new search. */
export function indexEntry(entity = {}) {
  return {
    id: entity.id, kind: entity.kind || "", tx: entity.tx || "", propertyType: entity.propertyType || "", city: entity.city || "", district: entity.district || "",
    price: entity.price || 0, area: entity.area || 0, rooms: entity.rooms || 0, phone: normPhone(entity.phone), route: entity.contactRoute ? 1 : 0,
    words: [...tokenSet(entity.text)].slice(0, 28).join(" "), length: String(entity.text || "").length, refs: (entity.sources || []).map((s) => `${s.sourceId}|${s.ref}`).slice(0, 6),
    sourceCount: Number(entity.sourceCount || 1), advertiser: entity.advertiser || ADVERTISER.UNCLEAR, confidence: Number(entity.confidence ?? 0.6),
    firstSeenAt: entity.firstSeenAt || "", publishedAt: entity.publishedAt || "", lastSeenAt: entity.lastSeenAt || "",
    band: entity.band || BAND.WEAK, status: entity.status || "NEW", surface: entity.surface || "HIDDEN"
  };
}

/** A kept find as the judge reads it (the index holds words, not the ad itself). */
export const entityFromIndex = (entry = {}) => ({ ...entry, text: entry.words || "", textLength: Number(entry.length || 0), tokens: new Set(String(entry.words || "").split(" ").filter(Boolean)), contactRoute: entry.route ? "kept" : "" });

/** The kept find this candidate is another sighting of: the same source item first, then the same property or request. */
export function findExisting(index = [], candidate = {}) {
  const ref = `${candidate.sourceId}|${candidate.externalId}`;
  const exact = index.find((entry) => (entry.refs || []).includes(ref));
  if (exact) return { entry: exact, by: "source" };
  const probe = { ...candidate, tokens: tokenSet(candidate.text) };
  for (const entry of index) {
    const same = sameEntity(entityFromIndex(entry), probe);
    if (same.same) return { entry, by: same.by };
  }
  return null;
}

/** How many OTHER kept finds carry this number (a sign of an office, and of noise when it is many). */
export function repeatCount(index = [], phone = "", exceptId = "") {
  const digits = normPhone(phone);
  return digits ? index.filter((entry) => entry.phone === digits && entry.id !== exceptId).length : 0;
}

/** Already one of the office's own records (same person, same kind of property, same place): not a new find. */
export function inInventory(records = [], candidate = {}) {
  const phone = normPhone(candidate.phone);
  if (!phone) return null;
  return records.find((record) => record.phone === phone
    && (record.opportunityKind || "") === (candidate.kind || "")
    && (!record.propertyType || !candidate.propertyType || record.propertyType === candidate.propertyType)
    && (!record.district || !candidate.district || normDistrict(record.district) === normDistrict(candidate.district))) || null;
}

export const strongerBand = (a, b) => (bandRank(a) >= bandRank(b) ? a : b);
