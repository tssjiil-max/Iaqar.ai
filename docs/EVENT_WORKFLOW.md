# IAQAR.AI — Event Workflow

This document describes the approved event flow, then states precisely which parts run
today and which are not implemented. It is written so that no reader can mistake the
target flow for the current flow.

---

## 1. Approved canonical flow (§22 of the constitution)

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

Mandatory properties of **every** handler:

- **Idempotent** — replaying the same event must not create a second opportunity,
  match, operation, notification or cooperation request.
- **Retry-safe** — a partial failure leaves a recorded failure state, never a corrupt
  opportunity. A failing external integration must never damage the opportunity.
- **Tenant-aware** — `officeId` is resolved and checked before any read or write.
- **Auditable** — the handler records what it did.
- **Failure-recording** — errors are persisted, not just logged to the console.

Transport: a **database-backed job/outbox pattern inside Firestore**, drained by the
existing Cloudflare Worker (cron plus in-request draining). No new message broker is to
be introduced.

## 2. Current implementation status

| Event | Status | Where |
| --- | --- | --- |
| `SOURCE_RECEIVED` | **Partial** — three real sources: public office link form, PWA share target, WhatsApp Cloud API webhook. No unified intake field, no Telegram. | `public/js/access-gate.js` `intakeForm`; `public/share-target.html` + `workflow-office.js` `submitPendingShare`; `worker/src/index.js` `receiveMetaWebhook` |
| `SOURCE_STORED` | **Partial** — public form writes `offices/{id}/publicIntake/{id}` and uploads media to R2 first; WhatsApp writes `offices/{id}/inbox/{id}`. Shared text is passed inline to the pipeline and is not stored as its own source record. | `access-gate.js`; `worker/src/index.js` `saveInboundMessage` |
| `ANALYSIS_REQUESTED` | **Not an event** — analysis is a synchronous function call inside the intake request. | `worker/src/index.js` `handlePublicIntakeMatching`, `processInboundMessage` |
| `DATA_EXTRACTED` | **Real on the Phase 9A staging Add Opportunity path** — authenticated direct text/URL extraction plus Workers AI OCR, document conversion and Arabic ASR. Missing values stay empty. Legacy public/WhatsApp intake still uses its existing Arabic parser. | `POST /opportunity/extract`; `worker/src/opportunity-extraction.js`; `public/js/add-opportunity.js` |
| `OPPORTUNITY_CREATED_OR_UPDATED` | **Partial** — writes `offices/{id}/opportunities/{opp_intake_*}` **and** a parallel `clients`/`owners` record. Missing most §11 fields. | `worker/src/index.js` `handlePublicIntakeMatching` |
| `DATA_COMPLETENESS_EVALUATED` | **Partial** — a `completeness` integer and `missingFieldsJson` are computed and stored, but nothing gates matching on them and there is no missing-data operation. | `worker/src/index.js` `parseRealEstateMessage` |
| `MATCHING_REQUESTED` | **Real (Phase 4)** — automatic after public/shared intake, Add Opportunity persist, and Opportunity Bank edit/archive/restore/delete via `POST /matching/run`. | `worker/src/index.js` `findAndSaveMatches`, `findAndSaveMatchesForOpportunity`; `public/js/add-opportunity.js`; `public/js/opportunity-bank.js` |
| `MATCH_CREATED` | **Real (Phase 4)** — versioned ID `(pair, matchingRuleVersion, dataVersion)`; prior current matches for the same pair/rule are `superseded`. | `worker/src/matching-engine.js`; `worker/src/index.js` `persistScoredMatch` |
| `OPERATION_CREATED` / `OPERATION_UPSERTED` | **Real (Phase 5)** — persisted `offices/{id}/operations/{op_*}` with `deduplicationKey`. Match path upserts `MATCH_REVIEW`; missing fields upsert `MISSING_DATA`; explicit cooperation upserts `COOPERATION_*`. Operations are **persisted, not derived**. | `worker/src/operations-domain.js`; `worker/src/operations-service.js` `createMatchReviewBundle`, `upsertMissingDataForOpportunity`; `POST /operations/*` |
| `NOTIFICATION_CREATED` / `IN_APP_NOTIFICATION` | **Real (Phase 5)** — auditable `offices/{id}/notifications/{nt_*}` linked to the Operation. Legacy `alerts/alt_{matchId}` may still be written for older clients. Preferences gate push. | `buildInAppNotification`; `sendOfficePush` |
| `PUSH_QUEUED_IF_ALLOWED` | **Real (Phase 5)** — when prefs allow and the notification is newly created, FCM HTTP v1 is attempted with lock-screen-safe copy; `providerState.push` records `QUEUED` / send / fail. Device delivery is **not** claimed without provider confirmation. | `operations-service.js` `recordNotificationPushResult`; `sendOfficePush` |
| `BROKER_ACTION` | **Real** — Operation lifecycle via `POST /operations/action`; cooperation accept/reject/revoke via `POST /cooperation/lifecycle` (+ scope revoke); legacy match/deal progression via `iaqar:workflow-action` → `POST /workflow/action`. | `public/js/workflow-office.js`; `public/js/opportunity-bank.js`; `worker/src/cooperation-phase6-service.js` |
| `COOPERATION_ACCEPTED` / `COOPERATION_REJECTED` / `COOPERATION_REVOKED` | **Real (Phase 6)** — trusted Worker lifecycle; auditLogs written; accept writes minimum `sharedOpportunities`; revoke removes/invalidates projections. | `worker/src/cooperation-phase6-service.js`; `POST /cooperation/lifecycle`, `/cooperation/scope-revoke` |
| `MESSAGE_DRAFT_CREATED` | **Real (Phase 7)** — persisted `offices/{id}/messages/{msg_*}` via `POST /messages/draft`. Arabic templates; WhatsApp `adapter_ready` (`wa.me`) and Telegram `simulated` (`t.me/share`). External handoff via `POST /messages/handoff` sets `OPENED_EXTERNAL` only — **not** provider `SENT`/`DELIVERED`. | `worker/src/messaging-domain.js`; `public/js/messaging-domain.js`; `workflow-office.js` `persistAndOpenMessageDraft` |
| `EXTERNAL_RESPONSE_RECEIVED` | **Partial** — only inbound WhatsApp messages arrive back, and they are treated as new sources rather than as replies correlated to an operation. | `worker/src/index.js` `receiveMetaWebhook` |
| `NEXT_OPERATION_CREATED` | **Not implemented** (beyond Phase 7 draft/handoff) | — |
| `COMPLETED` | **Partial** — Operation `COMPLETED` / `DISMISSED` / `EXPIRED` via lifecycle actions; a deal reaching `closed` closes sibling matches and records a timeline entry. | `applyOperationLifecycle`; `finalizeDealAndCloseSiblings` |

