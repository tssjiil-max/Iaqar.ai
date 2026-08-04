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

Every handler must be idempotent, retry-safe, tenant-aware, auditable, and able to retain a failure state. An external adapter failure must not corrupt the Opportunity.

## Current implemented workflow

### Ingestion

- Official Meta webhook: `POST /meta/webhook` validates the webhook signature/token path and feeds `processInboundMessage`.
- Authenticated PWA share target: `POST /pipeline/intake` calls `handleSharedIntake`.
- Public office intake: public form writes `offices/{officeId}/publicIntake/{id}`; `POST /pipeline/public-intake` validates the stored tenant record before processing.
- Legacy `/ingest` returns HTTP 410. Outbound routes containing `messages` or `send` return HTTP 403.

Current parser/matcher behavior is synchronous inside the Worker. A durable event outbox is approved for a later phase but is not yet implemented.

### Phase 1 office settings

```text
OFFICE_SETTINGS_SUBMITTED
-> AUTHORIZATION_CHECKED
-> OFFICE_NAME_NORMALIZED
-> NAME_AND_HANDLE_CLAIMS_READ_IN_TRANSACTION
-> PRIVATE_OFFICE_PROFILE_UPDATED
-> PUBLIC_OFFICE_PROJECTION_UPDATED
-> CLAIMS_COMMITTED
-> SETTINGS_CONFIRMED
```

The Firestore transaction identity is the normalized office name plus stable public handle. A competing claim causes a conflict and no settings transaction is committed.

Visual identity events:

```text
IMAGE_SELECTED
-> TYPE_AND_SIZE_VALIDATED
-> CROP_PREVIEWED
-> IMAGE_CROPPED
-> MANAGER_AUTHORIZED
-> R2_OBJECT_WRITTEN
-> OFFICE_PROFILE_URL_UPDATED
```

Removal clears the profile URL first, then removes the authorized office-scoped R2 object. A cleanup failure is reported honestly and can be retried.

### Notifications

```text
ACTIONABLE_EVENT
-> OFFICE_NOTIFICATION_PREFERENCE_CHECKED
-> ACTIVE_OFFICE_DEVICES_SELECTED
-> FCM_ATTEMPTED
-> SEND_RESULT_RECORDED
```

Notification tests bypass category preferences because they verify a user-requested device registration. Category-disabled events do not send push. The Operations Center remains the in-app fallback.

## Future matching workflow

On a new or materially changed Opportunity:

1. Normalize matching fields.
2. Select eligible OFFER/REQUEST counterparts within the tenant or approved cooperation scope.
3. Compute configurable score, reasons, compatible fields, mismatches, confidence, routing, and recommended action.
4. Upsert one Match by canonical pair, matching-rule version, and relevant data version.
5. Create one deduplicated Operation only if the result is actionable.
6. Create one auditable, preference-aware notification linked to that Operation.
7. Keep no-match Opportunities in the private bank for future automatic reprocessing.

## Cooperation workflow (Phase 6)

```text
COOPERATION_REQUESTED
-> OWNERSHIP_RECORDED
-> APPROVAL_REQUIRED_OR_RULES_EVALUATED
-> MINIMUM_DATA_PROJECTION_GRANTED
-> COOPERATION_ACTIVE
-> PERMISSION_REVOKED_OR_ENDED
-> FUTURE_ACCESS_DENIED
```

Contact details remain hidden unless an explicit permission allows them. Revocation affects future access while preserving required audit history.

## Deduplication identities

- source: provider message/event ID, normalized URL, file checksum, or office/content fingerprint
- Opportunity: source identity plus office
- Match: canonical Opportunity pair + rule version + relevant data version
- Operation: action type + source entity/event
- notification: Operation/event + recipient
- cooperation: originating/cooperating offices + approved scope + active state

Ambiguous duplicates are linked for review; confirmed broker data is not silently merged.
