/**
 * Repository service (العروض والطلبات) — server-side validation and writes for
 * offices/{o}/opportunities, followed by the existing matching pipeline.
 *
 * Removal never hard-deletes: a record linked to an opportunity/proposals is archived,
 * an unlinked one is soft-deleted; both stop taking part in new matches. A record in an
 * open opportunity cannot be removed until that opportunity is closed.
 */

import {
  LIFECYCLE, lifecycleOf, recordFields, recordFingerprint, validateRecordInput, kindOf
} from "../../../public/os/domain/records-domain.js";
import { compatibilityLevel } from "../../../public/os/domain/match-review-domain.js";
import { isJourneyOpen } from "../../../public/os/domain/journey-domain.js";
import { counterpartsEligible, opportunityToMatchInput, scoreMatch, MATCH_THRESHOLD } from "../matching-engine.js";
import { recordFailure } from "./journey-service.js";

async function runMatchingSafely(ctx, officeId, opportunityId) {
  if (typeof ctx.deps.runMatching !== "function") return { matchingPending: true, matches: 0 };
  try {
    const result = await ctx.deps.runMatching({ officeId, opportunityId, notify: true });
    return { matchingPending: false, matches: Number(result?.matches?.length || 0), superseded: Number(result?.superseded || 0) };
  } catch (error) {
    // The record is saved; matching is retried by the reconcile pass / next edit.
    await recordFailure(ctx, officeId, "MATCHING_RUN", opportunityId, error);
    console.warn("[office-os] matching failed", opportunityId, error?.message);
    return { matchingPending: true, matches: 0 };
  }
}

export async function saveRecord(ctx, { actor, officeId, recordId = "", input = {}, requestKey = "" }) {
  const check = validateRecordInput(input);
  if (!check.ok) {
    const error = ctx.deps.appError("record_invalid", 400, Object.values(check.errors)[0]);
    error.details = check.errors;
    throw error;
  }
  const now = ctx.now();
  let id = String(recordId || "").trim();
  let existing = null;
  if (id) {
    existing = await ctx.store.get(["offices", officeId, "opportunities", id]);
    if (!existing || String(existing.officeId || officeId) !== officeId) throw ctx.deps.appError("record_not_found", 404, "السجل غير موجود");
    if (lifecycleOf(existing) === LIFECYCLE.DELETED) throw ctx.deps.appError("record_deleted", 409, "السجل محذوف");
    if (kindOf(existing) && kindOf(existing) !== check.value.kind) throw ctx.deps.appError("record_kind_locked", 409, "لا يمكن تحويل العرض إلى طلب أو العكس");
  } else {
    const fingerprint = recordFingerprint(check.value, officeId);
    const hex = await ctx.deps.sha256Hex(`record|${officeId}|${fingerprint}|${requestKey || now.toISOString()}`);
    id = `opp_os_${hex.slice(0, 28)}`;
    const replay = await ctx.store.get(["offices", officeId, "opportunities", id]);
    if (replay) return { ok: true, recordId: id, duplicate: true, matchingPending: false, matches: 0 };
    const all = await ctx.store.list(["offices", officeId, "opportunities"], 300);
    const twin = all.find((row) => lifecycleOf(row) === LIFECYCLE.ACTIVE && row.deduplicationFingerprint === fingerprint);
    if (twin) {
      return { ok: true, recordId: twin.id, duplicate: true, duplicateMessage: "يوجد سجل نشط بنفس البيانات ورقم الجوال — فتحنا السجل الحالي بدل إنشاء نسخة مكررة.", matchingPending: false, matches: 0 };
    }
  }
  const fields = recordFields(check.value, {
    officeId, brokerId: actor.uid, sourceType: "BROKER_DIRECT", sourceReference: `office-os:${actor.uid}`, existing, now
  });
  if (!existing) fields.deduplicationFingerprint = recordFingerprint(check.value, officeId);
  await ctx.store.set(["offices", officeId, "opportunities", id], fields);
  const matching = await runMatchingSafely(ctx, officeId, id);
  return { ok: true, recordId: id, created: !existing, ...matching };
}

async function linkedJourneys(ctx, officeId, recordId) {
  const journeys = await ctx.store.list(["offices", officeId, "journeys"], 300);
  return journeys.filter((j) => j.offerId === recordId || j.requestId === recordId);
}