## 3. The only scheduled worker today

`worker/wrangler.toml` declares `crons = ["0 * * * *"]`. The handler
(`processOverdueFollowups`) runs two collection-group queries for matches and deals whose
`nextFollowUpAt` has passed and sends a reminder push per office. This is the seed the
event outbox will be drained by; it is not an outbox yet.

## 4. Idempotency mechanisms that exist today

| Mechanism | Guarantees | Location |
| --- | --- | --- |
| `publicIntake.status === "processed"` short-circuit returning `duplicate: true` | Replaying `POST /pipeline/public-intake` does not create a second record set. | `worker/src/index.js` `handlePublicIntakeMatching` |
| Deterministic record IDs `cli_intake_{intakeId}`, `own_intake_{intakeId}`, `opp_intake_{intakeId}` | Re-processing overwrites rather than duplicates. | same |
| Versioned match ID `mat_{sha256(officeId\|pair\|ruleVersion\|dataVersion)[0..36]}` + supersede of prior current | Same tuple is idempotent; data changes create a new current match. | `worker/src/matching-engine.js` `buildMatchId`; `persistScoredMatch` |
| Deterministic alert ID `alt_{matchId}` | One alert per match (legacy). | `worker/src/index.js` `sendOfficeMatchNotifications` |
| Operation ID `op_{sha256(deduplicationKey)[0..40]}` | One Operation per dedup key; terminal statuses not reopened. | `worker/src/operations-domain.js`; `upsertOperationDocument` |
| Notification ID `nt_{sha256("notif\|"+dedup)[0..40]}` | One notification per Operation dedup key. | `buildInAppNotification`; `upsertNotificationDocument` |
| Deterministic timeline event IDs (`evt_match_created`, …) | No duplicate timeline entries for the same transition. | `worker/src/index.js` `addWorkflowTimeline` |
| `deliveryId` de-dup set for foreground pushes | A push handled by both the SW and the page shows once. | `public/js/workflow-office.js` `handleForegroundPayload` |
| `intakeProcessing` in-flight set | The client does not fire the same pipeline call twice concurrently. | `public/js/workflow-office.js` |
| `officeNameClaims` document ID = normalized key, reserved inside a Firestore transaction | Two offices cannot register equivalent names, even concurrently. | `public/js/office-settings.js` `reserveOfficeName` + `firestore.rules` |

Missing idempotency signals from §24: normalized URL, uploaded-file checksum, external
webhook event ID, and office+content fingerprint (partially covered for intake in Phase 2).

## 5. Phase 1 event-related changes

Phase 1 does not introduce the event outbox. It makes two flow-level changes:

