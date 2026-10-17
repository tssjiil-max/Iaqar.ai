/** Internal search uses the central router and existing deterministic matching engine.
 * No provider calls, messages, negotiation decisions or cross-office collection reads.
 * Authentication is performed by /os routes before this service is entered.
 */
import { ORCHESTRATOR_EVENT, ORCHESTRATOR_OWNER } from '../central-orchestrator-domain.js';
import { buildOrchestratorEventId, dispatchOrchestratorEvent } from '../central-orchestrator-service.js';
import { findCandidates } from './records-service.js';

export async function searchThroughCentral(ctx, { actor, recordId, limit = 10 }) {
  const officeId = ctx.officeId;
  if (!officeId || !actor?.uid) throw ctx.deps.appError('forbidden', 403, 'يلزم الدخول إلى المكتب');
  if (!recordId) throw ctx.deps.appError('record_id_required', 400, 'حدد الطلب أو العرض أولًا');
  const take = Math.min(10, Math.max(1, Math.floor(Number(limit) || 10)));
  let result;
  let failure;
  const orchestration = await dispatchOrchestratorEvent({
    event: ORCHESTRATOR_EVENT.SEARCH_REQUESTED,
    eventId: buildOrchestratorEventId({ event: ORCHESTRATOR_EVENT.SEARCH_REQUESTED, officeId, entityId: recordId }),
    context: { officeId, entityId: recordId, actorUid: actor.uid },
    adapters: {
      [ORCHESTRATOR_OWNER.MATCHING]: async () => {
        try {
          const found = await findCandidates(ctx, { officeId, recordId, allCandidates: true });
          const seen = new Set();
          const candidates = [];
          for (const candidate of found.candidates) {
            const row = await ctx.store.get(['offices', officeId, 'opportunities', candidate.recordId]);
            // A stable property id is evidence of duplication; similar prices or text are not.
            if (!row || (row.officeId && row.officeId !== officeId)) continue;
            const propertyId = String(row.propertyId || row.canonicalPropertyId || candidate.recordId);
            if (seen.has(propertyId)) continue;
            seen.add(propertyId);
            candidates.push({ ...candidate, officeId, propertyId, reference: `${officeId}:${candidate.recordId}`,
              source: String(row.source || row.intakeOrigin?.source || row.intakeOrigin?.method || 'سجل المكتب').slice(0,80),
              referenceCode: String(row.referenceCode || row.publicReference || candidate.recordId).slice(0,80),
              lastVerifiedAt: row.availabilityConfirmedAt || row.updatedAt || row.createdAt || null });
            if (candidates.length === take) break;
          }
          result = { ...found, candidates };
          return { ok: true };
        } catch (error) {
          failure = error;
          return { ok: false, error: error.code || 'matching_failed' };
        }
      }
    }
  });
  if (failure) throw failure;
  if (!orchestration.ok || !result) throw ctx.deps.appError('central_search_failed', 503, 'تعذر البحث الآن');
  return { ...result, orchestration, messagesSent: 0 };
}
