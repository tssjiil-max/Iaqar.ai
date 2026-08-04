# IAQAR.AI System Architecture

## Current observed architecture

- Static Arabic RTL frontend in `public/index.html` and `public/js/*.js`, hosted by Firebase Hosting (`firebase.json`).
- Firebase client SDK initialized through `/__/firebase/init.js`.
- Firestore used as the primary database.
- Firestore security rules in `firestore.rules`.
- PWA assets in `public/manifest.webmanifest`, `public/firebase-messaging-sw.js`, and FCM helpers in `public/js/fcm-fid.js`.
- Cloudflare Worker backend in `worker/src/index.js`.
- Worker tests in `worker/test/worker.test.mjs`.
- Existing R2/media-style worker endpoints for public intake media and office cover media.

## Current connected surfaces

- Office runtime resolution: `public/js/firebase-office.js`.
- Office settings profile save/name claim transaction: `public/js/office-settings.js`.
- Office Settings modal opening and WhatsApp Business status: `public/js/whatsapp-office.js`.
- Public intake form: `public/js/public-intake.js` and `public/js/access-gate.js`.
- Matching/parser previews and server-side intake processing: `worker/src/index.js`.
- FCM delivery helpers and tests: `worker/src/index.js`, `worker/test/worker.test.mjs`.

## Approved target architecture

The approved target remains the current stack:

- Firebase Auth for authenticated offices/brokers.
- Firestore for tenant-scoped records.
- Existing backend worker for privileged processing, webhook contracts, media upload, notifications, and background workflows.
- Firebase Cloud Messaging and in-app fallback for notifications.
- Database-backed idempotent records/jobs/outbox where background workflow state is needed.

## Phase 1 architecture decisions

- Office visual identity is stored on the office document and public-safe fields are mirrored to `publicOffices/{officeId}`.
- Uploaded office images continue through the existing worker media endpoint. The endpoint now accepts a constrained media kind: `logo`, `cover`, or `whatsapp-cover`.
- Office name uniqueness continues through `officeNameClaims/{normalizedName}` with a Firestore transaction and stricter rules preventing claim transfer across offices.
- Notification preferences and cooperation mode are stored on the private `offices/{officeId}` document.
- The Opportunity Bank Phase 1 entry is a private read-only entry point; full Opportunity Bank management remains Phase 3.

## Known architecture risks

- Several existing worker/frontend paths still use `deals` as an internal collection/state. The constitution forbids a separate broker-facing deals page. This run removed the visible home-page deals section but did not migrate existing internal collection names.
- The worker includes extensive matching/workflow logic. Acceptance for those later phases remains unverified in this run.
- Firestore rules are present, but emulator-based security tests are not configured in this repository.
