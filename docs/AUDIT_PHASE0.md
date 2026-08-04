# IAQAR.AI — Phase 0 Repository Audit

Audit date: 2026-08-04
Audited commit: `ea66a81` (branch `main`, working tree clean at audit start)
Auditor scope: every tracked file in the repository was read or grepped. No inference
without a file/line citation.

This document is a factual record of what the repository contained **before** Phase 1
work began. It is intentionally blunt: several features that appear finished in the
Arabic changelog files are not connected end to end.

---

## 1. Repository shape

| Area | Location | Notes |
| --- | --- | --- |
| Web app (PWA) | `public/index.html` (1600 lines, 379 KB) | Single-file shell: inline CSS, inline SVG sprite, two inline base64 PNG logos (lines 1060 and 1085, ~166 KB each), inline operations-list script. |
| Front-end modules | `public/js/*.js` | Classic IIFE scripts, one ES module (`fcm-fid.js`). No bundler, no framework, no build step. |
| Backend | `worker/src/index.js` (2604 lines) | Single Cloudflare Worker, ES module export, talks to Firestore/FCM over the REST API with a service-account JWT. |
| Backend tests | `worker/test/worker.test.mjs` (510 lines) | `node:test`, no dependencies. 40 tests, all passing at audit time. |
| Security rules | `firestore.rules` (128 lines) | Firestore rules v2. |
| Indexes | `firestore.indexes.json` | 6 composite indexes (matches, deals, alerts). |
| Admin scripts | `admin/*.mjs` | Node scripts using `firebase-admin`, run manually by the operator. |
| Hosting | `firebase.json` | Firebase Hosting from `public/`, rewrite `/o/**` → `/index.html`. Project `aqar-b5d76`. |
| Docs | `docs/*.txt`, 24 × `CHANGELOG-*.txt`, 13 × `VALIDATION-*.txt` | Arabic release notes. Descriptive, not verified. |

There is **no root `package.json`**, so before Phase 1 there was no way to run any test
or check from the repository root; only `worker/` had a test script.

## 2. Technology stack (preserved, per directive Section 1.3)

Firebase Authentication (compat SDK 12.16.0), Firestore (compat SDK), Firebase Cloud
Messaging + `public/firebase-messaging-sw.js`, Cloudflare Worker + R2 bucket
`iaqar-media` for media, PWA manifest + share target, vanilla JS with no framework.

## 3. Feature-by-feature classification

Legend: **REAL AND CONNECTED** / **PARTIAL** / **DEMO OR MOCK** / **MISSING** /
**BROKEN** / **UNKNOWN**.

### 3.1 Home page and navigation

| Requirement (directive) | Status | Evidence |
| --- | --- | --- |
| Home page contains only Office Card, Add Opportunity, Operations Center (§5) | **PARTIAL** | `public/index.html`: header, `section.card.license` (Office Card), `section.main-sections` (two tab cards), `section.card.workspace` (Operations Center). No Add Opportunity card anywhere. |
| No bottom navigation bar (§5, Test 2) | **REAL AND CONNECTED** (already compliant) | No `nav`, no fixed-bottom element in `public/index.html`. |
| No deals page (§21, Test 14) | **BROKEN / non-compliant** | `public/index.html` line 1115: `<button class="main-card" data-main="deals">` with label `الصفقات`. The inline script (line 1363) filters the operations list by `item.main === state.main`, so this button is a second page in practice. |
| No separate Settings button (§6, Test 1) | **BROKEN / non-compliant** | `public/index.html` line 1084–1087: the office logo button `#officeSettingsBtn` contains a visible `<span>إعدادات المكتب</span>` label. |
| Clicking office logo opens Office Settings (Test 1) | **REAL AND CONNECTED** | `public/js/whatsapp-office.js` line 237: `elements.openBtn.addEventListener("click", openSettings)` where `openBtn = #officeSettingsBtn`. |
| Clicking office cover opens Office Settings (Test 1) | **MISSING** | The Office Card renders no cover/display image at all; `coverUrl` is only shown inside the settings form preview (`#officeCoverPreview`) and on the public office page (`access-gate.js` line 153). |

### 3.2 Operations Center

