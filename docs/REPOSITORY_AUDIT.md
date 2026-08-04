# IAQAR.AI Repository Audit

Audit date: 2026-08-04  
Scope: Phase 0 factual baseline before Phase 1 changes  
Classification: `REAL AND CONNECTED`, `PARTIAL`, `DEMO OR MOCK`, `MISSING`, `BROKEN`, `UNKNOWN`

## Architecture baseline

- Static Firebase-hosted PWA: `public/index.html`, `public/manifest.webmanifest`, `public/firebase-messaging-sw.js`.
- Firebase Authentication/access: `public/js/access-gate.js`.
- Firestore office context: `public/js/firebase-office.js`.
- Office settings: `public/js/office-settings.js`.
- Live workflow and FCM: `public/js/workflow-office.js`.
- Official Meta UI: `public/js/whatsapp-office.js`.
- Cloudflare Worker backend: `worker/src/index.js`.
- R2 binding: `worker/wrangler.toml` (`IAQAR_MEDIA`, bucket `iaqar-media`).
- Tenant rules/indexes: `firestore.rules`, `firestore.indexes.json`.
- Automated baseline: `worker/test/worker.test.mjs`, run through `worker/package.json` `npm test`.
- No frontend test runner, Firestore Rules tests, CI workflow, lint config, or TypeScript config existed.

## Phase 0/1 feature baseline

| Feature | Baseline classification | Exact evidence |
|---|---|---|
| Arabic RTL/mobile shell | REAL AND CONNECTED | `public/index.html` `<html lang="ar" dir="rtl">`; `.app` max width; mobile media rules |
| PWA manifest/service worker | PARTIAL | `public/manifest.webmanifest`, `public/firebase-messaging-sw.js`; referenced icon files were absent |
| Firebase office context | REAL AND CONNECTED | `firebase-office.js` `resolveOfficeId`, `createOfficePaths`, `runtime.refs` |
| Authenticated office gate | REAL AND CONNECTED | `access-gate.js` `verifyAccess`; Firestore `isOfficeMember` |
| Public office link | REAL AND CONNECTED | `office-settings.js` `officeLink`/`buildPublicSlug`; `/o/**` rewrite; `access-gate.js` slug query |
| Logo click opens settings | REAL AND CONNECTED | `#officeSettingsBtn`; `whatsapp-office.js` `openSettings` |
| Cover click opens settings | MISSING | Cover existed only as a settings file preview; no home cover target |
| Separate visible settings label | BROKEN against constitution | Office-logo button visibly said `إعدادات المكتب` |
| Per-office logo upload | MISSING | Office card used the embedded platform logo |
| Display image upload | REAL AND CONNECTED | `office-settings.js` POST `/media/office-cover`; Worker `uploadOfficeCover`; R2 |
| Crop/replace/remove workflow | PARTIAL | Browser preview and canvas center-crop existed; no editable crop or remove |
| Approved office data fields | PARTIAL | Name, broker, phone, license, city existed; extra visible WhatsApp and specialty fields existed |
| No visible email in settings | REAL | Settings modal had no email field; broker registration had email outside settings |
| Name minimum validation | REAL AND CONNECTED | Browser `validateOfficeName`; Firestore `validOfficeProfile` |
| Name normalization/claim | PARTIAL | Client `normalizeOfficeNameKey` + transaction existed; Worker broker approval used incompatible `normalizeOfficeId` |
| Race duplicate prevention | PARTIAL | Client transaction used `officeNameClaims`; backend approval did not atomically create the same normalized claim |
| Link copy | REAL | `office-settings.js` `copyLink` |
| Link native share | PARTIAL | Office-card share existed; no simple link-share control |
| QR | PARTIAL | QR was drawn only into generated office-card PNG |
| Public preview control | MISSING | No settings action opened the public URL |
| Notification device registration | REAL AND CONNECTED | `workflow-office.js` register/unregister; Worker `registerFcmDevice`; rules deny direct device access |
| Notification categories/preferences | MISSING/PARTIAL | Only per-device localStorage enabled state existed; no persisted category settings |
| Opportunity Bank entry | MISSING | No `بنك الفرص` route, component, or settings entry |
| Cooperation mode | MISSING | No cooperation settings or persistence |
| Office tenant isolation | REAL AND CONNECTED with risks | Rules path scoping and Worker `authorizeOfficeRequest`; broad member write wildcard remained |
| Settings audit logging | MISSING | Match/deal timeline existed; no append-only office-settings audit |
| Home bottom navigation | REAL (absent as required) | No fixed bottom navigation |
| Deals page/control | BROKEN against constitution | Home had visible `data-main="deals"` card and PWA Deals shortcut |
| Production workspace data | DEMO OR MOCK then connected | Six static cards in `index.html`; later replaced by `iaqar:operations-data` |
| Operations live listener | REAL AND CONNECTED | `workflow-office.js` `startLiveData`/`emitOperations` |
| Empty Operations state | PARTIAL | `.empty` style existed but static demo prevented an honest initial empty state |
| Official WhatsApp inbound | REAL AND CONNECTED in code; live state UNKNOWN | Worker webhook signature/token validation and mapping; credentials/deployed webhook not verified |
| WhatsApp outbound | REAL AND CONNECTED as disabled | Worker paths containing send/messages return `outbound_disabled` |
| Public intake | REAL AND CONNECTED | `access-gate.js` `intakeForm`, Firestore `publicIntake`, Worker media/matching |
| Legacy `public-intake.js` | BROKEN/dead | File existed but was not loaded |
| Matching/workflow previews | REAL in deterministic tests | Worker preview endpoints and unit tests |
| Live matching idempotency acceptance | UNKNOWN | No baseline duplicate-match test despite validation text claims |
| Firestore Rules tests | MISSING | No emulator test suite |
| Browser/E2E tests | MISSING | No DOM or browser automation suite |

