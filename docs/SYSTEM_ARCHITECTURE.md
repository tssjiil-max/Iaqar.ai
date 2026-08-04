# IAQAR.AI — System Architecture

**Status:** Current architecture + approved target direction  
**Preserves:** Existing Firebase + Cloudflare Worker stack  
**Related legacy docs:** `docs/ARCHITECTURE-V1-AR.txt`, `docs/WORKFLOW-V5-AR.txt`

---

## 1. Current stack (do not migrate without approval)

| Layer | Technology | Location |
|-------|------------|----------|
| Client PWA | Static HTML/CSS/JS (Arabic RTL) | `public/` |
| Auth | Firebase Authentication (email/password + phone-directory login via Worker) | `public/js/access-gate.js`, Worker `/auth/*` |
| Database | Cloud Firestore | `firestore.rules`, client SDK |
| Push | Firebase Cloud Messaging + service worker | `public/js/workflow-office.js`, `public/firebase-messaging-sw.js`, Worker `/fcm/*` |
| Media | Cloudflare R2 via Worker (not Firebase Storage) | Worker `/media/*`, binding `IAQAR_MEDIA` |
| Backend | Cloudflare Worker | `worker/src/index.js` |
| Admin gate | Platform admin UI inside access gate | `public/js/access-gate.js` |
| Hosting config | Firebase Hosting | `firebase.json` |

## 2. Runtime topology

```
Broker browser (PWA)
  ├─ Firebase Auth + Firestore listeners (office-scoped)
  ├─ Office settings / workflow UI
  └─ Worker HTTPS API (auth, intake, matching helpers, FCM, media)

Public visitor
  └─ /o/:slug or ?office=&view=public → public intake → Worker + Firestore publicIntake

External channels
  ├─ WhatsApp Cloud API webhook (inbound-only when Meta credentials configured)
  └─ Telegram: not production-connected (share claims only)
```

## 3. Tenant boundary

- Canonical scope: `offices/{officeId}/...`
- Client runtime resolves `officeId` in `public/js/firebase-office.js`
- Worker writes through `segments: ["offices", officeId, ...]` after `authorizeOfficeRequest`
- Public projection: `publicOffices/{officeId}` (limited fields)
- Unique name claims: `officeNameClaims/{officeNameKey}`

## 4. Approved target architecture (incremental)

Event-driven workflow without a new message broker:

`SOURCE_RECEIVED → SOURCE_STORED → ANALYSIS_REQUESTED → DATA_EXTRACTED → OPPORTUNITY_CREATED_OR_UPDATED → DATA_COMPLETENESS_EVALUATED → MATCHING_REQUESTED → MATCH_CREATED → OPERATION_CREATED → NOTIFICATION_CREATED → BROKER_ACTION → MESSAGE_DRAFT_CREATED → …`

Acceptable pattern: database-backed jobs/outbox consistent with Worker + Firestore.

Handlers must be idempotent, retry-safe, tenant-aware, auditable, and failure-isolating.

## 5. UI architecture (approved)

Home (internal broker):

1. Office Card → logo/cover open Office Settings
2. Add Opportunity (unified intake — Phase 2)
3. Operations Center (actionable items — Phase 5 hardening)

Office Settings is a modal/sheet (`#officeSettings`), not a separate settings route button.

## 6. Integration honesty

| Integration | Current honesty label |
|-------------|----------------------|
| WhatsApp Cloud API inbound | Adapter + webhook exist; production depends on Meta credentials/review |
| WhatsApp outbound auto-send | Disabled by design (`outbound_disabled`) |
| Telegram API | Missing / not production-connected |
| FCM | Implementation present; runtime needs VAPID + service account secrets |
| AI extraction | Not present; local regex/rules parser only |

## 7. Non-goals (unless owner approves)

- Migrating off Firebase/Worker
- Adding a separate deals module/page as broker home navigation
- Bottom navigation bar
- Scraping / unauthorized message access
- Automatic owner/customer messaging without approved send policy
