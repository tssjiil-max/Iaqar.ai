# IAQAR.AI Event Workflow

## Approved event chain

```text
SOURCE_RECEIVED
-> SOURCE_STORED
-> ANALYSIS_REQUESTED
-> DATA_EXTRACTED
-> OPPORTUNITY_CREATED_OR_UPDATED
-> DATA_COMPLETENESS_EVALUATED
-> MATCHING_REQUESTED
-> MATCH_CREATED
-> OPERATION_CREATED
-> NOTIFICATION_CREATED
-> BROKER_ACTION
-> MESSAGE_DRAFT_CREATED
-> EXTERNAL_RESPONSE_RECEIVED
-> NEXT_OPERATION_CREATED
-> COMPLETED
```

Handlers must be idempotent, retry-safe, tenant-aware, auditable, and able to record failure state.

## Current implemented flows

### Public intake

1. Public form writes `offices/{officeId}/publicIntake/{docId}`.
2. Worker `/pipeline/public-intake` reads the intake.
3. Worker parses fields and writes owner/client records.
4. Worker runs matching and writes match records.
5. Match notifications may write alerts and send FCM when configured.

### PWA share target

1. `public/share-target.html` captures shared URL/text.
2. `workflow-office.js` submits to worker `/pipeline/intake` for authenticated office members.
3. Worker processes the incoming message into office-scoped records.

### WhatsApp inbound

1. Meta webhook reaches `/meta/webhook`.
2. Worker validates webhook payload/signature when configured.
3. Worker stores inbound message in office inbox.
4. Worker processes content and matching.

### Operations Center

1. `workflow-office.js` listens to office-scoped `matches`, `deals`, and `publicIntake`.
2. It emits `iaqar:operations-data`.
3. `index.html` renders actionable items in the Operations Center.
4. Phase 1 removed static demo operations from production UI.

## Phase 1 settings workflow

1. Broker opens Office Settings from the logo or cover image.
2. Broker edits approved office data and identity media.
3. Browser validates office name and image type/size.
4. Worker validates auth, office permission, file type, file size, and writes media to existing storage.
5. Client transaction reserves `officeNameClaims/{officeNameKey}` and updates `offices/{officeId}`.
6. Public identity fields mirror to `publicOffices/{officeId}`.
7. Notification preferences and cooperation mode remain private office settings.

## Not implemented yet

- Unified Add Opportunity broker intake (Phase 2).
- Full private Opportunity Bank management (Phase 3).
- Cooperation records, requests, permissions, and revocation (Phase 6).
- Telegram adapter and production outbound channel state tracking (Phase 7).
