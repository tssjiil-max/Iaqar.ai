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
| `DATA_EXTRACTED` | **Partial** — Arabic text parsing only (money, area, rooms, phone, district, transaction type, urgency, financing, direct-owner flags). No OCR, PDF, Word, Excel or audio. Raw / extracted / normalized / broker-confirmed layers are **not** separated. | `worker/src/index.js` `parseRealEstateMessage`, `structuredPublicIntakeToParsed` |
| `OPPORTUNITY_CREATED_OR_UPDATED` | **Partial** — writes `offices/{id}/opportunities/{opp_intake_*}` **and** a parallel `clients`/`owners` record. Missing most §11 fields. | `worker/src/index.js` `handlePublicIntakeMatching` |
| `DATA_COMPLETENESS_EVALUATED` | **Partial** — a `completeness` integer and `missingFieldsJson` are computed and stored, but nothing gates matching on them and there is no missing-data operation. | `worker/src/index.js` `parseRealEstateMessage` |
| `MATCHING_REQUESTED` | **Real (Phase 4)** — automatic after public/shared intake, Add Opportunity persist, and Opportunity Bank edit/archive/restore/delete via `POST /matching/run`. | `worker/src/index.js` `findAndSaveMatches`, `findAndSaveMatchesForOpportunity`; `public/js/add-opportunity.js`; `public/js/opportunity-bank.js` |
| `MATCH_CREATED` | **Real (Phase 4)** — versioned ID `(pair, matchingRuleVersion, dataVersion)`; prior current matches for the same pair/rule are `superseded`. | `worker/src/matching-engine.js`; `worker/src/index.js` `persistScoredMatch` |
| `OPERATION_CREATED` | **Not implemented** — there is no `operations` collection. Operations are derived on the client from `matches`, `deals` and `publicIntake` snapshots and are never persisted, so there is no `deduplicationKey` and no operation status. | `public/js/workflow-office.js` `matchOperation`, `dealOperation`, `intakeOperation` |
| `NOTIFICATION_CREATED` | **Real, now preference-aware** — writes `offices/{id}/alerts/alt_{matchId}` then pushes over FCM HTTP v1 with a deep link. Stale FCM tokens are disabled automatically. Phase 1 added the office notification-preference gate. | `worker/src/index.js` `sendOfficeMatchNotifications`, `sendOfficePush` |
| `BROKER_ACTION` | **Real** — `iaqar:workflow-action` → `POST /workflow/action` with an ID-token check; every progression writes a timeline entry. | `public/js/workflow-office.js`; `worker/src/index.js` `handleWorkflowAction` |
| `MESSAGE_DRAFT_CREATED` | **Partial** — Arabic drafts are generated per stage and role and opened in `wa.me` for the broker to send. Drafts are **not persisted**; there is no `messages` collection, no channel/recipient/send-state record and no Telegram path. | `public/js/workflow-office.js` `whatsappMessage`, `openWorkflowWhatsApp` |
| `EXTERNAL_RESPONSE_RECEIVED` | **Partial** — only inbound WhatsApp messages arrive back, and they are treated as new sources rather than as replies correlated to an operation. | `worker/src/index.js` `receiveMetaWebhook` |
| `NEXT_OPERATION_CREATED` | **Not implemented** | — |
| `COMPLETED` | **Partial** — a deal reaching `closed` closes sibling matches and records a timeline entry. There is no completion operation or success badge. | `worker/src/index.js` `finalizeDealAndCloseSiblings` |

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
| Deterministic alert ID `alt_{matchId}` | One alert per match. | `worker/src/index.js` `sendOfficeMatchNotifications` |
| Deterministic timeline event IDs (`evt_match_created`, …) | No duplicate timeline entries for the same transition. | `worker/src/index.js` `addWorkflowTimeline` |
| `deliveryId` de-dup set for foreground pushes | A push handled by both the SW and the page shows once. | `public/js/workflow-office.js` `handleForegroundPayload` |
| `intakeProcessing` in-flight set | The client does not fire the same pipeline call twice concurrently. | `public/js/workflow-office.js` |
| `officeNameClaims` document ID = normalized key, reserved inside a Firestore transaction | Two offices cannot register equivalent names, even concurrently. | `public/js/office-settings.js` `reserveOfficeName` + `firestore.rules` |

Missing idempotency signals from §24: normalized URL, uploaded-file checksum, external
webhook event ID, and office+content fingerprint.

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

Everything else in this document is unchanged by Phase 1.