| Requirement | Status | Evidence |
| --- | --- | --- |
| Operations Center shows real actionable items | **PARTIAL** | `public/js/workflow-office.js` builds items from live Firestore snapshots of `matches`, `deals`, `publicIntake` (lines 547–563) and dispatches `iaqar:operations-data` with `authoritative: true`. That path is real. |
| No fake demo cards in production (§16) | **DEMO OR MOCK** | `public/index.html` lines 1287–1354 hard-code six operations (`A1`, `M1`, `F1`, `M2`, `D1`, `D2`) and `render()` runs at line 1596 before any Firestore data arrives. `#total` is hard-coded to `6` at line 1135. A signed-out or offline user sees six fabricated operations. |
| Approved empty state (§16) | **MISSING** | `render()` writes `operationList.innerHTML = items.map(...).join("")`; an empty array produces a blank area with no message. |
| Real `Operation` entity with the §16 field set (`type`, `priority`, `deduplicationKey`, `status`, …) | **MISSING** | There is no `operations` collection. Operations are derived on the client from `matches`/`deals`/`publicIntake`; nothing is persisted, so there is no dedup key and no operation status. |

### 3.3 Office Card and Office Settings

| Requirement | Status | Evidence |
| --- | --- | --- |
| Office name / broker name / license / city displayed on card | **REAL AND CONNECTED** | `#officeDisplayName`, `#officeDisplayBroker`, `#officeDisplayLicense`, `#officeDisplayCity` populated by `public/js/office-settings.js` `apply()` (lines 180–190). |
| Approved services summary on card | **REAL AND CONNECTED** | `#officeDisplaySpecialties` + `.specialty-status-row`, from `specialties` (`office-settings.js` lines 148–150, 191–192). |
| Office logo upload | **MISSING** | The card logo is a base64 PNG hard-coded in `public/index.html` line 1085. No upload path, no per-office logo field. |
| Office display image upload | **MISSING** | Only one image exists (`coverUrl`). |
| Wide WhatsApp-compatible cover + crop | **PARTIAL** | Upload works (`office-settings.js` lines 310–337 → worker `POST /media/office-cover` → R2 key `office-covers/{officeId}/cover`, `worker/src/index.js` lines 382–399). There is **no crop**, no ratio preset, no remove, and no configurable ratio setting. |
| Image validation (type/size) | **REAL AND CONNECTED** | Client: `office-settings.js` line 312 (jpeg/png/webp, ≤10 MB). Server: `worker/src/index.js` lines 389–390 (same limits, enforced independently). |
| Loading / error states for images | **PARTIAL** | The save button shows `جارٍ الحفظ...` (line 357) and errors surface through `toast()`, but there is no per-image progress or error region. |
| Visible fields = name, broker, license, city, mobile only (§7.2) | **PARTIAL** | `public/index.html` lines 1158–1206 also expose a second phone input (`#officeWhatsappInput`, `رقم واتساب`) and the specialties fieldset. |
| No email field in settings (§7.2) | **REAL AND CONNECTED** (already compliant) | No email input exists in `#officeProfileForm`. (Email is only collected in the separate broker-application form, `access-gate.js` line 283, which is outside Office Settings.) |
| Office name ≥ 4 visible characters | **REAL AND CONNECTED** | `office-settings.js` `significantCharacterCount()` + `validateOfficeName()` (lines 96–123); rules mirror it via `officeNameKey.size() >= 4` (`firestore.rules` line 28). |
| System-wide normalized name uniqueness | **PARTIAL / weak** | A claim registry exists (`officeNameClaims/{nameKey}`) and `reserveOfficeName()` uses a Firestore transaction (`office-settings.js` lines 240–293), which does prevent races. **But** normalization (`normalizeOfficeNameKey`, lines 106–112) only trims, NFKC-folds, lowercases and strips separators. It does **not** fold Arabic orthographic variants, so `مكتب الأمل` and `مكتب الامل` produce different keys and both can be registered — directive §7.3 requires equivalent duplicates to be rejected. |
| Race-condition duplicate prevention at DB level | **BROKEN (security)** | `firestore.rules` lines 108–119: `allow create, update` on `officeNameClaims/{nameKey}` only checks `canManage(request.resource.data.officeId)` — the **incoming** office ID. Office B can therefore overwrite Office A's existing claim document with `officeId: "office-b"` and steal a taken name. The client transaction refuses to do this, but rules must not depend on client behaviour. |
| Office link copy | **REAL AND CONNECTED** | `#copyOfficeLinkBtn` → `copyLink()` (`office-settings.js` lines 411–420) with an `execCommand` fallback. |
| Office link share | **PARTIAL** | `shareOfficeCard()` (lines 602–651) shares a rendered PNG card via `navigator.share`, falling back to download + `wa.me`. There is no plain "share this link" action. |
| QR code | **PARTIAL** | `public/js/qrcode.js` is loaded and `drawQr()` paints a QR **into the shared card canvas** (lines 478–498, 567). No QR is ever displayed on screen. |
| Public office link preview | **PARTIAL** | The public route works (`/o/{slug}` → `access-gate.js` `publicOffice()`), but Office Settings offers no "preview" action. |
| Office handle/slug for the URL | **REAL AND CONNECTED** | `buildPublicSlug()` = `slug(name)-shortHash(officeId)` (lines 67–88), stored on `offices/{id}.publicSlug` and mirrored to `publicOffices/{id}.publicSlug`; resolved in `access-gate.js` lines 580–595. |
| Notification preferences (6 categories, §7.5) | **MISSING** | The only notification control is a single per-device FCM on/off tile (`#officeNotificationControl`, `workflow-office.js` `toggleNotifications`, lines 1317–1322) whose state lives in `localStorage` (`iaqar.fcm.enabled.{officeId}`). No category preferences, nothing persisted server-side, nothing consulted before sending. |
| Opportunity Bank entry (§7.6) | **MISSING** | No occurrence of `بنك الفرص` anywhere in the repository. |
| Smart cooperation settings (§7.7) | **MISSING** | No occurrence of any cooperation identifier anywhere in the repository. |
| Logout | **REAL AND CONNECTED** | `#officeLogoutBtn` → `firebase.auth().signOut()` (lines 397–409). |

