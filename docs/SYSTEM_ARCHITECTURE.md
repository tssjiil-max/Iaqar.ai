# IAQAR.AI — System Architecture

This document records (A) the architecture as it exists in the repository today and
(B) the approved target architecture from the Master Engineering Directive. It merges
with — and does not replace — the earlier Arabic notes in `docs/ARCHITECTURE-V1-AR.txt`,
`docs/WORKFLOW-V5-AR.txt`, and `README-AR.txt`.

## A. Current architecture (audited)

### Components

| Component | Technology | Location |
| --- | --- | --- |
| Frontend | Static single-page app, vanilla JS, Arabic RTL, mobile-first, PWA | `public/` (Firebase Hosting, project `aqar-b5d76`) |
| Backend | One Cloudflare Worker (`iaqar-macrodroid-intake`; legacy name kept for the existing Meta webhook URL) | `worker/src/index.js` |
| Database | Firestore, accessed from the browser via the compat SDK and from the Worker via the REST API with a service-account JWT | Firebase project `aqar-b5d76` |
| Media storage | Cloudflare R2 bucket `iaqar-media` (public-intake media, office covers/logos) served through the Worker | `worker/wrangler.toml` |
| Push | FCM HTTP v1 (FID-first with legacy token fallback) + `public/firebase-messaging-sw.js` | Worker `/fcm/*` endpoints |
| Auth | Firebase Auth. Broker login = phone+password resolved via `loginDirectory` to an email account, then a custom token with `officeId` claim (`/auth/phone-login`). Platform admin = email login + `platformAdmin` custom claim | Worker + `public/js/access-gate.js` |
| Scheduler | Worker cron (`0 * * * *`) for overdue follow-up alerts | `processOverdueFollowups` |

### Frontend modules (`public/`)

- `index.html` — the whole UI: office card, main sections («الفرص» / «الصفقات» tabs),
  workspace list («مساحة العمل»), office-settings bottom sheet, inline operations
  renderer.
- `js/access-gate.js` — public/office routing, public intake forms (client/owner),
  broker registration, phone login, platform-admin approval screen.
- `js/firebase-office.js` — officeId resolution (`?officeId=` / `?office=` /
  localStorage), Firestore init, `window.IAQAR.office` runtime with per-office
  collection refs.
- `js/office-settings.js` — office profile form, name uniqueness transaction
  (`officeNameClaims`), cover upload via Worker, office-card share image, publicSlug.
- `js/whatsapp-office.js` — opens/closes the settings sheet, Meta embedded-signup flow,
  usage meter.
- `js/workflow-office.js` — live Firestore listeners (matches/deals/publicIntake),
  operations feed, workflow overlay (viewing/close/complete), WhatsApp draft links
  (`wa.me` — broker-initiated, never automatic), FCM device registration, install
  prompt.
- `js/fcm-fid.js` — modular-SDK FID bridge. `js/qrcode.js` — QR generator library.
- `js/public-intake.js` — **dead code**: an older public intake page no longer loaded
  by `index.html` (superseded by `access-gate.js`).
- `manifest.webmanifest` — PWA manifest incl. Android share target
  (`share-target.html` → `pipeline/intake`).

### Worker endpoints (`worker/src/index.js`)

- Health/config: `/health`, `/meta/config`, `/fcm/config`.
- Meta WhatsApp Cloud API (inbound only, outbound blocked programmatically):
  `/meta/webhook` (GET verify + POST with HMAC signature check), `/meta/status`,
  `/meta/signup/complete`.
- Pipeline: `/pipeline/intake` (share-target text), `/pipeline/public-intake`
  (public form → clients/owners + opportunities + matching), pure previews
  (`/pipeline/preview`, `/matching/preview`, `/workflow/preview`,
  `/workflow/readiness/preview`, `/office/analytics/preview`).
- Workflow: `/workflow/action` (match/deal state machine), `/workflow/timeline`,
  `/office/analytics`.
- Auth/admin: `/auth/phone-login` (rate-limited), `/auth/forgot-password`,
  `/broker/apply`, `/admin/broker-applications`, `/admin/broker-applications/action`.
- Media: `/media/public-intake`, `/media/office-cover`, `/media/office-logo`,
  `/media/office-cover/delete`, `/media/office-logo/delete`,
  `GET /media/public/office-covers|office-logos/...`.
- FCM: `/fcm/register`, `/fcm/unregister`, `/fcm/test`, `/fcm/status`.

Authorization: every office-scoped endpoint calls `authorizeOfficeRequest` which
verifies the Firebase ID token signature and checks office ownership/membership/role in
Firestore. Matching, parsing, scoring, and the deal state machine run inside the Worker.

### Event flow today (implemented)

```
inbound (Meta webhook | share target | public intake form)
  → stored in offices/{officeId}/inbox or publicIntake   (dedup: hashed message/event id)
  → parseRealEstateMessage (rule-based Arabic extraction)
  → offices/{officeId}/{clients|owners}/{recordId} + opportunities/{opportunityId}
  → findAndSaveMatches (deterministic pair id = hash(officeId|sorted pair) → idempotent)
  → offices/{officeId}/matches/{matchId} (+timeline)
  → offices/{officeId}/alerts/{alertId} + FCM push to office devices
  → broker workflow actions (/workflow/action) → deals (+timeline) → closed
cron (hourly) → overdue follow-ups → alerts + push
```

## B. Approved target architecture (directive)

The target keeps the exact same stack (static PWA + Cloudflare Worker + Firestore + R2 +
FCM) and evolves it phase by phase (see `docs/IMPLEMENTATION_PLAN.md`):

1. **Home page** converges to exactly three surfaces: Office Card, Add Opportunity
   (unified intake gateway), Operations Center. The current «الفرص/الصفقات» tabs and
   the deals shortcuts in the PWA manifest are replaced during the Add-Opportunity /
   Operations-Center phases. No bottom navigation, no deals page.
2. **Unified Opportunity model** (`docs/DATA_MODEL.md`): all sources normalize into one
   `Opportunity` entity with raw source separated from extracted, normalized, and
   broker-confirmed values.
3. **Event-driven workflow** (`docs/EVENT_WORKFLOW.md`): the existing synchronous
   Worker pipeline is formalized into idempotent, retry-safe, tenant-aware handlers.
   A Firestore-backed job/outbox pattern is acceptable; no new message-broker
   dependency without approval.
4. **Operations Center**: real operation records with deduplication keys and internal
   states (OPEN → … → COMPLETED); an approved empty state when nothing is actionable.
5. **Cooperation**: cooperation records with modes DISABLED / APPROVAL_REQUIRED
   (default) / SMART_AUTOMATIC, scoped sharing, revocation, ownership preservation.
6. **Smart messages**: Arabic drafts reviewed by the broker; WhatsApp/Telegram adapters
   with honest integration states (adapter-ready/simulated vs production-connected).
7. **Security**: Firestore rules + Worker checks remain the double enforcement line for
   tenant isolation; audit logging for critical actions.

## C. Constraints carried from the current system

- The Worker name (`iaqar-macrodroid-intake`) is kept because the production Meta
  webhook URL points at it; the legacy `/ingest` route stays disabled (410).
- Outbound WhatsApp messaging is blocked programmatically (routes return 403);
  broker-initiated `wa.me` drafts are the only sending path.
- `firebase-office.js` falls back to officeId `platform`; real office data access always
  requires an authenticated member (rules + Worker checks).
- `devices` and `whatsapp_accounts` are Worker-only (rules deny all client access).
