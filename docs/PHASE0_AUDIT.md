# IAQAR.AI — Phase 0 Repository Audit

**Date:** 2026-08-04  
**Branch baseline:** `main` @ `ea66a81`  
**Working tree at audit start:** clean

## Stack summary

Vanilla Arabic RTL PWA (`public/index.html` + `public/js/*`), Firebase Auth/Firestore/FCM, Cloudflare Worker (`worker/src/index.js`) with R2 media, Firebase Hosting, admin Node scripts, Firestore rules/indexes.

## Feature classification (evidence-based)

| Feature | Classification | Evidence |
|---|---|---|
| Firebase Auth + office membership gate | REAL AND CONNECTED | `public/js/access-gate.js`, `public/js/firebase-office.js`, Worker auth routes |
| Firestore tenant paths | REAL AND CONNECTED | `firestore.rules` `offices/{officeId}/**` |
| Office profile load/save | REAL AND CONNECTED | `public/js/office-settings.js` `loadFirestore`, `reserveOfficeName` |
| Logo click → settings | REAL AND CONNECTED | `#officeSettingsBtn` in `public/index.html`; `whatsapp-office.js` `openSettings` |
| Cover click → settings | MISSING | No dashboard cover click target |
| Visible “إعدادات المكتب” under logo | PARTIAL / conflict | Logo button shows settings caption — conflicts with “no standalone settings button” |
| Cover upload (R2) | REAL AND CONNECTED | `office-settings.js` → `POST /media/office-cover`; Worker `uploadOfficeCover` |
| Logo upload | MISSING | No logo input/route |
| WhatsApp-wide cover + crop UI | MISSING / PARTIAL | Canvas `drawImageCover` only; no configurable crop workflow |
| Office data fields | PARTIAL | Name/broker/license/city/phone present; separate WhatsApp field; email absent (good) |
| Office name uniqueness | PARTIAL | Client transaction + `officeNameClaims`; Worker approve used `normalizeOfficeId` and skipped claims; rules did not require claim |
| Office link copy/share | REAL AND CONNECTED | `copyLink`, `shareOfficeCard`, `/o/{slug}` rewrite |
| Standalone QR in settings | PARTIAL | QR embedded in share card image only |
| Device FCM on/off | REAL AND CONNECTED | `workflow-office.js` + Worker `/fcm/*` |
| Granular notification preferences | MISSING | No category map UI/persistence |
| Opportunity Bank settings entry | MISSING | No «بنك الفرص» |
| Smart cooperation mode | MISSING | No `cooperationMode` |
| Matching engine | PARTIAL | Worker matching/preview + intake match creation; tests in `worker.test.mjs` |
| Operations Center | PARTIAL | Real listeners in `workflow-office.js`; seed demo ops in `index.html` until replaced |
| Deals main card on home | PRESENT / constitution conflict | `data-main="deals"` «الصفقات» |
| Bottom navigation | MISSING (good) | No bottom nav found |
| WhatsApp production send | DEMO OR MOCK / adapter | Inbound-only; auto-send disabled |
| Telegram | MISSING | |
| Automated frontend tests | MISSING | Only `worker/test/worker.test.mjs` (40 tests at audit) |
| PWA + SW | REAL AND CONNECTED | `manifest.webmanifest`, `firebase-messaging-sw.js` |

## Security notes

1. Devices subcollection denied to clients (good).
2. Office name uniqueness enforceable only if claim write + rules align (gap at audit).
3. Public intake create is intentionally open — abuse surface.
4. Public intake media upload validates headers/size but not intake existence before R2 write.
5. Trial no-auth bypass when `ALLOW_TRIAL_NO_AUTH=true`.

## Tests at audit

```bash
cd worker && npm test
```

Result at audit: **40/40 passing**.

## Phase 0 document deliverables

- `docs/PROJECT_CONSTITUTION.md`
- `docs/SYSTEM_ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/EVENT_WORKFLOW.md`
- `docs/ACCEPTANCE_TESTS.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DECISIONS.md`
- `docs/PHASE0_AUDIT.md` (this file)
- `.cursor/rules/iaqar-project-constitution.mdc`