export async function removeRecord(ctx, { actor, officeId, recordId, reason = "" }) {
  const segments = ["offices", officeId, "opportunities", recordId];
  const record = await ctx.store.get(segments);
  if (!record || String(record.officeId || officeId) !== officeId) throw ctx.deps.appError("record_not_found", 404, "السجل غير موجود");
  const lifecycle = lifecycleOf(record);
  if (lifecycle === LIFECYCLE.DELETED) return { ok: true, mode: "deleted", duplicate: true };
  const journeys = await linkedJourneys(ctx, officeId, recordId);
  if (journeys.some(isJourneyOpen)) {
    throw ctx.deps.appError("record_in_open_journey", 409, "السجل مرتبط بفرصة مفتوحة — أغلق الفرصة أولًا ثم احذفه");
  }
  const now = ctx.now();
  const mode = journeys.length ? "archived" : "deleted";
  await ctx.store.set(segments, mode === "archived"
    ? { lifecycleStatus: LIFECYCLE.ARCHIVED, archivedAt: now.toISOString(), archivedBy: actor.uid, archiveReason: String(reason || "").slice(0, 200), updatedAt: now, version: Number(record.version || 1) + 1 }
    : { lifecycleStatus: LIFECYCLE.DELETED, deletedAt: now.toISOString(), deletedBy: actor.uid, deletionReason: String(reason || "").slice(0, 200), updatedAt: now, version: Number(record.version || 1) + 1 });
  // Inactive path of the matching pipeline supersedes its matches and expires reviews.
  await runMatchingSafely(ctx, officeId, recordId);
  return { ok: true, mode };
}

export async function restoreRecord(ctx, { actor, officeId, recordId }) {
  const segments = ["offices", officeId, "opportunities", recordId];
  const record = await ctx.store.get(segments);
  if (!record) throw ctx.deps.appError("record_not_found", 404, "السجل غير موجود");
  if (lifecycleOf(record) !== LIFECYCLE.ARCHIVED) return { ok: true, duplicate: true };
  const now = ctx.now();
  await ctx.store.set(segments, { lifecycleStatus: LIFECYCLE.ACTIVE, restoredAt: now.toISOString(), restoredBy: actor.uid, archivedAt: null, updatedAt: now, version: Number(record.version || 1) + 1 });
  const matching = await runMatchingSafely(ctx, officeId, recordId);
  return { ok: true, ...matching };
}

/**
 * Manual search: every eligible counterpart scored by the real engine (no persistence).
 * Candidates below the automatic threshold are included and flagged, so the broker can
 * still decide — the numbers are the engine's, never cosmetic.
 */
export async function findCandidates(ctx, { officeId, recordId, limit = 10 }) {
  const record = await ctx.store.get(["offices", officeId, "opportunities", recordId]);
  if (!record) throw ctx.deps.appError("record_not_found", 404, "السجل غير موجود");
  if (lifecycleOf(record) !== LIFECYCLE.ACTIVE) return { ok: true, candidates: [], inactive: true };
  const source = opportunityToMatchInput(record, { id: recordId });
  const all = await ctx.store.list(["offices", officeId, "opportunities"], 300);
  const journeys = await ctx.store.list(["offices", officeId, "journeys"], 300);
  const inJourney = new Set(journeys.filter(isJourneyOpen).flatMap((j) => [`${j.offerId}|${j.requestId}`]));
  const candidates = [];
  for (const row of all) {
    if (row.id === recordId || lifecycleOf(row) !== LIFECYCLE.ACTIVE) continue;
    if (!counterpartsEligible(record, row)) continue;
    const scored = scoreMatch(source, opportunityToMatchInput(row, { id: row.id }));
    if (!scored.eligible) continue;
    const offerId = kindOf(record) === "OFFER" ? recordId : row.id;
    const requestId = kindOf(record) === "OFFER" ? row.id : recordId;
    const level = compatibilityLevel(scored.score);
    candidates.push({
      recordId: row.id,
      score: scored.score,
      level: level.label,
      levelKey: level.key,
      belowThreshold: scored.score < MATCH_THRESHOLD,
      reasons: (scored.reasons || []).slice(0, 4),
      warnings: (scored.warnings || []).slice(0, 3),
      inOpenJourney: inJourney.has(`${offerId}|${requestId}`)
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  return { ok: true, candidates: candidates.slice(0, Math.min(20, Math.max(1, limit))) };
}

/** Broker picked a pair by hand: persist the match and its review task. */
export async function pairRecords(ctx, { officeId, recordId, counterpartId }) {
  if (typeof ctx.deps.persistManualPair !== "function") throw ctx.deps.appError("pairing_unavailable", 503, "تعذر إنشاء المطابقة الآن");
  const [a, b] = await Promise.all([
    ctx.store.get(["offices", officeId, "opportunities", recordId]),
    ctx.store.get(["offices", officeId, "opportunities", counterpartId])
  ]);
  if (!a || !b) throw ctx.deps.appError("record_not_found", 404, "السجل غير موجود");
  if (lifecycleOf(a) !== LIFECYCLE.ACTIVE || lifecycleOf(b) !== LIFECYCLE.ACTIVE) throw ctx.deps.appError("record_inactive", 409, "أحد السجلين غير نشط");
  if (!counterpartsEligible(a, b)) throw ctx.deps.appError("pair_ineligible", 409, "السجلان غير متوافقين في النوع أو الغرض");
  const result = await ctx.deps.persistManualPair({ officeId, recordId, counterpartId });
  if (result?.skipped) {
    if (result.reason === "journey_active") return { ok: true, journeyId: result.journeyId, alreadyOpen: true };
    throw ctx.deps.appError("pair_rejected", 409, "تعذر إنشاء المطابقة لهذين السجلين");
  }
  return { ok: true, matchId: result.matchId, operationId: result.operationId };
}
