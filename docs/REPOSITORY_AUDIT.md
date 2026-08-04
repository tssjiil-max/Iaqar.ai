# IAQAR.AI — Phase 0 Repository Audit

Audit date: 2026-08-04
Audited commit: `ea66a81` (branch `main`, working tree clean at audit start)
Auditor: implementation engineer, executing the Master Engineering Directive v1.0

Every statement below is backed by a file and line reference in this repository.
Nothing is marked as working unless the code path is connected end to end.

---

## 1. Actual technology stack

| Layer | Technology | Evidence |
| --- | --- | --- |
| Frontend | Static, framework-free HTML/CSS/vanilla JS, Arabic RTL, mobile-first | `public/index.html:2`, `public/index.html:55` |
| Firebase SDK | compat SDK 12.16.0 loaded from CDN + hosted `init.js` | `public/index.html:1266-1270` |
| Auth | Firebase Authentication (email/password, custom token for phone login) | `public/js/access-gate.js:344-363`, `worker/src/index.js:598` |
| Database | Cloud Firestore (`aqar-b5d76`) | `public/js/firebase-office.js:4`, `public/js/firebase-office.js:107` |
| Push | Firebase Cloud Messaging (HTTP v1, FID-first with token fallback) | `worker/src/index.js:1751-1790`, `public/js/fcm-fid.js` |
| PWA | manifest + FCM service worker + Android share target | `public/manifest.webmanifest`, `public/firebase-messaging-sw.js`, `public/share-target.html` |
| Backend | Single Cloudflare Worker (`iaqar-macrodroid-intake`) | `worker/src/index.js:120-330`, `worker/wrangler.toml` |
| Object storage | Cloudflare R2 binding `IAQAR_MEDIA` (not Firebase Storage) | `worker/src/index.js:342-345`, `README-AR.txt:4-5` |
| Hosting | Firebase Hosting, `public/` with `/o/**` rewrite | `firebase.json:1-17` |
| Tests | `node:test` suite for the Worker only, 40 tests | `worker/test/worker.test.mjs`, `worker/package.json:7` |
| "Build" | `node --check` syntax pass over listed JS files, then deploy | `deploy-all.ps1:24-37` |
| Lint / types | None configured | no ESLint/TS config anywhere in the repository |

There is **no bundler, no framework, no state-management library and no TypeScript**. The
directive's instruction to preserve the stack therefore means: keep plain ES2020 browser
scripts, keep the compat Firebase SDK, keep the single Cloudflare Worker.

## 2. Repository layout

```
public/                Firebase Hosting root (the whole frontend)
  index.html           Home page, all CSS, the settings sheet markup, demo operations array
  js/access-gate.js    Public gate: intake forms, broker signup, login, platform admin
  js/firebase-office.js officeId resolution + Firestore handles (window.IAQAR.office)
  js/office-settings.js Office profile form, name uniqueness, cover upload, share card
  js/whatsapp-office.js Settings sheet open/close + Meta embedded signup
  js/workflow-office.js Live matches/deals/intake -> workspace items, FCM registration
  js/public-intake.js   Share-target handoff
  js/qrcode.js          Vendored QR generator (qrcode-generator)
  js/fcm-fid.js         Modular FCM installation-id bridge
worker/src/index.js    All backend routes (media, auth, meta webhook, matching, FCM, workflow)
admin/                 One-off Node scripts run with a service account
firestore.rules        Tenant isolation rules
firestore.indexes.json Composite indexes for matches/deals/alerts
docs/, *-AR.txt        Arabic changelogs and validation notes (historical, kept)
```

## 3. Feature-by-feature classification

Legend: **REAL AND CONNECTED** / **PARTIAL** / **DEMO OR MOCK** / **MISSING** / **BROKEN** / **UNKNOWN**.

