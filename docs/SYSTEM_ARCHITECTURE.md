# IAQAR.AI System Architecture

## Current architecture

IAQAR.AI is a static Arabic RTL PWA hosted by Firebase Hosting, backed by Firebase Authentication and Firestore, with a Cloudflare Worker for privileged API behavior and Cloudflare R2 for media.

| Layer | Current implementation | Responsibility |
|---|---|---|
| Browser/PWA | `public/index.html`, `public/js/*.js` | Access gate, office workspace, settings, public intake, workflow UI, FCM registration |
| Authentication | Firebase Authentication | Broker identity and ID tokens |
| Database | Firestore | Offices, members, intake, opportunities, matches, workflow records, settings |
| Authorization | `firestore.rules`, Worker `authorizeOfficeRequest` | Tenant membership, manager actions, public/privileged boundaries |
| Backend | `worker/src/index.js` | Official WhatsApp webhook, parsing/matching, workflow, FCM, media, admin actions |
| Media | Cloudflare R2 binding `IAQAR_MEDIA` | Public-intake media and public office identity assets |
| Push | Firebase Cloud Messaging + service worker | Per-office registered devices and deep links |
| Hosting | `firebase.json` | Static app and `/o/**` public-office rewrite |

The frontend is intentionally framework-free. `public/index.html` owns the approved visual shell. Browser modules are IIFEs except the FCM module. The Worker is one ES module and uses Firebase REST APIs with service-account credentials supplied as runtime secrets.

## Identity and request boundaries

1. `access-gate.js` resolves platform, authenticated-office, and public-office modes.
2. `firebase-office.js` creates the office-scoped Firestore runtime from the URL/authenticated context.
3. Firestore Rules permit office reads only to active members/owners/platform administrators.
4. Privileged Worker routes verify Firebase ID tokens and office membership/roles.
5. Public office profiles are read from `publicOffices`; internal office documents are never used for anonymous rendering.
6. Office identity media is publicly readable by URL because it is intentionally public branding, but upload/removal requires an authorized office manager and uses tenant-scoped R2 keys.

## Phase 1 connected flow

```text
logo or display image click
  -> Office Settings dialog
  -> load offices/{officeId}
  -> load officeSettings/notifications and officeSettings/cooperation
  -> validate/crop selected images in browser
  -> authorized Worker upload to R2
  -> Firestore transaction:
       normalized name claim
       private office profile
       public office profile
       notification preferences
       cooperation preference
       audit record
  -> update Office Card and local cache
```

Name uniqueness uses a deterministic normalized claim ID in `officeNameClaims`. The settings transaction reads the claim and writes the claim/profile atomically. Concurrent clients claiming the same normalized key cannot both commit. Broker approval uses the same normalization and create-if-absent backend claim.

Notification categories are stored per office. Worker match and follow-up notifications read these preferences before creating an alert or push. FCM device enablement remains per browser/device and is preserved.

## Approved target architecture

Later phases extend the existing architecture rather than replacing it:

- Unified `opportunities` records linked to immutable sources/attachments.
- Database-backed, auditable event/outbox records for retry-safe background work where needed.
- Idempotent matching keyed by canonical pair, matching-rule version, and relevant data versions.
- Actionable `operations` records as the only main broker work surface.
- Scoped, revocable cooperation records that preserve origin ownership and hide contacts by default.
- Message drafts and adapter contracts separated from real delivery state.

No new message broker or major framework is approved. A Firestore-backed job/outbox is acceptable when the current Worker/event model needs durable retries.

## Known architectural limitations after Phase 1

- The Worker remains a large single module; no refactor was required for Phase 1.
- Opportunity Bank record listing/management is Phase 3. Phase 1 provides only its private settings entry and an honest boundary screen.
- The approved unified Add Opportunity home gateway is Phase 2 and is not implemented in this phase.
- Existing live matching/workflow code predates the new phased plan; it remains in place but is not evidence that later-phase acceptance tests pass.
- FCM and Meta production connectivity require deployed secrets and live integration tests; repository tests verify contracts only.
- Existing PWA icon paths reference assets not present in the repository. This is retained as a documented hardening limitation rather than fabricating brand assets.