### 3.4 Opportunity intake and analysis

| Requirement | Status | Evidence |
| --- | --- | --- |
| Unified intake field + paperclip (§8) | **MISSING** | No such control exists. Intake happens only through the public office link form (`access-gate.js` `intakeForm`) and the PWA share target. |
| Public office link intake | **REAL AND CONNECTED** | `access-gate.js` lines 205–275 writes `offices/{officeId}/publicIntake/{id}` (with media uploaded to R2 first) and then calls `POST /pipeline/public-intake`. Rules validate the payload shape (`firestore.rules` lines 46–75). |
| PWA share-target intake | **REAL AND CONNECTED** | `public/share-target.html` + `workflow-office.js` `submitPendingShare()` (lines 447–484) → `POST /pipeline/intake`. |
| WhatsApp Cloud API intake | **PARTIAL / adapter ready** | Webhook, signature verification and embedded signup all exist (`worker/src/index.js` `receiveMetaWebhook` line 934, `verifyHmacSignature` line 2363, `completeEmbeddedSignup` line 1007), but `META_APP_ID` and `META_CONFIG_ID` are empty in `worker/wrangler.toml`, so `/meta/config` reports `enabled: false` and the connect button stays disabled. Outbound sending is deliberately blocked (`worker/src/index.js` line 306, returns 403 `outbound_disabled`). This is honest today. |
| Telegram intake | **MISSING** | No Telegram code of any kind. |
| Text/OCR/PDF/Excel/Word/audio extraction | **MISSING** | Only Arabic text parsing exists: `parseRealEstateMessage()` (`worker/src/index.js` line 1274) with money/area/room/phone/district extractors. No OCR, no document parsing, no transcription, no adapter boundary. |
| Unified `Opportunity` entity (§11 field set) | **PARTIAL** | `offices/{officeId}/opportunities/{opp_intake_*}` is written (`worker/src/index.js` line 795) with `officeId`, `recordType`, `city`, `district`, `propertyType`, `price*`, `area`, `rooms`, `confidence`, `completeness`, `missingFieldsJson`, `createdAt`, `updatedAt`, `sourceCollection`, `sourceRecordId`. Missing from §11: `brokerId`, `createdBy`, `opportunityKind`, `purpose`, `nearbyDistricts`, `cooperationState`, ownership metadata, `deduplicationFingerprint`, `version`, and a lifecycle status distinct from the workflow stage. Also, records are duplicated into `clients`/`owners` **and** `opportunities`, so `opportunities` is a secondary copy rather than the single unified entity. |
| Separation of raw / extracted / normalized / broker-confirmed values | **MISSING** | Extraction output is written straight onto the record; only `rawText` is preserved. Nothing marks a value as broker-confirmed. |
| Deduplication (§24) | **PARTIAL** | Intake replay is idempotent via `status === "processed"` short-circuit (`worker/src/index.js` line 766) and deterministic IDs (`own_intake_*`, `opp_intake_*`); matches use a content-hash ID `mat_{sha256(officeId|pair)}` and skip if it exists (lines 41–46 of the excerpt, `worker/src/index.js` ~1503–1509). Missing: URL normalization, file checksums, webhook event IDs, content fingerprints. |

