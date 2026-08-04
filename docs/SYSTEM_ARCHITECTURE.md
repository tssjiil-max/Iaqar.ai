# IAQAR.AI — System Architecture

Version 1.0 · Describes the **current** architecture (as audited) and the
**approved target** architecture. Preserve the current stack; do not migrate
without approval.

## 1. Current architecture (audited)

IAQAR.AI is a **static, buildless Progressive Web App** served by **Firebase
Hosting**, backed by **Firestore**, **Firebase Cloud Messaging**, and a
**Cloudflare Worker** that owns privileged operations and media storage
(Cloudflare **R2**).

### 1.1 Frontend (`public/`)

- No framework, no bundler, no build step. Plain HTML + CSS + vanilla JS.
- `public/index.html` — single‑page shell. Inline `<style>` holds the whole
  design system (RTL, green palette). Inline `<script>` renders the "workspace"
  operations list from an in‑memory array (seeded with **static demo data** that
  is later replaced by `iaqar:operations-data` events).
- `public/js/`:
  - `firebase-office.js` — resolves `officeId` (URL → localStorage → `platform`
    default), initialises Firebase, exposes `window.IAQAR.office` runtime + refs.
  - `office-settings.js` — Office Settings sheet: load/save office profile to
    Firestore, unique‑name reservation transaction, cover upload, share card,
    QR‑on‑canvas.
  - `whatsapp-office.js` — opens/closes the settings overlay (from the office
    logo button), WhatsApp Embedded Signup status/connect.
  - `workflow-office.js` — operations workflow overlay; emits real operations
    into the home list.
  - `access-gate.js` — platform access gate / public intake form.
  - `public-intake.js` — public office‑link intake submission.
  - `fcm-fid.js`, `firebase-messaging-sw.js` — FCM + service worker.
  - `qrcode.js` — QR generator (vendored).
- `public/manifest.webmanifest`, `public/share-target.html` — PWA + Web Share
  Target for "share to IAQAR".

### 1.2 Backend (`worker/`)

- Cloudflare Worker (`worker/src/index.js`, ESM) providing: office phone login,
  forgot‑password, media upload (public intake + office cover) to R2, public
  cover serving, broker‑application admin flow, WhatsApp (Meta) config/status/
  signup, FCM config/register/unregister/test + send, and matching/notification
  helpers. Bindings configured in `worker/wrangler.toml` (R2 bucket
  `IAQAR_MEDIA`, Firebase service‑account secrets).
- `worker/test/worker.test.mjs` — `node:test` suite (baseline: 40 tests pass).

### 1.3 Admin tooling (`admin/`)

- Node scripts using `firebase-admin` for service‑account verification, phone
  login linking, and platform‑admin setup.

### 1.4 Data & security

- Firestore data model under `offices/{officeId}/...` plus top‑level
  `publicOffices`, `officeNameClaims`, `brokerApplications`, `whatsapp_accounts`,
  `_system`, `loginDirectory`. See [`DATA_MODEL.md`](./DATA_MODEL.md).
- `firestore.rules` — tenant isolation by office membership/ownership + platform
  admin. `firestore.indexes.json` — composite indexes for matches/deals/alerts.
- `firebase.json` — hosting rewrite `/o/**` → `index.html` (office slug links).

### 1.5 Identity & tenancy

- Firebase Auth (phone/password login via Worker). `officeId` selected from the
  URL/localStorage. Office membership + `ownerUid` drive Firestore access.

## 2. Approved target architecture

The target keeps the current stack and adds an **event‑driven internal
workflow** (see [`EVENT_WORKFLOW.md`](./EVENT_WORKFLOW.md)) implemented with a
**database‑backed job/outbox pattern** — no new large message‑broker dependency
unless justified and approved.

Layers:

1. **Ingestion** — unified Add‑Opportunity intake + hidden sources (office link,
   text, image, PDF, Excel, Word, audio, WhatsApp/Telegram adapters).
2. **Analysis engine** — adapter‑bounded extraction/normalization (raw →
   extracted → normalized → broker‑confirmed), deterministic fixtures when a
   provider is unavailable.
3. **Unified Opportunity model** — one internal entity per source.
4. **Matching engine** — idempotent, configurable thresholds, produces Match
   records + recommended action + routing.
5. **Operations Center** — actionable work items only; no queue/log noise.
6. **Notifications** — FCM + in‑app fallback, preference‑aware, deduplicated.
7. **Smart messages** — Arabic drafts for WhatsApp/Telegram; broker reviews.
8. **Cooperation** — controlled broker‑to‑broker sharing with preserved
   ownership and scoped, revocable permissions.

Every event handler must be idempotent, retry‑safe, tenant‑aware, auditable, and
able to record failure state. One failed external integration must not corrupt
an Opportunity.

## 3. Constraints

- No framework/DB/hosting/state migration without approval.
- No secrets in the repo or client code.
- Preserve the approved Arabic RTL visual design.
- Firestore Rules + Worker authorization both enforce `officeId` isolation.
