# IAQAR.AI System Architecture

## Current architecture

The repository is a Firebase-hosted Arabic RTL PWA with a Cloudflare Worker backend.

| Area | Current implementation | Evidence |
| --- | --- | --- |
| Frontend shell | Static HTML/CSS/JavaScript PWA | `public/index.html`, `public/manifest.webmanifest` |
| Access/login/public intake | Firebase Auth and Firestore-gated access | `public/js/access-gate.js`, `public/js/firebase-office.js` |
| Office settings/card | Client settings module with Firestore sync and office link/card generation | `public/js/office-settings.js` |
| Operations UI | Firestore listeners for matches, deals, public intake, alerts | `public/js/workflow-office.js` |
| Backend | Cloudflare Worker HTTP routes and cron | `worker/src/index.js`, `worker/wrangler.toml` |
| Data store | Firestore | `firestore.rules`, `firestore.indexes.json` |
| Media | Cloudflare R2 binding served through worker public media route | `worker/src/index.js` |
| Push | Firebase Cloud Messaging with PWA service worker | `public/js/fcm-fid.js`, `public/firebase-messaging-sw.js` |
| Tests | Worker unit tests and Phase 1 static UI/rule test | `worker/test/worker.test.mjs`, `test/phase1-ui.test.mjs` |

## Approved target architecture

The target architecture remains the same stack:

1. Frontend: Arabic RTL mobile-first PWA.
2. Auth: Firebase Authentication.
3. Database: Firestore with tenant-aware rules.
4. Backend: existing Cloudflare Worker routes and scheduled handlers.
5. Media: existing storage path/binding, with role-based office visual identity media.
6. Notifications: preserve Firebase Cloud Messaging and provide in-app fallback when push is unavailable.
7. Workflow: event-driven ingestion -> analysis -> opportunity -> matching -> operation -> notification -> broker action.
8. External integrations: adapter boundaries for WhatsApp/Telegram; no fake production delivery states.

## Current factual audit

| Feature | Classification | Evidence |
| --- | --- | --- |
| Firebase Authentication | REAL AND CONNECTED | Firebase compat SDKs in `public/index.html`; auth flows in `access-gate.js`; worker token checks in `authorizeOfficeRequest()` |
| Firestore office isolation | PARTIAL | `firestore.rules` enforces office membership and `officeId`; unauthenticated public intake endpoints remain intentional but broad |
| FCM/PWA notifications | PARTIAL | FCM code exists in worker and PWA files; production enablement depends on secrets/VAPID |
| Office Card | REAL AND CONNECTED | `public/index.html`, `public/js/office-settings.js`; Phase 1 adds logo/cover settings triggers |
| Office Settings | PARTIAL -> Phase 1 updated | Existing settings were real but had unapproved visible settings wording and incomplete Phase 1 controls |
| Office name uniqueness | REAL AND CONNECTED | `officeNameClaims` transaction in `office-settings.js`; rules enforce claim ownership and min length |
| Add Opportunity unified broker input | MISSING | Phase 2 scope; existing public intake/share-target paths are separate |
| Opportunity Bank | PARTIAL | Phase 1 adds private office entry/read-only panel; full bank management is Phase 3 |
| Matching engine | REAL AND CONNECTED | `findAndSaveMatches()`, `scoreMatch()` in `worker/src/index.js`; worker tests cover matching preview/logic |
| Operations Center | PARTIAL | Firestore listeners render actionable records; demo operations were removed in Phase 1 |
| Deals page | BROKEN/UNAPPROVED | A visible deals tab and PWA shortcut existed; Phase 1 removes the UI route/shortcut |
| Cooperation | MISSING | No cooperation collections/routes before Phase 1; Phase 1 stores office cooperation mode only |
| WhatsApp inbound adapter | PARTIAL | Meta webhook/signup code exists; production credentials unknown |
| WhatsApp outbound API | BROKEN BY DESIGN | Worker blocks send/message routes with `outbound_disabled` |
| Telegram adapter | MISSING | No Telegram code found |

## Risks to address in later phases

- Firestore Rules need emulator tests.
- Public intake endpoints need abuse protection/rate limiting hardening.
- Intake media is stored in R2 but public-intake media serving is not implemented.
- Cooperation access and revocation are not implemented beyond Phase 1 preference storage.
- Frontend needs browser/E2E tests for real click and upload workflows.