### 3.5 Matching, notifications, messages

| Requirement | Status | Evidence |
| --- | --- | --- |
| Matching engine with score/reasons/warnings | **REAL AND CONNECTED** | `scoreMatch()` (`worker/src/index.js` line 1558) with `MATCH_THRESHOLD = 55`, reasons, warnings, rejection checks, price/area gap metrics, readiness scoring; 40 worker tests cover parts of it. |
| Automatic rematch on new counterpart | **PARTIAL** | Matching runs automatically when an intake or shared message is processed (`findAndSaveMatches` is called from both pipelines) and `workflow-office.js` `processNewPublicIntakes()` auto-triggers the worker for any `status === "new"` intake. There is **no** rematch when an existing opportunity is edited or completed, and no event/outbox mechanism. |
| Idempotent matching (Test 8) | **PARTIAL** | The pair hash prevents duplicates for the same pair, but the ID does not include a matching-rule version or a data version, so §15's recommended identity is not met. |
| Duplicate client-side matcher | **DEMO OR MOCK risk** | `workflow-office.js` lines 329–366 contain a second, simpler scorer (`localMatchScore`, `readinessFromLocalScore`) that is **not called anywhere**. Dead code that could drift from the authoritative worker engine. |
| Notification on actionable match | **REAL AND CONNECTED** | `sendOfficeMatchNotifications()` writes `offices/{id}/alerts/alt_{matchId}` then `sendOfficePush()` → FCM HTTP v1 with a deep link (`worker/src/index.js` lines 1671–1790). Stale tokens are disabled automatically. |
| Notifications respect preferences | **MISSING** | `sendOfficePush()` reads only `offices/{id}/devices`; no preference document is consulted. |
| In-app fallback when push unavailable | **REAL AND CONNECTED** | `notify()` toast plus `showLocalMatchNotification()` (`workflow-office.js` lines 372–390). |
| Arabic message drafts | **PARTIAL** | `whatsappMessage()` (lines 683–718) builds per-stage Arabic text and opens `wa.me`. Drafts are **not persisted**, there is no `messages` collection, no channel/recipient/send-state record, and no Telegram path. Because sending happens in `wa.me`, delivery state is unknown — the code correctly never claims delivery. |
| Broker reviews before sending | **REAL AND CONNECTED** | Every path opens `wa.me` with prefilled text; the broker presses send in WhatsApp. No automatic outbound exists (worker blocks it at line 306). |

### 3.6 Cooperation, ownership, audit

| Requirement | Status | Evidence |
| --- | --- | --- |
| Broker-to-broker cooperation (§19) | **MISSING** | Nothing in the repository. |
| Ownership metadata preserved (§20) | **PARTIAL** | `offices/{officeId}/…` path plus a duplicated `officeId` field give tenant ownership, and `ownerUid` is pinned on office creation (`office-settings.js` lines 274–276). No `originatingOfficeId` / `originatingBrokerId` / `currentOwningOfficeId` fields, because cooperation does not exist. |
| Audit logging (§26) | **PARTIAL** | Per-record `timeline` subcollections exist for matches and deals (`addWorkflowTimeline`, `worker/src/index.js` line 1852) and are readable/creatable by office members (`firestore.rules` lines 90–93). There is no `auditLogs` collection, and no audit entry for sharing, permission changes, or deletions. |

### 3.7 Multi-tenant isolation and security

| Requirement | Status | Evidence |
| --- | --- | --- |
| `officeId` on every office-scoped document | **REAL AND CONNECTED** | Enforced by rules for writes: `request.resource.data.officeId == officeId` (`firestore.rules` line 87). |
| Cross-office reads blocked (Test 4) | **REAL AND CONNECTED** | `isOfficeMember(officeId)` gates all reads under `/offices/{officeId}` (line 84); membership requires `ownerUid` match or an active `members/{uid}` doc. Backend mirrors this in `authorizeOfficeRequest()` (`worker/src/index.js` line 2220). |
| FCM tokens not client-readable | **REAL AND CONNECTED** | `match /devices/{deviceId} { allow read, write: if false; }` (lines 79–81); the generic subcollection rule excludes `devices`. Managed only by the worker's service account. |
| No secrets in the repository | **REAL AND CONNECTED** | `worker/wrangler.toml` `[vars]` holds only non-secret IDs, all empty; secrets come from Wrangler secrets (`assertFirebaseSecrets`, line 2390). `.firebaserc` and the Firebase web config are public by design. |
| Least privilege inside an office | **PARTIAL / weak** | The catch-all `match /{collectionName}/{docId}` (line 83) lets **any** active office member read, create and update **any** document in **any** subcollection (except `devices`). A junior member can rewrite match scores, ownership fields, or another member's settings. §25 ("prevent mass assignment of protected fields", "prevent a broker from changing ownership fields directly") is not satisfied. |
| Office-name claim integrity | **BROKEN (security)** | See §3.3 above — name takeover is possible through rules alone. |
| Public intake abuse protection | **PARTIAL** | Rules constrain payload shape and size tightly (lines 46–75) and the honeypot field exists in the unused `public-intake.js`, but there is no rate limiting and `POST /pipeline/public-intake` and `POST /media/public-intake` are unauthenticated by design. |
| Webhook authenticity | **REAL AND CONNECTED** | `verifyWebhook()` (verify-token) and `verifyHmacSignature()` (`X-Hub-Signature-256`) — `worker/src/index.js` lines 919 and 2363. |
| Expiring secure links for external completion | **MISSING** | No such links exist. |

