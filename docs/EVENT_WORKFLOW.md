# IAQAR.AI — Event Workflow

## Representative flow

```text
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

## Current implementation mapping

| Stage | Current mechanism | Notes |
|---|---|---|
| Source received | Public intake, WA webhook, share-target, Worker `/pipeline/*` | Multiple sources |
| Source stored | `publicIntake`, `inbox`, R2 media | Tenant-scoped |
| Analysis | Worker local parsers (`/pipeline/preview`, intake processing) | Not paid AI |
| Opportunity upsert | `offices/{officeId}/opportunities` | Present in Worker |
| Matching | Worker matching preview + intake match creation | Idempotency hardening in Phase 4 |
| Alerts / FCM | `alerts` + `/fcm/*` send | Respect device registration; Phase 1 adds preference categories |
| Operations UI | `workflow-office.js` listens to matches/deals/publicIntake | Must not show non-actionable bank saves |
| Message drafts | WhatsApp deep links / templates | Auto-send disabled |

## Handler requirements

Every handler must be:

1. Idempotent
2. Retry-safe
3. Tenant-aware (`officeId`)
4. Auditable
5. Able to record failure without corrupting the Opportunity

## Phase 1 office settings events (local)

| Event | Effect |
|---|---|
| `OFFICE_SETTINGS_OPENED` | Overlay shown from logo/cover click |
| `OFFICE_PROFILE_SAVED` | Transaction updates office + claim + publicOffices |
| `OFFICE_MEDIA_UPLOADED` | R2 logo/cover/whatsapp-cover URLs stored |
| `NOTIFICATION_PREFS_SAVED` | `notificationPreferences` on office doc |
| `COOPERATION_MODE_SAVED` | `cooperationMode` on office doc |
| `OPPORTUNITY_BANK_OPENED` | Settings entry opens private bank panel |

## Rematching triggers (target — Phase 4)

New offer/request, owner/customer submission, data completion, relevant update, cooperation scope update. No broker “rematch” button for normal workflow.

## Deduplication signals

Same source message id, normalized URL, file checksum, webhook event id, office+content fingerprint, opportunity pair + match version.
