import {
  ORCHESTRATOR_EVENT,
  orchestratorRoute
} from "./central-orchestrator-domain.js";

const EVENT_SET = new Set(Object.values(ORCHESTRATOR_EVENT));

function clean(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

export function normalizeOrchestratorEvent(event) {
  return clean(event, 80).toUpperCase();
}

export function buildOrchestratorEventId({ event, officeId = "", entityId = "", occurrenceId = "" } = {}) {
  const normalized = normalizeOrchestratorEvent(event);
  const office = clean(officeId, 120);
  const entity = clean(entityId, 180);
  const occurrence = clean(occurrenceId, 180);
  if (!normalized || !office || !entity) return "";
  return ["orc", normalized.toLowerCase(), office, entity, occurrence || "v1"].join(":");
}

export function validateOrchestratorEnvelope({ event, eventId, context = {} } = {}) {
  const normalizedEvent = normalizeOrchestratorEvent(event);
  if (!EVENT_SET.has(normalizedEvent)) {
    return { ok: false, error: "unknown_event", event: normalizedEvent };
  }
  const route = orchestratorRoute(normalizedEvent);
  if (route.error || !route.owner) {
    return { ok: false, error: route.error || "route_missing", event: normalizedEvent };
  }
  const normalizedEventId = clean(eventId, 420);
  if (!normalizedEventId) {
    return { ok: false, error: "event_id_required", event: normalizedEvent };
  }
  const officeId = clean(context.officeId, 120);
  const entityId = clean(context.entityId, 180);
  if (!officeId || !entityId) {
    return { ok: false, error: "event_context_required", event: normalizedEvent };
  }
  return {
    ok: true,
    event: normalizedEvent,
    eventId: normalizedEventId,
    route,
    context: { ...context, officeId, entityId }
  };
}

/**
 * Dispatch a deterministic domain event to only the targets declared by the
 * orchestrator route. A caller cannot inject an arbitrary target.
 *
 * adapters: { [ownerName]: async ({event,eventId,owner,target,context}) => result }
 * claimEvent: optional durable idempotency claim. Return false for duplicate.
 * deferredTargets: explicit targets whose work is intentionally activated by a
 * later user/domain event (for example negotiation after a Match is created).
 */
export async function dispatchOrchestratorEvent({
  event,
  eventId,
  context = {},
  adapters = {},
  claimEvent = null,
  deferredTargets = []
} = {}) {
  const envelope = validateOrchestratorEnvelope({ event, eventId, context });
  if (!envelope.ok) return envelope;

  if (typeof claimEvent === "function") {
    const claimed = await claimEvent(envelope);
    if (claimed === false || claimed?.duplicate === true) {
      return {
        ok: true,
        idempotent: true,
        event: envelope.event,
        eventId: envelope.eventId,
        owner: envelope.route.owner,
        targets: [],
        trace: []
      };
    }
  }

  const deferred = new Set((deferredTargets || []).map((value) => clean(value, 120)).filter(Boolean));
  const trace = [];

  for (const target of envelope.route.next) {
    if (deferred.has(target)) {
      trace.push({ target, status: "deferred" });
      continue;
    }
    const adapter = adapters?.[target];
    if (typeof adapter !== "function") {
      return {
        ok: false,
        error: "adapter_missing",
        event: envelope.event,
        eventId: envelope.eventId,
        owner: envelope.route.owner,
        target,
        trace
      };
    }
    try {
      const result = await adapter({
        event: envelope.event,
        eventId: envelope.eventId,
        owner: envelope.route.owner,
        target,
        context: envelope.context
      });
      if (result?.ok === false) {
        return {
          ok: false,
          error: clean(result.error, 160) || "adapter_failed",
          event: envelope.event,
          eventId: envelope.eventId,
          owner: envelope.route.owner,
          target,
          trace: [...trace, { target, status: "failed" }]
        };
      }
      trace.push({ target, status: result?.deferred ? "deferred" : "completed" });
    } catch (error) {
      return {
        ok: false,
        error: "adapter_failed",
        detail: clean(error?.message, 240),
        event: envelope.event,
        eventId: envelope.eventId,
        owner: envelope.route.owner,
        target,
        trace: [...trace, { target, status: "failed" }]
      };
    }
  }

  return {
    ok: true,
    idempotent: false,
    event: envelope.event,
    eventId: envelope.eventId,
    owner: envelope.route.owner,
    targets: [...envelope.route.next],
    trace
  };
}

export function orchestratorRuntimeGuarantees() {
  return Object.freeze({
    arbitraryTargetsAllowed: false,
    eventIdRequired: true,
    officeAndEntityContextRequired: true,
    adapterFailureClaimsSuccess: false,
    duplicateDispatchRepeatsEffects: false,
    domainOwnersRemainAuthoritative: true
  });
}
