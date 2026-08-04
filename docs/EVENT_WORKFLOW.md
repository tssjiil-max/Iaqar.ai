# IAQAR.AI — Event Workflow

The platform follows the approved event-driven flow. This document maps each abstract
event to its current implementation and to the phase that completes it.

## Canonical flow (directive §22)

```
SOURCE_RECEIVED → SOURCE_STORED → ANALYSIS_REQUESTED → DATA_EXTRACTED
→ OPPORTUNITY_CREATED_OR_UPDATED → DATA_COMPLETENESS_EVALUATED → MATCHING_REQUESTED
→ MATCH_CREATED → OPERATION_CREATED → NOTIFICATION_CREATED → BROKER_ACTION
→ MESSAGE_DRAFT_CREATED → EXTERNAL_RESPONSE_RECEIVED → NEXT_OPERATION_CREATED → COMPLETED
```

## Mapping to the current implementation

| Event | Implementation today | Idempotency / dedup |
| --- | --- | --- |
| SOURCE_RECEIVED | Meta webhook `/meta/webhook` (HMAC verified), PWA share target → `/pipeline/intake`, public form → `publicIntake` + `/pipeline/public-intake` | Webhook message id / share event id hashed into the inbox document id; Firestore `documentId` create returns 409 on replays |
| SOURCE_STORED | `offices/{officeId}/inbox/{id}` or `publicIntake/{id}` with raw payload capped at 16 KB | Same document id |
| ANALYSIS_REQUESTED / DATA_EXTRACTED | Synchronous in-Worker `parseRealEstateMessage` (rule-based Arabic extraction: kind, propertyType, district, transaction, price range, area, rooms, phone, name, urgency, financing, completeness, confidence) | Deterministic function of the text |
| OPPORTUNITY_CREATED_OR_UPDATED | `clients/…` or `owners/…` + `opportunities/opp_…` derived from the source id | Record ids derived from the source id → re-processing overwrites the same docs |
| DATA_COMPLETENESS_EVALUATED | `completeness` + `missingFieldsJson` stored on the records | — |
| MATCHING_REQUESTED / MATCH_CREATED | `findAndSaveMatches`: counterpart scan, `scoreMatch` (city/district/type/transaction/price-range/area/rooms/readiness, threshold `MATCH_THRESHOLD = 55`), top `MAX_MATCH_RESULTS = 3` | `matchId = mat_ + sha256(officeId\|sorted pair)`; existing match ⇒ skipped. TEST 8 target |
| OPERATION_CREATED | Today: matches/deals stream directly into «مساحة العمل» via Firestore listeners. The dedicated `operations` records with `deduplicationKey` arrive in Phase 5 | Planned: `deduplicationKey = type + sourceEntityId + event version` |
| NOTIFICATION_CREATED | `alerts/{id}` + FCM push (`sendOfficePush`) filtered by the office `notificationPreferences`; stale tokens auto-disabled; foreground dedup by `deliveryId` | Alert id derived from match id / hour bucket |
| BROKER_ACTION | `/workflow/action` state machines (match: active→waiting_response→viewing→negotiation→completed/closed; deal: contact→…→closed/lost) each writing timeline events | Server-side status checks make repeated actions no-ops |
| MESSAGE_DRAFT_CREATED | Arabic drafts built client-side and opened as `wa.me` links — the broker always reviews and sends manually; automatic outbound is blocked (403 routes) | — (stored message records arrive in Phase 7) |
| EXTERNAL_RESPONSE_RECEIVED | Inbound WhatsApp replies land in the same webhook pipeline | Same message-id dedup |
| NEXT_OPERATION_CREATED | Hourly cron `processOverdueFollowups` → follow-up alerts + push (12h re-alert suppression) | Alert id includes an hour bucket |
| COMPLETED | `finalizeDealAndCloseSiblings`: closes the deal, completes the match, auto-closes sibling matches of the same `matchGroupId`, marks client fulfilled / owner sold | Status guards |

## Handler requirements (every phase must preserve)

- **Idempotent**: deterministic document ids derived from source identifiers.
- **Retry-safe**: re-running a handler must converge to the same state (409-tolerant
  creates, merge-style PATCH writes).
- **Tenant-aware**: `officeId` is validated by `authorizeOfficeRequest` before any
  office-scoped write; documents always carry `officeId`.
- **Auditable**: state transitions write timeline events; failures set
  `processingState: failed` + `processingError` on the source document instead of
  corrupting the opportunity.
- **Isolated failures**: an external integration failure (e.g. FCM send) is caught and
  logged; it never rolls back or corrupts the opportunity records.

## Rematching triggers (directive §14 — Phase 4 completes this)

Matching already runs automatically on: new public intake (client/owner), new shared
message, new WhatsApp inbound message. Phase 4 adds: opportunity data completion,
relevant opportunity update, and cooperation-scope updates as triggers, plus a
matching-rule version in the match identity so recalibrations create a new current
match generation without duplicating within a version.

## Queueing

The current pipeline is synchronous inside a single Worker request, which is acceptable
at current volume. If asynchronous processing becomes necessary, the approved pattern is
a Firestore-backed job/outbox collection (`backgroundJobs`/`eventOutbox`) processed by
the existing cron — not a new message-broker dependency (directive §22).
