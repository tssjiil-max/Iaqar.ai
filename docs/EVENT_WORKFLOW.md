# IAQAR.AI — Event Workflow

Approved event chain (directive §22). This document defines the target contract. Phase 1 does not
implement the outbox; the sections below mark what exists today so no reader mistakes design for
delivery.

---

## 1. Canonical chain

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

## 2. Transport

A Firestore-backed outbox, not a new message broker.

`eventOutbox/{eventId}` (planned, Phase 2):

| Field | Purpose |
| --- | --- |
| `eventId` | ULID; also the document id |
| `officeId` | tenant key, present on every event |
| `type` | one of the chain steps above |
| `payload` | minimal references (ids), never large blobs |
| `dedupeKey` | natural key of the triggering fact (e.g. `wa:{messageId}`, `sha256:{checksum}`) |
| `status` | `pending`, `processing`, `done`, `failed` |
| `attempts`, `lastError`, `nextAttemptAt` | retry state |
| `createdAt`, `updatedAt` | timestamps |

Drained by the Worker's `scheduled` handler and opportunistically after the write that produced
the event. Handler results are recorded per `(eventId, handlerName)` so a retry can never apply an
effect twice.

## 3. Handler contract

Every handler must be:

* **Idempotent** — re-running with the same `eventId` produces no additional records.
* **Retry-safe** — failure leaves the Opportunity untouched and schedules a retry with backoff.
* **Tenant-aware** — reads `officeId` from the event and re-checks it against every document it
  touches.
* **Auditable** — writes an `auditLogs` entry for ownership-sensitive effects.
* **Failure-recording** — stores `lastError` on the event instead of throwing away the context.

A failing external adapter (WhatsApp, Telegram, OCR) marks its own event failed. It must never
leave an Opportunity half-written.

## 4. Step-by-step contract

| Step | Trigger | Effect | Status today |
| --- | --- | --- | --- |
| `SOURCE_RECEIVED` | public link submit, paperclip upload, WhatsApp webhook, Telegram webhook, share target | validate size/type, assign `sourceId` | partial: WhatsApp webhook (`worker/src/index.js:934`) and public intake (`:744`) |
| `SOURCE_STORED` | after validation | persist raw payload/file (R2) + `opportunitySources` row | partial: R2 for intake media, `inbox` for WhatsApp |
| `ANALYSIS_REQUESTED` | source stored | enqueue extraction for the source type | not implemented as an event |
| `DATA_EXTRACTED` | adapter returns | store raw / extracted / normalized values separately | partial: single-pass Arabic text parser (`worker/src/index.js:1274`) |
| `OPPORTUNITY_CREATED_OR_UPDATED` | extraction done | upsert one Opportunity, bump `version` | partial: `offices/{id}/opportunities/{id}` written with a reduced schema |
| `DATA_COMPLETENESS_EVALUATED` | opportunity write | compute completeness; if below threshold emit a missing-data Operation instead of matching | not implemented |
| `MATCHING_REQUESTED` | completeness sufficient, or a relevant update | enqueue matching for the opportunity | partial: matching is called inline |
| `MATCH_CREATED` | matcher found an eligible counterpart above threshold | write a Match keyed by canonical pair + rule version + data version | partial: matches exist, identity key does not |
| `OPERATION_CREATED` | actionable match / missing data / cooperation / reply | write one Operation with `deduplicationKey` | not implemented (workspace items are derived client-side) |
| `NOTIFICATION_CREATED` | operation created | route to office/broker **after** consulting `officeSettings/notifications` and `officeSettings/broker-{uid}` | partial: FCM send exists; preference model landed in Phase 1 and is not yet consulted by the Worker |
| `BROKER_ACTION` | broker acts in the Operations Center | update operation status, emit follow-ups | partial: `POST /workflow/action` |
| `MESSAGE_DRAFT_CREATED` | action needs communication | store an Arabic draft with channel, recipient, related ids and `sendState` | not implemented |
| `EXTERNAL_RESPONSE_RECEIVED` | webhook or manual confirmation | update conversation, emit next operation | not implemented |
| `NEXT_OPERATION_CREATED` / `COMPLETED` | chain continues or closes | | not implemented |

## 5. Automatic rematching (directive §14)

Rematch is emitted — never a broker button — on: new offer, new request, new owner submission, new
customer submission, opportunity data completion, relevant opportunity update, new external-source
opportunity, and cooperation-scope updates. A manual maintenance trigger may exist for
administrators only.

## 6. Deduplication signals (directive §24)

`dedupeKey` is derived from, in priority order: external message id, external webhook event id,
normalized URL, uploaded file checksum, then `officeId` + normalized content fingerprint.
Duplicate receipt must not create duplicate opportunities, matches, operations, notifications or
cooperation requests. When the signal is ambiguous the system links a possible duplicate for
review instead of merging broker-confirmed data.

## 7. Notification preference gate (Phase 1 groundwork)

The notification router resolves, in order:

1. `offices/{officeId}/officeSettings/broker-{uid}` — if present, it decides for that broker.
2. `offices/{officeId}/officeSettings/notifications` — office default.
3. Built-in defaults — all six categories enabled.

Category mapping: `matches` → new valid match; `ownerCustomer` → owner/customer submissions and
replies; `cooperation` → cooperation requests, acceptances, rejections; `messages` → messages
needing a response; `appointments` → appointments and follow-ups; `system` → important system
events. Phase 1 delivers the model, storage, rules and UI. Wiring the Worker's send path to this
gate is Phase 5.