### 3.1 Home page and navigation (directive §5)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Arabic RTL, mobile-first, white/green design | REAL AND CONNECTED | `public/index.html:2`, `:16-36`, `:55-59` |
| No bottom navigation bar | REAL AND CONNECTED | no fixed nav element exists; the only section switcher is a static 2-card grid `public/index.html:1106-1122` |
| Office Card present | PARTIAL | `public/index.html:1073-1104` — shows logo, name, broker, license, city, services summary, but **no office cover/display image** |
| "Add Opportunity" card present | MISSING | no intake card on the home page; intake exists only on the public gate (`public/js/access-gate.js:160`) and via share target |
| Operations Center present | PARTIAL | "مساحة العمل" `public/index.html:1124-1139` renders real records via `public/js/workflow-office.js:432-436`, but also renders a hard-coded demo list before/without live data |
| No deals page | **VIOLATION (existing)** | `public/index.html:1115-1121` renders a "الصفقات" main card; `public/js/workflow-office.js` and `worker/src/index.js:1863-1950` implement a full deal module |
| Home page contains only the 3 approved sections | PARTIAL | there is an extra header band, a license banner, and the الفرص/الصفقات switcher |

### 3.2 Office Card and Office Settings (directive §6, §7)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Logo click opens Office Settings | REAL AND CONNECTED | button `#officeSettingsBtn` `public/index.html:1084`, handler `public/js/whatsapp-office.js:237` |
| Cover click opens Office Settings | MISSING | the office card has no cover element at all |
| No visible standalone Settings button | PARTIAL / VIOLATION | the logo button contains the visible caption `<span>إعدادات المكتب</span>` `public/index.html:1086` |
| Logo upload / replace | MISSING | the office logo is a hard-coded base64 `<img>` `public/index.html:1085`; no upload path, no `logoUrl` field |
| Display-image upload | PARTIAL | file input `public/index.html:1185`, upload `public/js/office-settings.js:309-337`, endpoint `worker/src/index.js:382-399`. No crop, no remove, no explicit loading/error state (failures only produce a toast) |
| Wide WhatsApp-compatible cover | MISSING | only a 1080×1350 share card canvas exists `public/js/office-settings.js:500-582` |
| Office data fields (name, broker, license, city, mobile) | REAL AND CONNECTED | `public/index.html:1158-1182`, persisted `public/js/office-settings.js:240-293` |
| No email field in office settings | REAL AND CONNECTED | no email input inside the settings sheet; email inputs exist only in the public access gate `public/js/access-gate.js:283`, `:390` |
| Office name ≥ 4 characters | REAL AND CONNECTED | client `public/js/office-settings.js:96-123`, rules `firestore.rules:28`, `firestore.rules:114` |
| System-wide normalized uniqueness | PARTIAL | normalization `public/js/office-settings.js:106-112`, transactional claim `public/js/office-settings.js:240-293`, rules `firestore.rules:108-119`. **Security gap: see §4.1** |
| Office link copy | REAL AND CONNECTED | `public/js/office-settings.js:411-420`, link build `:140-146`, slug `:584-600`, hosting rewrite `firebase.json:11-16`, resolution `public/js/access-gate.js:580-596` |
| Office link share | PARTIAL | only "share the generated PNG office card" exists `public/index.html:1212`, `public/js/office-settings.js:602-651`; there is no plain link share |
| QR code display | PARTIAL | `public/js/qrcode.js` is vendored and used only when drawing the PNG card `public/js/office-settings.js:478-498`; no QR is ever displayed in the interface |
| Public link preview | MISSING | no preview action |
| Notification preferences (6 switches) | MISSING | only a device-level enable control exists `public/index.html:1238-1241`, `public/js/workflow-office.js:1211-1260` |
| Opportunity Bank entry "بنك الفرص" | MISSING | string not present anywhere in the repository |
| Smart cooperation settings | MISSING | no cooperation code, collection, rule or string anywhere |

### 3.3 Opportunity domain (directive §8–§15)

