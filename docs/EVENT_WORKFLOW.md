# IAQAR.AI — Event Workflow

## Approved Event Flow (Section 22)

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

---

## Current Implementation (Phase 0 Audit)

### Flow 1: Public Intake (Owner/Client Form)
```
1. User submits public intake form → Firestore publicIntake doc created (status: "new")
2. Firestore onSnapshot listener in workflow-office.js detects new doc
3. workflow-office.js → POST /pipeline/public-intake → Worker
4. Worker: parses intake, runs local matching, creates match records
5. Worker: returns match results to client
6. Client: shows local notification if matches found
7. Firestore matches listener updates Operations Center live
```
**Status:** PARTIAL — matching is client-triggered, not fully server-side event-driven.

### Flow 2: Shared Text (PWA Share Target)
```
1. User shares WhatsApp message to IAQAR PWA
2. share-target.html captures text → localStorage
3. workflow-office.js: submitPendingShare() → POST /pipeline/intake → Worker
4. Worker: parseRealEstateMessage() → creates intake record → runs matching
5. Match results returned to client
```
**Status:** PARTIAL — text parsing done; structured Opportunity records not yet formalized.

### Flow 3: Worker Scheduled (cron hourly)
```
1. Cloudflare cron trigger (0 * * * *)
2. Worker processes any pending analytical tasks
```
**Status:** Cron configured but specific handlers TBD.

---

## Phase 1 Events (New)
No new event flows in Phase 1. Phase 1 is about Office Setup.

Office settings save:
```
1. Broker updates settings form
2. officeNameClaims transaction checks uniqueness
3. offices/{officeId} updated via transaction
4. publicOffices/{officeId} updated in same transaction
5. Toast notification shown to broker
```

Logo/Cover upload:
```
1. Broker selects file
2. JWT obtained from Firebase Auth
3. POST /media/office-logo (or /media/office-cover) → Worker
4. Worker validates JWT + officeId + file type + size
5. File stored in R2 at logos/{officeId}/logo (or covers/{officeId}/cover)
6. Worker returns URL
7. URL saved to offices document
```

---

## Phase 2 Events (Planned)
```
UNIFIED_INPUT_SUBMITTED (URL / text / file)
→ Source persisted (opportunitySources or raw attachment)
→ Worker analysis: text extraction / OCR / document parse
→ OPPORTUNITY_CREATED (status: INGESTED)
→ Missing-field detection
→ If data sufficient: MATCHING_REQUESTED
→ Otherwise: NEEDS_DATA_OPERATION_CREATED
```

---

## Phase 4 Events (Planned)
```
OPPORTUNITY_UPDATED (broker fills missing data)
→ DATA_COMPLETENESS_EVALUATED
→ If eligible: MATCHING_REQUESTED
→ Engine: normalize + score + deduplicate
→ MATCH_CREATED (if score ≥ threshold, not duplicate)
→ OPERATION_CREATED (officeId, assignedBrokerId, type: NEW_MATCH)
→ NOTIFICATION_SENT (respecting notificationPrefs)
```

---

## Event Handler Requirements
Every event handler must be:
- **Idempotent** — same input, same result
- **Retry-safe** — deduplication keys prevent duplicates
- **Tenant-aware** — officeId verified at every step
- **Auditable** — failures recorded, not silently swallowed
- **Failure-isolated** — one failed external call doesn't corrupt the Opportunity

---

## Deduplication Keys
| Entity | Key Composition |
|--------|----------------|
| Match | officeId + clientRequestId + ownerOfferId + matchingVersion |
| Operation | officeId + sourceEntityType + sourceEntityId + type |
| Notification | officeId + operationId + deviceId |
| Name Claim | normalizedOfficeName (document ID) |
| Intake | officeId + submittedAt + normalized fingerprint (server-side) |
