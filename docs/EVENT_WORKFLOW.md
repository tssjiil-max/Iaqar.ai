# IAQAR.AI Event Workflow

## Approved workflow

The platform must be event-driven and idempotent:

`SOURCE_RECEIVED -> SOURCE_STORED -> ANALYSIS_REQUESTED -> DATA_EXTRACTED -> OPPORTUNITY_CREATED_OR_UPDATED -> DATA_COMPLETENESS_EVALUATED -> MATCHING_REQUESTED -> MATCH_CREATED -> OPERATION_CREATED -> NOTIFICATION_CREATED -> BROKER_ACTION -> MESSAGE_DRAFT_CREATED -> EXTERNAL_RESPONSE_RECEIVED -> NEXT_OPERATION_CREATED -> COMPLETED`

## Observed current workflows

### Office settings

1. Broker opens Office Settings from the office logo or cover image.
2. Frontend validates office name and image files.
3. Images are cropped client-side and uploaded through the worker media endpoint.
4. Frontend runs a Firestore transaction:
   - Reads `offices/{officeId}`.
   - Reads `officeNameClaims/{officeNameKey}`.
   - Rejects a claim owned by another office.
   - Writes the current claim.
   - Writes `offices/{officeId}`.
   - Mirrors public-safe fields to `publicOffices/{officeId}`.

### Public intake

Observed in `public/js/public-intake.js` and `worker/src/index.js`:

1. External participant submits a public intake form.
2. Form writes to `offices/{officeId}/publicIntake`.
3. Worker endpoint `/pipeline/public-intake` can process the submitted intake.
4. Worker can create/update opportunity and match records according to existing implementation.

### Shared/PWA intake

Observed in `public/js/workflow-office.js`:

1. Shared text is stored locally as `iaqar.pendingSharedMessage`.
2. On authenticated app open, frontend calls `/pipeline/intake`.
3. Worker requires an authenticated office member.

### FCM

Observed in worker tests and code:

1. FCM targets prefer Firebase Installation ID with legacy token fallback.
2. Push payloads include an HTTPS deep link to the related office/match.
3. Outbound WhatsApp sending remains disabled by default.

## Phase 1 event limitations

- No Phase 2 unified opportunity intake was added.
- No new background matching workflow was introduced.
- Opportunity Bank entry is read-only and does not add management events until Phase 3.
- Cooperation mode is stored but cooperation request workflows remain Phase 6.