| Requirement | Status | Evidence |
| --- | --- | --- |
| Unified intake gateway (text/link + paperclip) | MISSING | intake is per-role public forms `public/js/access-gate.js:160-276` |
| Opportunity entity | PARTIAL | the Worker writes `offices/{officeId}/opportunities/{id}` from WhatsApp and public intake `worker/src/index.js:795`, `:1233`, but the document carries only parsed real-estate fields — no `opportunityKind`, `purpose`, confidence, completeness, lifecycle status, cooperation state, dedup fingerprint or version |
| Source persistence | PARTIAL | WhatsApp inbox `worker/src/index.js:1126-1196`; public intake media in R2 `worker/src/index.js:353-380`; no unified source/attachment entity |
| Analysis engine | PARTIAL | deterministic Arabic text parser only `worker/src/index.js:1274-1462`. No OCR, PDF, Excel, Word or audio parsing; no confidence separation between extracted / normalized / broker-confirmed values |
| Matching engine | REAL AND CONNECTED (V1 rules) | `worker/src/index.js:1485-1663`, top-3 candidates, reasons and warnings, tested `worker/test/worker.test.mjs:456` |
| Automatic rematching on new data | PARTIAL | runs on WhatsApp inbound `worker/src/index.js:1197-1273` and on public intake when the client calls `/pipeline/public-intake` `public/js/access-gate.js:102-111`. No event-outbox, no rematch when an opportunity is later completed |
| Match idempotency | PARTIAL | match ids are derived per source record; there is no canonical pair + rule-version identity |
| Opportunity Bank | MISSING | no collection, no UI |
| Operations Center records | MISSING as an entity | workspace items are derived on the client from matches/deals/intake `public/js/workflow-office.js:154-430`; there is no `operations` collection with `deduplicationKey`, `priority`, `status` |
| Deduplication | PARTIAL | WhatsApp message id and intake id guards `worker/src/index.js:744-834`; no URL/checksum/content fingerprint |

### 3.4 Notifications, messages, cooperation (directive §17–§20)

| Requirement | Status | Evidence |
| --- | --- | --- |
| FCM push to the correct office | REAL AND CONNECTED | `worker/src/index.js:1671-1790`, device tokens locked to the Worker `firestore.rules:79-81` |
| In-app fallback | REAL AND CONNECTED | foreground handler + toast `public/js/workflow-office.js:1134-1178` |
| Notification preference routing | MISSING | no preference model exists to respect |
| WhatsApp inbound (official Cloud API) | PARTIAL, credentials-gated | webhook verify + signature check `worker/src/index.js:919-1006`; embedded signup `:1007-1125`. Honest status is surfaced in the UI (`يحتاج إعداد Meta`) `public/js/whatsapp-office.js:84-89` |
| WhatsApp outbound | INTENTIONALLY BLOCKED | `worker/src/index.js:306` rejects send paths; the client only opens `wa.me` links |
| Telegram | MISSING | no code |
| Message drafts stored as entities | MISSING | drafts are built ad hoc as `wa.me` URLs |
| Broker-to-broker cooperation | MISSING | no code |
| Ownership metadata on records | PARTIAL | `officeId` + `ownerUid` exist `public/js/office-settings.js:271-278`; no originating/cooperating office split |

### 3.5 Security and tenancy (directive §4, §25, §26)

| Requirement | Status | Evidence |
| --- | --- | --- |
| `officeId` on office-scoped writes | REAL AND CONNECTED | enforced in rules `firestore.rules:85-87` |
| Membership-based reads | REAL AND CONNECTED | `firestore.rules:14-22`, `:36`, `:84` |
| Backend authorization on sensitive routes | REAL AND CONNECTED | `worker/src/index.js:2220-2272` verifies the Firebase ID token, membership and permission |
| FCM device documents unreadable by clients | REAL AND CONNECTED | `firestore.rules:79-81` |
| No secrets in the repository | REAL AND CONNECTED | Worker secrets are Cloudflare secrets `worker/README-AR.txt`; the public Firebase web config is served by Firebase Hosting `public/index.html:1270` |
| File type/size validation | REAL AND CONNECTED | `worker/src/index.js:353-399` |
| Audit logging | PARTIAL | workflow timeline events only `worker/src/index.js:1852-1862`; no `auditLogs` domain |
| Rate limiting on public intake | MISSING | `/pipeline/public-intake` and the `publicIntake` create rule are open to anonymous callers `worker/src/index.js:219`, `firestore.rules:46-74` |
| Automated rules tests | MISSING | no emulator suite |

