# IAQAR.AI — System Architecture

## Current stack (preserve)

| Layer | Technology | Location |
|-------|------------|----------|
| Frontend (PWA) | Static Arabic RTL HTML/CSS/JS | `public/` |
| Auth | Firebase Authentication | `public/js/access-gate.js`, Worker login |
| Database | Cloud Firestore | `firestore.rules`, `firestore.indexes.json` |
| Backend | Cloudflare Worker | `worker/src/index.js` |
| Media | Cloudflare R2 via Worker | `/media/office-cover`, `/media/public-intake` |
| Push | FCM + service worker | `public/js/fcm-fid.js`, `public/firebase-messaging-sw.js`, Worker FCM routes |
| Hosting | Firebase Hosting | `firebase.json` (`/o/**` → `index.html`) |
| Admin tooling | Node scripts | `admin/` |

## Runtime shape

```
Browser (index.html + public/js/*)
  ├── Firebase Auth / Firestore client (tenant = officeId)
  ├── FCM registration → Worker → offices/{officeId}/devices
  └── Media upload → Worker → R2 → public media URL

Cloudflare Worker
  ├── Meta WhatsApp webhook / ingest adapters
  ├── Local text extraction + matching helpers
  ├── FCM send
  ├── Office media upload/serve
  └── Auth helpers (phone login directory, broker applications)

Firestore
  offices/{officeId}
    ├── members/{uid}
    ├── opportunities|owners|clients|matches|deals|alerts|inbox|publicIntake|devices|contacts|…
    publicOffices/{officeId}
    officeNameClaims/{officeNameKey}
    brokerApplications/{id}
    whatsapp_accounts/{phoneNumberId} (Worker-only)
```

## Approved target architecture (aligned with constitution)

Event-driven workflow without introducing a new message broker:

`SOURCE_RECEIVED → SOURCE_STORED → ANALYSIS_REQUESTED → DATA_EXTRACTED → OPPORTUNITY_CREATED_OR_UPDATED → DATA_COMPLETENESS_EVALUATED → MATCHING_REQUESTED → MATCH_CREATED → OPERATION_CREATED → NOTIFICATION_CREATED → BROKER_ACTION → MESSAGE_DRAFT_CREATED → …`

Prefer Firestore-backed jobs/outbox when needed. Handlers must be idempotent, retry-safe, tenant-aware, and auditable.

## UI surfaces (approved vs current)

| Surface | Constitution | Current repo (Phase 0 audit) |
|---------|--------------|------------------------------|
| Home | Office Card + Add Opportunity + Operations Center | Office Card + الفرص/الصفقات cards + مساحة العمل |
| Settings entry | Logo/cover click only | Logo button only (cover click missing); logo shows “إعدادات المكتب” text |
| Opportunity Bank | From settings “بنك الفرص” | Missing entry |
| Deals page | Forbidden | `data-main="deals"` present |

Home restructuring beyond Office Card/Settings is deferred pending Phase 1 approval (avoid uncontrolled redesign in Phase 1).

## Security architecture

- Tenant isolation via `officeId` membership (`firestore.rules`).
- FCM device tokens Worker-managed (`devices` deny client R/W).
- Media uploads require Bearer token + office manage permission.
- No secrets in client; Worker holds Firebase/Meta secrets via Wrangler.
- `officeNameClaims` transactionally enforces unique normalized names.

## Integration honesty

WhatsApp Business API: adapter/webhook paths exist; production completeness depends on Meta credentials and review. Default outbound behavior remains draft/manual open (`wa.me`), not automatic API send.
