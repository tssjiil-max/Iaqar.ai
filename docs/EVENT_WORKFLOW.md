# IAQAR.AI — Event Workflow

**Related legacy:** `docs/WORKFLOW-V5-AR.txt`, `docs/STEP-5-COMPLETE-CYCLE-AR.txt`

---

## Canonical pipeline

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

## Current implementation mapping

| Event | Current mechanism | Honesty |
|-------|-------------------|---------|
| SOURCE_RECEIVED | WhatsApp webhook `/meta/webhook`, public intake, share-target, (future) unified intake | PARTIAL |
| SOURCE_STORED | Firestore `inbox` / `publicIntake` + R2 media | REAL AND CONNECTED (paths vary) |
| ANALYSIS_REQUESTED / DATA_EXTRACTED | Local regex/rules parser in Worker (`processInboundMessage`) | PARTIAL — not AI; adapter boundary for future extractors |
| OPPORTUNITY_CREATED_OR_UPDATED | `offices/{officeId}/opportunities` | REAL AND CONNECTED |
| MATCHING_REQUESTED / MATCH_CREATED | `findAndSaveMatches` after intake/update | PARTIAL — automatic on intake; no general rematch API |
| OPERATION_CREATED | UI synthesizes operations from matches/deals/publicIntake; seed demo ops in HTML | PARTIAL / DEMO seed |
| NOTIFICATION_CREATED | Firestore alerts + FCM send | PARTIAL — prefs categories added in Phase 1; FCM secrets required live |
| MESSAGE_DRAFT_CREATED | Manual `wa.me` / share card | PARTIAL — drafts/share; auto-send disabled |
| COOPERATION_* | Not implemented | MISSING |

## Handler requirements

Every handler must be:

1. Idempotent
2. Retry-safe
3. Tenant-aware (`officeId`)
4. Auditable
5. Able to record failure without corrupting the Opportunity

## Rematch triggers (approved)

New offer/request, owner/customer submission, data completion, relevant opportunity update, external-source opportunity, cooperation scope update when applicable.

Normal broker workflow must not require a “rematch” button.

## Operations creation rule

Create an Operation only for actionable broker work.  
Saving an unmatched Opportunity to the bank must **not** create an Operations item by itself.

## Deduplication signals

Same source message ID, normalized URL, file checksum, webhook event ID, office+content fingerprint, opportunity pair + matching version.