1. **Notification preferences are consulted before sending.** `sendOfficePush` now reads
   `offices/{officeId}/officeSettings/notifications` and maps the push `type` to a
   preference key (`match` → `matchNotifications`, `deal` → `matchNotifications`,
   `client_request`/`owner_offer` → `ownerCustomerNotifications`, `cooperation*` →
   `cooperationNotifications`, `message` → `messageNotifications`,
   `appointment`/`followup` → `appointmentNotifications`, anything else →
   `systemNotifications`). A disabled category returns
   `{ skipped: true, reason: "notifications_disabled" }` and sends nothing.
   `notification_test` always sends, because it is the broker actively testing the
   channel. A missing preference document means "all enabled", so existing offices keep
   their current behaviour.
2. **The Operations Center no longer fabricates events.** The six hard-coded demo
   operations were removed from `public/index.html`; the list starts empty and shows the
   approved Arabic empty state until `iaqar:operations-data` delivers real records.

## 6. Phase 5 Operations / notification flow

Phase 5 stops **before** messaging (`MESSAGE_DRAFT_CREATED` and channel adapters remain
Phase 7). Canonical slice delivered:

```
MATCH_CREATED
  → OPERATION_UPSERTED          (persisted MATCH_REVIEW; deduplicationKey)
  → IN_APP_NOTIFICATION         (persisted notifications/{nt_*})
  → PUSH_QUEUED_IF_ALLOWED      (prefs gate; lock-screen-safe copy; no delivery claim)
```

Parallel Phase 5 upserts (same persistence model, not Match-derived):

- Missing required opportunity fields → `MISSING_DATA` Operation (+ notification/push).
- Explicit cooperation request/response → `COOPERATION_REQUEST` /
  `COOPERATION_RESPONSE` via `POST /operations/from-cooperation`.

Client surface:

- Operations Center binds to `offices/{officeId}/operations` with
  `status in (OPEN, IN_PROGRESS, WAITING_EXTERNAL_RESPONSE)` only.
- Empty state copy: «لا توجد فرص حالياً» / «ستظهر الفرص المباشرة هنا».
- Lifecycle mutations go through Worker `POST /operations/action` — clients cannot
  write Operations or Notifications documents.

Honesty boundary: FCM send attempts and `providerState` updates are recorded; the
system does **not** mark `DELIVERED` unless a real provider confirmation exists.

## 7. Phase 6 cooperation lifecycle flow

Phase 6 stops **before** messaging (`MESSAGE_DRAFT_CREATED` and channel adapters remain
Phase 7). Explicit cooperation only — no automatic broker recommendations (Q-4).

Trusted Worker flow:

```
COOPERATION_REQUEST (PENDING, explicit)
  → BROKER_ACTION ACCEPT | REJECT | REVOKE
       (POST /cooperation/lifecycle — actor must be target for accept/reject;
        origin or target for revoke)
  → cooperationRequests status patched (idempotent terminal states)
  → ACCEPT: write minimum sharedOpportunities under target office
            (contacts empty; currentOwningOfficeId stays origin)
  → REJECT: origin opportunity status → REJECTED; no projection
  → REVOKE: delete or stamp revokedAt on sharedOpportunities;
            origin opportunity status → ENDED; cooperating party loses future access
  → auditLogs entry under each relevant office (sanitized details)
  → COOPERATION_* Operation upsert via existing Phase 5 path when applicable
```

Scoped bank sharing revoke:

```
ACTIVE bankSharingScopes
  → POST /cooperation/scope-revoke
  → scope status REVOKED + revokedAt
  → shared projection cleanup for in-scope opportunities
  → auditLogs BANK_SHARING_SCOPE_REVOKED
```

Mode enforcement:

- `DISABLED` — blocks new explicit requests and accepts.
- `APPROVAL_REQUIRED` — default; every request needs broker approval.
- `SMART_AUTOMATIC` — stored only; does **not** auto-accept or recommend brokers;
  behaviour falls back to explicit approval. `createsAutomaticCooperation` remains
  false.

## 8. Phase 7 smart message draft flow

Phase 7 stops **before** automatic provider send (Q-3 unresolved) and before Phase 8
hardening. Drafts + external handoff only.

```
BROKER_ACTION (Match / communication Operation, or workflow overlay)
  → MESSAGE_DRAFT_CREATED
       POST /messages/draft → offices/{officeId}/messages/{msg_*}
       sendState=DRAFT, deliveryState=NOT_APPLICABLE
  → broker opens external handoff URL (wa.me or t.me/share)
  → POST /messages/handoff
       sendState=OPENED_EXTERNAL (not SENT)
       deliveryState stays NOT_APPLICABLE
       providerConfirmedSend/Delivery=false
```

Adapter honesty:

- WhatsApp: `adapter_ready` — inbound Cloud API may exist; outbound Cloud API paths
  containing `messages`/`send` still return 403 `outbound_disabled` except the draft
  APIs above.
- Telegram: `simulated` — share URL + webhook validation fixture structure; Bot API
  inbound/outbound disabled.
