# IAQAR.AI Event Workflow

## Canonical workflow

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

Every handler must be idempotent, retry-safe, tenant-aware, auditable, and capable of recording failure without corrupting the Opportunity. A failed external adapter must not undo safely persisted internal data.

## Current connected flows

### Public intake

`access-gate.js` stores a validated `publicIntake` record under the target office, uploads optional owner media to an office/intake-scoped R2 key, and calls the Worker matching pipeline. The Worker normalizes the source, creates/updates existing workflow records, runs matching, and creates an alert/push only when it finds an actionable match.

This is existing functionality and is not a substitute for the Phase 2 unified Opportunity intake acceptance suite.

### Official WhatsApp intake

The Worker verifies the Meta webhook token/HMAC, maps the official phone-number ID to one office, stores inbound content, parses it, and invokes matching. Outbound message routes remain blocked. Production connection still depends on deployed Meta credentials and verified callbacks.

### Match notification

```text
valid match
-> read offices/{officeId}/officeSettings/notifications
-> if matches enabled:
     upsert deterministic alert
     load active office devices
     send FCM with office/record deep link
     disable stale registrations on recognized FCM errors
-> if matches disabled:
     preserve match and operation data
     skip alert/push for that category
```

The browser also checks the persisted match preference before showing its local match notification. If push permission is unavailable, the Operations Center remains the in-app action surface.

### Follow-up notification

The hourly Worker schedule queries due match/deal workflow records, skips completed records and recently notified records, checks the `appointments` preference, writes a deduplicated alert, marks attention required, and sends office-scoped push.

## Phase 1 settings event

```text
OFFICE_SETTINGS_OPENED
-> private profile/settings loaded for officeId
-> broker edits approved fields/preferences
-> OFFICE_NAME_VALIDATED
-> MEDIA_VALIDATED_AND_CROPPED
-> MEDIA_UPLOADED (manager-authorized, tenant-scoped)
-> Firestore transaction:
     OFFICE_NAME_CLAIMED
     OFFICE_PROFILE_UPDATED
     PUBLIC_PROFILE_UPDATED
     NOTIFICATION_PREFERENCES_UPDATED
     COOPERATION_MODE_UPDATED
     AUDIT_LOG_CREATED
-> removed R2 objects cleaned after profile commit
-> OFFICE_CARD_REFRESHED
```

If a normalized name is already claimed, the transaction fails and no office profile write commits. If an image upload fails, profile persistence does not begin. If post-commit cleanup of a removed object fails, the profile remains safe and no longer references it; the UI reports the cleanup limitation.

## Required later-phase event rules

- Sources and webhook events receive deduplication identities before Opportunity creation.
- Matching runs automatically after every relevant source/data/cooperation event.
- No-match storage does not emit an Operation.
- Match, Operation, notification, and cooperation handlers use deterministic deduplication keys.
- Message drafting and delivery are separate events. A draft is never marked sent from intent alone.
- Cooperation acceptance/revocation updates access projections without changing origin ownership.
- Retries record attempt/failure state in a Firestore-backed job/outbox when durable retry is needed; no large broker dependency is currently approved.
