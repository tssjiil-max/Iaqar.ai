# IAQAR.AI — System Architecture

This document describes (A) the architecture that exists today and (B) the approved target
architecture. It is factual: everything in part A is backed by the audit in
`docs/REPOSITORY_AUDIT.md`.

---

## A. Current architecture (as of Phase 1)

```
                       ┌──────────────────────────────────────────┐
   Broker (PWA) ──────▶│ Firebase Hosting  (public/)              │
                       │  index.html + vanilla JS modules         │
                       └───────┬───────────────────────┬──────────┘
                               │ Firebase compat SDK    │ fetch (CORS)
                               ▼                        ▼
                 ┌───────────────────────┐   ┌────────────────────────────┐
                 │ Firebase Auth         │   │ Cloudflare Worker          │
                 │ Firestore             │◀──│ iaqar-macrodroid-intake    │
                 │ Firebase Cloud Msg.   │   │  + R2 bucket IAQAR_MEDIA   │
                 └───────────────────────┘   └────────────┬───────────────┘
                                                          │ Graph API (inbound only)
                                                          ▼
                                                    Meta WhatsApp Cloud API
```

### Frontend modules (`public/js`, load order fixed in `index.html`)

| Module | Responsibility |
| --- | --- |
| `fcm-fid.js` | ES-module bridge that returns a Firebase installation id for FCM v1 |
| `access-gate.js` | Locks the app for unauthenticated visitors; renders the public office page, customer/owner intake, broker application, office login, platform-admin console |
| `firebase-office.js` | Resolves `officeId` (URL → localStorage → `platform`), creates Firestore handles, publishes `window.IAQAR.office` and `iaqar:firebase-*` events |
| `qrcode.js` | Vendored QR generator |
| `office-identity.js` | **(Phase 1)** Pure, dependency-free office rules: name validation/normalization, slug, phone, image presets, crop maths, notification preference and cooperation-mode models. Shared by the browser and the Node test suite |
| `office-settings.js` | Office Settings sheet: profile form, unique-name transaction, visual identity uploads, link/QR/share, notification preferences, cooperation mode, Opportunity Bank entry |
| `whatsapp-office.js` | Settings sheet open/close wiring and Meta embedded signup |
| `workflow-office.js` | Live Firestore subscriptions → workspace items, workflow actions, FCM device registration, foreground push |

### Backend (`worker/src/index.js`, one Worker, no framework)

Route groups: health/config, Meta webhook + embedded signup, pipeline previews, public and shared
intake, broker applications, phone login and password recovery, media upload/serve (R2), FCM
config/register/unregister/test, workflow actions and timeline, office analytics. A `scheduled`
handler processes overdue follow-ups.

Authorization: `authorizeOfficeRequest()` verifies the Firebase ID token against the project JWKS,
then checks office membership and permission before any office-scoped action.

### Data (Firestore)

`offices/{officeId}` and its subcollections (`members`, `clients`, `owners`, `opportunities`,
`matches`, `deals`, `alerts`, `devices`, `inbox`, `publicIntake`, `officeSettings` **(Phase 1)**),
plus root collections `publicOffices`, `officeNameClaims`, `brokerApplications`,
`whatsapp_accounts`, `_system`. See `docs/DATA_MODEL.md`.

### Object storage

Cloudflare R2 (`IAQAR_MEDIA`), not Firebase Storage. Keys:
`public-intake/{officeId}/{intakeId}/…`, `office-logos/{officeId}/logo`,
`office-covers/{officeId}/cover`, `office-share-covers/{officeId}/cover`. Public reads go through
`GET /media/public/…` with a strict key allow-list.

### Known architectural gaps

No event outbox, no Operation entity, no unified Opportunity schema, no cooperation domain, no
audit-log domain, no rules test harness. These are the subject of Phases 2–8.

---

## B. Approved target architecture

The target keeps the stack. Nothing is migrated to another framework, database or host.

### Layering

```
 Intake adapters ─▶ Source store ─▶ Analysis adapters ─▶ Opportunity store
        │                                                     │
        └──────────────── event outbox (Firestore) ───────────┤
                                                              ▼
                                       Matching engine ─▶ Match store
                                                              │
                                                              ▼
                                   Operation factory ─▶ Operations Center
                                                              │
                                          Notification router ┤
                                          Message drafter ────┘
```

* **Adapters at every boundary.** WhatsApp, Telegram, OCR, document parsing and transcription are
  behind interfaces with deterministic local fixtures, so a missing credential degrades one
  adapter instead of the platform.
* **Event outbox in Firestore.** `eventOutbox` documents drive `SOURCE_RECEIVED → … → COMPLETED`
  (see `docs/EVENT_WORKFLOW.md`). Handlers are idempotent, keyed by `eventId` + handler name, and
  are drained by the Worker's `scheduled` handler and by direct invocation after a write. No new
  message broker is introduced.
* **Engines are internal.** Matching and analysis never render UI. They emit Match and Operation
  records; the Operations Center is a pure reader of Operations.
* **Tenant enforcement in two places.** Firestore rules for direct client access, and
  `authorizeOfficeRequest()` for every Worker route. Cooperation grants are read from a
  `cooperations` document, never inferred from the client.
* **Shared pure logic.** Business rules that must behave identically in the browser, the Worker
  and the tests live in dependency-free modules (`public/js/office-identity.js` is the first one)
  that export to `window` and to CommonJS.

### Constraints carried forward

1. No bundler and no framework: modules stay plain scripts with an IIFE and a global namespace.
2. No new runtime dependency in `public/`; vendored files only, as with `qrcode.js`.
3. Node's built-in test runner is the test framework; `jsdom` is a dev-only dependency for DOM
   tests.
4. Arabic RTL and the approved visual language are inputs to every UI change, not an afterthought.