### 3.8 Event-driven architecture (§22)

**MISSING.** Work is done synchronously inside request handlers. There is no
`eventOutbox`/`backgroundJobs` collection, no event names, no retry state and no
idempotency keys per handler. The only scheduled work is an hourly cron
(`worker/wrangler.toml` `crons = ["0 * * * *"]` → `processOverdueFollowups`,
`worker/src/index.js` line 2156), which pushes overdue follow-up reminders.

### 3.9 Tests

| Item | Status | Evidence |
| --- | --- | --- |
| Backend unit tests | **REAL AND CONNECTED** | `worker/test/worker.test.mjs`, 40 tests, `node --test`-style via `node:test`. Verified passing: `cd worker && npm test` → `# pass 40 # fail 0`. |
| Front-end tests | **MISSING** | None. |
| Firestore rules tests | **MISSING** | No emulator config, no rules test suite. |
| End-to-end / acceptance tests | **MISSING** | The `VALIDATION-*.txt` files are hand-written checklists, not executable tests. |
| Root test entry point | **MISSING** | No root `package.json`. |

## 4. Dead or duplicated code found

1. `public/js/public-intake.js` (127 lines) is **never loaded**. `public/index.html`
   does not reference it; the public form is rendered by `access-gate.js` instead.
2. `public/js/workflow-office.js` lines 318–366 (`normalizeArabic`, `localMatchScore`,
   `readinessFromLocalScore`, `safeRecordId`) are unreferenced.
3. Two ~166 KB base64 PNGs are duplicated inside `public/index.html` (lines 1060 and
   1085), which is why the shell is 379 KB.
4. Match/deal/readiness label tables are defined **twice** — once in
   `worker/src/index.js` (lines 16–40) and once in `public/js/workflow-office.js`
   (lines 9–40) — with no shared source.

## 5. Security risks ranked

| # | Risk | Severity | Location |
| --- | --- | --- | --- |
| 1 | Office-name claim takeover: rules allow overwriting another office's `officeNameClaims/{nameKey}` document. | High | `firestore.rules` 108–119 |
| 2 | Intra-office privilege flattening: any active member can write any document in any office subcollection, including protected/ownership fields. | High | `firestore.rules` 83–88 |
| 3 | Arabic name normalization too weak, so "unique" office names are not actually unique to a reader. | Medium | `public/js/office-settings.js` 106–112 |
| 4 | Unauthenticated public pipeline endpoints without rate limiting. | Medium | `worker/src/index.js` 219, 235 |
| 5 | Fabricated demo operations render in the production shell before/without auth. | Medium (trust) | `public/index.html` 1287–1354 |
| 6 | `publicOffices/{officeId}` is world-readable and contains `phone` and `whatsapp`. Intentional for the public office page, but it does publish contact numbers. | Low / accepted | `firestore.rules` 97–100 |

## 6. What Phase 1 changes (summary; details in `IMPLEMENTATION_PLAN.md`)

Phase 1 addresses, from this audit: 3.1 (all rows), 3.3 (visual identity, field set,
normalization, link/QR/share/preview, notification preferences, bank entry, cooperation
setting), 3.2 (demo data + empty state), 3.7 risks 1–3, and 3.9 (root test harness plus
front-end and rules-logic tests).

Phase 1 explicitly does **not** address: unified intake (§8), analysis adapters (§12),
the full Opportunity Bank (§13), the matching-engine rewrite (§15), persisted
`operations` records (§16), cooperation records (§19), persisted message drafts (§18),
or the event outbox (§22). Those remain as classified above until their own phases.
