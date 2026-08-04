# Repository Audit — Phase 0

Audit date: 2026-08-04  
Baseline: `main` at `ea66a81`  
Initial worktree: clean

Classifications are based on repository evidence. Code presence alone is not
treated as proof of deployed provider connectivity.

## Architecture and infrastructure

| Area | Classification | Evidence |
| --- | --- | --- |
| Firebase Hosting/PWA | REAL AND CONNECTED | `firebase.json`, `public/manifest.webmanifest`, `public/firebase-messaging-sw.js`, `public/share-target.html` |
| Firebase Auth/Firestore client | REAL AND CONNECTED | SDK bootstrap in `public/index.html`; runtime/refs in `public/js/firebase-office.js` |
| Tenant rules | PARTIAL | membership helpers and office paths in `firestore.rules`; broad child catch-all and mutable protected fields require hardening |
| Cloudflare Worker | REAL AND CONNECTED | router and scheduled handler in `worker/src/index.js`; Wrangler config in `worker/wrangler.toml` |
| R2 media | REAL AND CONNECTED | `IAQAR_MEDIA` binding; `uploadPublicIntakeMedia` and `uploadOfficeCover` |
| FCM | PARTIAL | registration/send/service-worker paths and unit tests exist; production VAPID/service secrets are intentionally absent |
| Official Meta inbound | PARTIAL | webhook verification/signup/processing paths exist; committed config has no credentials, so production connection is UNKNOWN |
| Automated tests | REAL AND CONNECTED | Node tests in `worker/test/worker.test.mjs`; no browser E2E or Firestore emulator rules suite |

## Home and Office Settings

| Requirement | Classification | Exact evidence |
| --- | --- | --- |
| Logo opens settings | REAL AND CONNECTED | `#officeSettingsBtn` in `public/index.html`; `openSettings` binding in `public/js/whatsapp-office.js` |
| Cover opens settings | MISSING | no home cover control or bound `coverUrl` |
| No standalone settings button | PARTIAL | logo button is labeled visibly “إعدادات المكتب”; no separate gear button |
| No bottom navigation | REAL AND CONNECTED | no bottom-nav element; current top cards are not bottom navigation |
| No Deals page/item | BROKEN | `[data-main="deals"]` in `public/index.html`; deal listener and operation mapper in `public/js/workflow-office.js`; Deals PWA shortcut |
| No fake production operations | BROKEN | hardcoded A1–D2 operation array in inline script in `public/index.html` |
| Approved empty Operations state | PARTIAL | `.empty` style exists, but renderer writes an empty string |
| Arabic RTL/mobile layout | REAL AND CONNECTED | `<html lang="ar" dir="rtl">`; 432px mobile app and responsive CSS in `public/index.html` |
| Modal accessibility | PARTIAL | dialog role, labels, buttons, Escape exist; focus restoration/trap absent |

## Office profile

| Requirement | Classification | Exact evidence |
| --- | --- | --- |
| Office/broker/license/city/mobile | REAL AND CONNECTED | form IDs and `onSave`/`reserveOfficeName` in `public/js/office-settings.js` |
| No email field | REAL AND CONNECTED | no email input in office profile form |
| Logo upload | MISSING | only embedded platform logo; no `logoUrl` |
| Display image upload | MISSING | one legacy `coverUrl` input only |
| Wide cover configurable crop | MISSING | canvas share uses fixed center crop; no setting or crop workflow |
| Upload/preview/replace | REAL AND CONNECTED | `/media/office-cover`, object URL preview, profile transaction |
| Remove identity image | MISSING | no delete route or control |
| Loading/success/error states | PARTIAL | save/share loading and toast exist; media-specific and empty states incomplete |

## Unique name and public link

| Requirement | Classification | Exact evidence |
| --- | --- | --- |
| Four visible characters | REAL AND CONNECTED | `validateOfficeName` and HTML `minlength` |
| Arabic/Latin normalization | PARTIAL | `normalizeOfficeNameKey` supports both but does not remove Arabic marks/tatweel |
| Atomic claim transaction | PARTIAL | client `reserveOfficeName` uses a transaction |
| Backend/rules race enforcement | BROKEN | `officeNameClaims` update rules permit a different office to overwrite an existing claim |
| Admin approval claim | BROKEN | `decideBrokerApplication` uses ASCII office-ID normalization and does not create `officeNameClaims` |
| Copy public link | REAL AND CONNECTED | `officeLink`/`copyLink` |
| Share and QR | REAL AND CONNECTED | `shareOfficeCard`, `drawQr`, `public/js/qrcode.js` |
| Public preview | PARTIAL | generated link works through access gate, but settings has no explicit preview action |
| Stable slug | PARTIAL | generated office-ID hash and preservation exist; no independent slug claim |

## Preferences, bank, and cooperation

| Requirement | Classification | Exact evidence |
| --- | --- | --- |
| FCM device enable/disable | REAL AND CONNECTED | controls in `public/index.html`; functions in `public/js/workflow-office.js`; Worker `/fcm/*` |
| Six notification categories | MISSING | only one device-level enabled boolean |
| Correct office push routing | REAL AND CONNECTED | `sendOfficePush` reads only `offices/{officeId}/devices` |
| Opportunity Bank entry | MISSING | no “بنك الفرص” settings card |
| Smart cooperation mode | MISSING | no mode field, UI, rules, or backend authorization |

## Security findings

1. HIGH: `officeNameClaims` can be reassigned by another authorized office
   manager because rules do not bind updates to `resource.data.officeId`.
2. HIGH: `publicOffices` allows anonymous collection reads of phone and license
   projections. Existing slug lookup depends on queries, so this needs a
   server-lookup migration rather than an unsafe rules-only change.
3. HIGH: public intake media upload is unauthenticated and has no repository
   rate limiter, creating an R2 abuse/cost risk.
4. MEDIUM: office `ownerUid` and `officeId` are not immutable on manager update.
5. MEDIUM: approved Arabic office names do not receive a correct global claim.
6. MEDIUM: generic child rules allow every active member to write many
   collections when `officeId` matches, regardless of role-specific intent.
7. LOW/operational: `ALLOW_TRIAL_NO_AUTH` can bypass Worker auth when explicitly
   enabled for the configured trial office.

## Test inventory

- `worker/test/worker.test.mjs`: Worker routes, parser, matching, workflow, FCM,
  auth helpers, public intake media.
- Deployment scripts: `node --check` over selected JS, Worker tests, Worker and
  Firebase deployment.
- Validation/changelog text files: historical manual claims only; not
  executable evidence.
- Missing at baseline: office-settings unit tests, DOM acceptance tests,
  identity-media auth tests, name-claim race tests, and Firestore rules emulator
  tests.