### 3.6 Tests that exist today

`worker/test/worker.test.mjs` — 40 `node:test` cases, all passing at audit time
(`cd worker && npm test`). Coverage: FCM target/payload building, service-account JWT,
phone-login normalization and legacy directory migration, Meta webhook parsing, the Arabic
message parser, the matching scorer, deal stage transitions and analytics.

There are **zero frontend tests** and **zero Firestore rules tests** in the repository.

## 4. Security risks found (ranked)

### 4.1 Office name claim can be hijacked by another office — HIGH
`firestore.rules:110-116` authorizes `create, update` on `officeNameClaims/{nameKey}` when the
caller can manage **the office named in the incoming payload**. It never checks the office that
currently owns the document. A manager of office B can therefore overwrite the claim document of
office A's name and take that name. The client-side transaction
(`public/js/office-settings.js:251-253`) refuses to do this, but rules must not depend on the
client. There is also no rule binding `nameKey` to the office's stored `officeNameKey`.
**Fixed in Phase 1.**

### 4.2 Anonymous public intake has no abuse protection — MEDIUM
`firestore.rules:46-74` allows unauthenticated `create` on
`offices/{officeId}/publicIntake/{docId}`, and `worker/src/index.js:219` runs the matching
pipeline for anonymous callers. Field validation exists, but nothing limits volume.
**Out of Phase 1 scope; scheduled for Phase 8 hardening.**

### 4.3 R2 media upload for public intake is unauthenticated — MEDIUM
`worker/src/index.js:353-380` accepts uploads with only header-supplied `officeId`/`intakeId`
(minimum length 8). Type and size are validated, but an attacker can write objects under any
office prefix. **Out of Phase 1 scope; Phase 8.**

### 4.4 Wildcard subcollection rule is broad — MEDIUM
`firestore.rules:83-94` lets any office member create/update documents in *any* subcollection of
their own office (except `devices`). Tenant isolation holds, but least privilege inside an office
does not. **Phase 1 narrows this for the new `officeSettings` collection only.**

### 4.5 Demo data can reach a production screen — MEDIUM (honesty risk)
`public/index.html:1287-1354` seeds the workspace with six fabricated operations that render
until `workflow-office.js` emits authoritative data. This directly conflicts with directive §16.
**Out of Phase 1 scope; Phase 5 replaces the workspace with real Operation records.**

### 4.6 Cross-origin worker base URL is hard-coded in three files — LOW
`public/js/office-settings.js:11`, `public/js/access-gate.js:19`,
`public/js/workflow-office.js:4`, `public/js/whatsapp-office.js:4`.

## 5. Constitution conflicts that already exist in the codebase

These are pre-existing and are **not** changed by Phase 1. They are recorded here so no one
claims the product is compliant.

1. A "الصفقات" (deals) surface exists on the home page and throughout the backend, which
   directive §21 forbids. Removing it deletes working, deployed functionality and is not part of
   the Phase 1 deliverable list, so it is deferred to an owner decision (see
   `docs/DECISIONS.md`, D-002).
2. The home page shows a header band and a license banner in addition to the three approved
   sections (§5).
3. The "Add Opportunity" unified gateway (§8) does not exist on the home page.
4. Demo operations are present in a production code path (§16, risk 4.5).
5. Match/deal status labels are shown to the broker (`public/js/workflow-office.js:9-40`),
   which needs review against §11's prohibition on internal status labels.

## 6. Uncommitted work at audit time

`git status` reported a clean working tree on `main` at commit `ea66a81`. No user work was at
risk and nothing was overwritten.
