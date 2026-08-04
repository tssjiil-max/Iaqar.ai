# IAQAR.AI — System Architecture

## Current stack (preserve)

| Layer | Technology | Location |
|---|---|---|
| Client UI | Static Arabic RTL PWA (HTML/CSS/vanilla JS) | `public/` |
| Auth | Firebase Authentication (phone login + claims) | `public/js/access-gate.js`, Worker auth routes |
| Database | Cloud Firestore | `firestore.rules`, `firestore.indexes.json` |
| Push | Firebase Cloud Messaging + service worker | `public/js/workflow-office.js`, `public/firebase-messaging-sw.js`, Worker `/fcm/*` |
| Media | Cloudflare R2 via Worker | `worker/src/index.js` `/media/*` |
| Backend | Cloudflare Worker | `worker/src/index.js` |
| Hosting | Firebase Hosting | `firebase.json` (`/o/**` → `index.html`) |
| Admin scripts | Node admin utilities | `admin/` |

## Runtime topology

```text
Broker browser (PWA)
  ├─ Firebase Auth / Firestore (tenant-scoped paths)
  ├─ FCM registration → Worker → offices/{officeId}/devices
  └─ Media upload → Worker → R2 (office covers/logos, intake media)

Public visitor
  └─ /o/{slug} → publicOffices + publicIntake (create-only intake)

Cloudflare Worker
  ├─ Meta WhatsApp webhook (inbound-only when configured)
  ├─ Intake / matching / workflow previews and actions
  ├─ Broker application approval
  └─ FCM send (service account)
```

## Tenant model

- Primary path: `offices/{officeId}/...`
- Public projection: `publicOffices/{officeId}`
- Global unique names: `officeNameClaims/{officeNameKey}`
- Login directory: `loginDirectory/{phoneHash}` (Worker-managed)

Every office-scoped document must include `officeId` even when the path already contains it.

## Approved target architecture (incremental)

Event-driven workflow without a new external message broker:

`SOURCE_RECEIVED → SOURCE_STORED → ANALYSIS_REQUESTED → DATA_EXTRACTED → OPPORTUNITY_CREATED_OR_UPDATED → DATA_COMPLETENESS_EVALUATED → MATCHING_REQUESTED → MATCH_CREATED → OPERATION_CREATED → NOTIFICATION_CREATED → BROKER_ACTION → MESSAGE_DRAFT_CREATED → …`

A Firestore-backed job/outbox pattern is acceptable. Handlers must be idempotent, retry-safe, tenant-aware, and auditable.

## UI surfaces

| Surface | Role |
|---|---|
| Home — Office Card | Identity + entry to settings via logo/cover |
| Home — Add Opportunity | Unified intake (Phase 2) |
| Home — Operations Center | Actionable items only (Phase 5 hardening) |
| Office Settings overlay | Identity, data, link, notifications, bank entry, cooperation |
| Opportunity Bank | Private office bank opened from settings (Phase 3) |
| Public office link | External owner/customer intake only |

## Integration honesty

| Integration | Current state |
|---|---|
| WhatsApp Business API | Adapter/UI present; production requires Meta credentials. Inbound-only; auto-send disabled. |
| Telegram | Not implemented as production adapter. |
| OCR/AI extraction | Local rule parsers in Worker; no paid AI dependency in V1 docs. |
| FCM | Connected path exists when VAPID + service account configured. |

## Non-goals / forbidden migrations

Do not migrate away from Firebase/Firestore/Worker/PWA without explicit owner approval. Do not introduce a large new message-broker dependency without approval.