## Backend and security baseline

### Connected controls

- `firestore.rules` required office membership for private office paths.
- Worker `authorizeOfficeRequest` verified Firebase ID token, office owner/member state, and manager/integration permission.
- `devices`, `whatsapp_accounts`, and `_system` were denied to clients.
- Webhook HMAC/token validation existed.
- Media types and sizes were allowlisted for existing public intake/office cover.
- R2 public office cover paths were constrained by regex.

### Risks found

1. Unauthenticated public intake and media endpoints had no visible rate-limiting mechanism.
2. The catch-all Firestore rule let any office member write most subcollections, including sensitive integration/settings-like data if named under the wildcard.
3. Optional Worker `ALLOW_TRIAL_NO_AUTH` can bypass office auth for a configured trial office.
4. CORS was `*`.
5. Browser and Worker office-name normalization differed.
6. `officeNameClaims` allowed authenticated list reads.
7. Demo Operations were present in production HTML before authoritative data arrived.
8. PWA icons referenced by manifest, notifications, and cache were absent.
9. Existing validation text files contained stale test counts and claims not represented in current tests.

Phase 1 addresses the name-normalization/claim path, settings authorization, claims listing, office identity authorization, settings audit, notification preferences, and mock/Deals UI defects. Abuse protection for public intake, global CORS policy, trial bypass removal, and missing PWA brand assets remain documented work; they are not silently changed outside the approved phase.

## Existing test/build baseline

- `cd worker && npm test`: 40 tests in `worker/test/worker.test.mjs` at audit time.
- No root build existed.
- Deployment scripts used `node --check`, Worker tests, Wrangler deployment, and Firebase deployment, but were Windows PowerShell/cmd only.
- No configured lint or type check.
- No PR template or CI configuration.

## Existing documentation

Seven Arabic `.txt` documents existed under `docs/`, plus numerous root changelog/validation text files. They are retained. The mandatory Markdown governance set and Cursor project rule were missing at baseline.
