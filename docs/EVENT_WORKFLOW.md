# Event Workflow

## Principles

Events and handlers are internal implementation details. They must be
idempotent, retry-safe, tenant-aware, auditable, and able to retain a failure
state. A failed external provider must not roll back or corrupt a saved
Opportunity.

## Approved end-to-end workflow

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

## Ingestion

1. Receive an authorized public form, office share, official webhook, or file.
2. Validate source identity, office routing, type, size, and abuse controls.
3. Store raw source metadata and large media separately.
4. Deduplicate by provider event ID, normalized URL, checksum, or
   office/content fingerprint.
5. Request analysis without exposing logs to the broker.

Current Meta processing and public intake are existing implementations. Their
current records predate the complete unified Opportunity model and will be
adapted only in Phase 2.

## Analysis and normalization

The analysis boundary retains raw, extracted, normalized, and broker-confirmed
values separately. Confirmed values win. Missing providers use deterministic
fixtures in tests and are described as adapter-ready, never production
connected.

## Matching and operations

Matching is requested automatically after minimum data exists or relevant data
changes. Match identity uses canonical pair, rule version, and relevant data
version. A valid actionable match creates exactly one open operation and an
appropriate notification. A no-match result stores the opportunity only.

## Notifications

Notification creation:

1. Resolve the source operation and target `officeId`/broker.
2. Map event type to a notification preference category.
3. Skip push when that category is disabled.
4. Deduplicate by operation and event.
5. Store an auditable notification record.
6. Send only to active devices for the same office/broker.
7. Retain in-app operation visibility when push permission is unavailable.

Phase 1 introduces preference storage and category gating while preserving the
existing FCM transport.

## Cooperation

Future cooperation flow:

```text
COOPERATION_REQUESTED
-> OWNER_PERMISSION_CHECKED
-> COOPERATION_ACCEPTED | COOPERATION_REJECTED
-> SCOPED_ACCESS_GRANTED
-> COOPERATION_REVOKED | COOPERATION_ENDED
-> SCOPED_ACCESS_REMOVED
```

The office setting only selects `DISABLED`, `APPROVAL_REQUIRED`, or
`SMART_AUTOMATIC`. It does not itself grant another office access. Automatic
mode never exposes private contact details automatically.

## Phase 1 profile transaction

Office profile changes use this synchronous atomic flow:

```text
PROFILE_SAVE_REQUESTED
-> INPUT_VALIDATED
-> NEW_NAME_CLAIM_READ
-> OLD_NAME_CLAIM_READ
-> NAME_CLAIM_RESERVED
-> OFFICE_PROFILE_UPDATED
-> PUBLIC_PROJECTION_UPDATED
-> OLD_CLAIM_RELEASED
-> PROFILE_SAVE_CONFIRMED
```

Any name conflict aborts the transaction. Media is uploaded before the profile
transaction; a failed upload leaves the existing saved profile unchanged.
Removing media deletes the R2 object only through an authenticated,
office-scoped Worker route.
