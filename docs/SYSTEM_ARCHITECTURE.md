# IAQAR.AI — System Architecture

This document describes the **current** architecture (as audited) and the
**approved target** architecture. It must be kept in sync with the code.

## 1. Current architecture (audited 2026‑08)

IAQAR.AI is a **static PWA front‑end** backed by **Firebase** and a single
**Cloudflare Worker**. There is no build step for the front‑end; files under
`public/` are served directly by Firebase Hosting.

### 1.1 Front‑end (`public/`)

- `index.html` — single‑page app. Contains the approved Arabic RTL layout:
  office header, license banner, Office Card, `main-sections` (Opportunities /
  Deals), Operations workspace, and the Office Settings overlay sheet. Inline
  CSS design tokens (white bg, light/dark green). Inline `<script>` drives the
  operations list (currently seeded with **static demo data** — see limitations).
- `js/firebase-office.js` — resolves the active `officeId` (URL `?office=` →
  localStorage → `platform` default), initializes Firestore, exposes
  `window.IAQAR.office` runtime with collection refs, dispatches
  `iaqar:firebase-ready` / `iaqar:firebase-status` events.
- `js/office-settings.js` — Office Settings form logic: load/save office profile
  to `offices/{officeId}`, office‑name validation + normalized uniqueness via a
  Firestore transaction over `officeNameClaims`, cover upload via the Worker,
  office link + QR share card (canvas), localStorage cache.
- `js/whatsapp-office.js` — owns the **open/close** of the settings overlay
  (bound to the office‑logo button) and the Meta/WhatsApp embedded‑signup UI.
- `js/workflow-office.js` — large workflow module: matches/deals listeners,
  FCM device subscription toggle ("إشعارات هذا الجهاز"), PWA install prompt,
  smart WhatsApp message drafts, deal completion flow.
- `js/public-intake.js` — public office intake form (owner/customer submissions).
- `js/access-gate.js` — platform access gate.
- `js/fcm-fid.js` — FCM installation‑id bridge (`IAQAR_FCM_READY`).
- `js/qrcode.js` — in‑browser QR generation (`window.qrcode`).
- `js/office-core.js` — **NEW (Phase 1)** pure, dependency‑free helpers shared by
  the browser and Node tests (name validation/normalization, slug, specialties,
  cover crop geometry, notification‑preference and cooperation‑mode models).
- `firebase-messaging-sw.js`, `manifest.webmanifest`, `share-target.html` — PWA
  and Web Share Target.

### 1.2 Backend (`worker/`)

- `worker/src/index.js` — Cloudflare Worker (`iaqar-macrodroid-intake`). Handles:
  public‑intake media upload, office cover (and, Phase 1, office logo) upload to
  R2 (`IAQAR_MEDIA`), serving public office media, Meta/WhatsApp config/status/
  signup, FCM config + send (Firebase HTTP v1 via service‑account JWT), office
  phone‑login directory, hourly cron. Auth via Firebase ID tokens
  (`authorizeOfficeRequest`, `requirePlatformIdentity`).
- `worker/test/worker.test.mjs` — Node `node:test` suite for exported pure
  helpers (FCM targeting, JWT, phone normalization, matching, media key
  validation).

### 1.3 Data & config

- `firestore.rules` — tenant isolation, office‑profile validation, name‑claim
  uniqueness, device secrecy, public office read.
- `firestore.indexes.json` — composite indexes for matches/deals/alerts.
- `firebase.json` — Hosting (`public/`, `/o/**` rewrite), Firestore rules/indexes.
- `admin/` — Node scripts (platform admin, phone‑login linking) using
  `firebase-admin`.

### 1.4 Stack summary

| Concern | Technology |
|---|---|
| Hosting | Firebase Hosting (static) |
| Auth | Firebase Authentication |
| Database | Cloud Firestore |
| Push | Firebase Cloud Messaging (HTTP v1 via Worker) |
| Object storage | Cloudflare R2 (`IAQAR_MEDIA`) via Worker |
| Backend/API | Cloudflare Worker |
| PWA | manifest + service worker + Web Share Target |
| Front‑end | Vanilla JS (no framework, no bundler) |
| Tests | `node:test` (worker + Phase 1 office‑core) |

## 2. Approved target architecture

The target keeps the current stack (Section 1 of the directive forbids
migrations). It layers an **event‑driven, tenant‑aware** workflow on top:

```
SOURCE_RECEIVED → SOURCE_STORED → ANALYSIS_REQUESTED → DATA_EXTRACTED
→ OPPORTUNITY_CREATED_OR_UPDATED → DATA_COMPLETENESS_EVALUATED
→ MATCHING_REQUESTED → MATCH_CREATED → OPERATION_CREATED
→ NOTIFICATION_CREATED → BROKER_ACTION → MESSAGE_DRAFT_CREATED
→ EXTERNAL_RESPONSE_RECEIVED → NEXT_OPERATION_CREATED → COMPLETED
```

Principles:

- No new heavy message‑broker dependency. A **database‑backed job/outbox**
  pattern (Firestore + Worker cron / callable handlers) is the approved event
  transport when needed.
- Every event handler is idempotent, retry‑safe, tenant‑aware, auditable, and
  records failure state. One failed external integration must not corrupt the
  Opportunity.
- External integrations (WhatsApp/Telegram) are built behind **adapter
  interfaces** with webhook contracts and local fixtures; honestly labelled
  "adapter ready" / "simulated" until real credentials + webhooks + tests exist.
- Extraction separates raw source / extracted / normalized / broker‑confirmed
  values; broker‑confirmed always wins.

## 3. Boundaries

- Front‑end never holds secrets or API keys; privileged writes (FCM tokens,
  cross‑office actions, media) go through the Worker with Firebase‑token auth.
- Firestore rules are the source of truth for tenant isolation; the front‑end
  only mirrors them for UX.
