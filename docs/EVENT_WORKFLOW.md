# IAQAR.AI — Event Workflow

Documents the ingestion → analysis → matching → operations → notifications →
cooperation event flow. Phase 1 does **not** implement the ingestion/matching
engines; this file records the approved target so later phases stay consistent.

## 1. Canonical event chain (Section 22)

```
SOURCE_RECEIVED
  → SOURCE_STORED
  → ANALYSIS_REQUESTED
  → DATA_EXTRACTED
  → OPPORTUNITY_CREATED_OR_UPDATED
  → DATA_COMPLETENESS_EVALUATED
  → MATCHING_REQUESTED
  → MATCH_CREATED
  → OPERATION_CREATED
  → NOTIFICATION_CREATED
  → BROKER_ACTION
  → MESSAGE_DRAFT_CREATED
  → EXTERNAL_RESPONSE_RECEIVED
  → NEXT_OPERATION_CREATED
  → COMPLETED
```

## 2. Handler contract

Every event handler MUST be:

- **Idempotent** — reprocessing the same event/version produces no duplicate
  Opportunity, Match, Operation, notification, or cooperation request.
- **Retry‑safe** — safe to re‑run after partial failure.
- **Tenant‑aware** — always scoped by `officeId`; never crosses offices except
  through an approved cooperation record.
- **Auditable** — sensitive actions written to internal audit logs.
- **Failure‑isolating** — a failed external integration records failure state
  and never corrupts the Opportunity.

Event transport: database‑backed job/outbox (Firestore + Worker cron/handlers).
No new heavy message‑broker dependency without approval.

## 3. Deduplication signals (Section 24)

Source message id · normalized URL · uploaded file checksum · external webhook
event id · office + normalized content fingerprint · canonical opportunity pair
+ matching rule version + relevant data version. Uncertain duplicates are linked
for review rather than silently merged over broker‑confirmed data.

## 4. Matching (Section 14, 15)

Runs automatically on relevant events (new offer/request, owner/customer
submission, data completion, relevant update, new external source, cooperation
scope change). Compares purpose/city/district/nearby/property‑type/price/area/
rooms/bathrooms/features/completeness/office rules/cooperation permissions.
Produces score, reasons, compatible/mismatch fields, confidence, recommended
action, routing, cooperation recommendation. Idempotent per
(canonical pair, matching rule version, relevant data version). Thresholds are
configurable, not hard‑coded across the UI. No manual "rematch" button in the
normal broker workflow.

## 5. Operations & notifications (Section 16, 17)

An Operation is created **only** for actionable results; a stored, unmatched
Opportunity does **not** create an Operation. No duplicate open Operation for the
same action + source event. Notifications route to the correct office/broker,
respect preferences, link to the Operation, avoid duplicates, and are auditable.
FCM push with in‑app fallback.

## 6. Messages & cooperation (Section 18, 19, 20)

Smart Arabic message drafts are prepared and **reviewed by the broker before
sending by default**; delivery success is only recorded from a real API. Broker
cooperation modes: DISABLED / APPROVAL_REQUIRED (default) / SMART_AUTOMATIC.
Ownership never transfers; cooperating brokers get only approved, minimal,
revocable access with contact info hidden until permitted.

## 7. Phase 1 relevance

Phase 1 implements the **Office Settings** surface that configures inputs to this
workflow — notification preferences and cooperation mode — and the office
identity/link used by ingestion (public link) and outbound materials. The
engines themselves arrive in Phases 2–7.
