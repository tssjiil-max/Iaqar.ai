# IAQAR.AI — Event Workflow

## Target pipeline

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

## Current implementation (factual)

| Stage | Status | Evidence |
|-------|--------|----------|
| Source received | PARTIAL | WhatsApp webhook paths, public intake, PWA share-target (`public/share-target.html`) |
| Source stored | PARTIAL | `inbox`, `publicIntake`, R2 media |
| Analysis | PARTIAL | Local regex/heuristics in Worker; no full OCR/audio/doc pipeline |
| Opportunity upsert | PARTIAL | Worker creates `opportunities` on some paths |
| Matching | PARTIAL | Worker matching helpers + Firestore `matches` |
| Operation creation | PARTIAL / MIXED | UI “مساحة العمل” mixes live matches/deals with local demo seed in `index.html` |
| Notifications | PARTIAL | FCM device register + match notify; granular prefs added in Phase 1 |
| Message drafts | PARTIAL | Client opens `wa.me` with prepared text; not API send |
| Cooperation events | MISSING (pre-Phase 6) | Mode preference stored in Phase 1 only |

## Handler requirements

Every handler must be: idempotent, retry-safe, tenant-aware (`officeId`), auditable, and able to record failure without corrupting the Opportunity.

## Phase 1 workflow impact

Phase 1 does not change the matching/operations pipeline. It persists office identity, media, notification preferences, cooperation mode, and exposes Opportunity Bank entry for later phases.
