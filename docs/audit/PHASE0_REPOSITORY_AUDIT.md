# Phase 0 — Repository Audit (factual)

**Date:** 2026-08-04  
**Branch baseline:** `main` @ `ea66a81`  
**Working tree at audit start:** clean  

Classifications: **REAL AND CONNECTED** | **PARTIAL** | **DEMO OR MOCK** | **MISSING** | **BROKEN** | **UNKNOWN**

Evidence cites exact files/symbols. Features are not assumed working without evidence.

---

## Stack overview

| Area | Evidence | Classification |
|------|----------|----------------|
| Firebase Auth client | `public/js/access-gate.js`, `firebase-office.js` | PARTIAL (email/password + Worker phone-directory login; not Firebase SMS OTP) |
| Firestore | `firestore.rules`, client collections under `offices/{officeId}` | PARTIAL (isolation mostly real; claim uniqueness previously race-unsafe) |
| FCM / PWA | `workflow-office.js`, `firebase-messaging-sw.js`, Worker `/fcm/*`, `manifest.webmanifest` | PARTIAL |
| Cloudflare Worker | `worker/src/index.js` | REAL AND CONNECTED (routes exist; live secrets UNKNOWN) |
| R2 media | `uploadOfficeCover`, `IAQAR_MEDIA` | PARTIAL |
| Automated tests | `worker/test/worker.test.mjs` (40 tests) | PARTIAL (Worker only) |
| Arabic RTL UI | `public/index.html` `lang="ar" dir="rtl"` | REAL AND CONNECTED |

---

## Phase 1 feature audit (pre-change)

| Feature | Classification | Evidence |
|---------|----------------|----------|
| Home: Office Card | PARTIAL | `.card.license` in `public/index.html` |
| Home: Add Opportunity | PARTIAL / unclear vs “opportunities” main card | `data-main="opportunities"` — not yet unified intake (Phase 2) |
| Home: Operations Center | PARTIAL + DEMO seed | `#workspace` / `#operationList`; seed ops `A1`,`M1`,`D1`… in `index.html` |
| Bottom navigation | MISSING (good) | No bottom nav markup found |
| Separate Settings button | PARTIAL | Logo button `#officeSettingsBtn` acts as settings affordance; no standalone global settings control |
| Logo → Settings | PARTIAL | `#officeSettingsBtn` → `whatsapp-office.js` `openSettings()`; header `.site-logo` not wired |
| Cover → Settings | MISSING | No home cover click target; cover only in settings upload |
| Logo upload | MISSING | Static embedded logo image in office card |
| Cover upload | PARTIAL | `#officeCoverInput` → Worker `/media/office-cover` in `office-settings.js` |
| WhatsApp-wide cover + configurable crop | MISSING | Canvas `drawImageCover` for share card only |
| Office data fields | PARTIAL | name/broker/phone/whatsapp/license/city; **no email in settings** (PASS for email absence) |
| Unique office name | PARTIAL / BROKEN at rules | `validateOfficeName`, `reserveOfficeName` transaction; rules allowed claim overwrite |
| Office link copy/share/QR | PARTIAL | copy + share card with QR; no dedicated preview control |
| Notification category prefs | MISSING | Device enable/disable only (`#officeNotificationControl`) |
| Opportunity Bank entry | MISSING | No بنك الفرص in settings |
| Smart cooperation mode | MISSING | No cooperation settings |
| Deals page | PARTIAL conflict | No `/deals` route; `data-main="deals"` main card exists |
| officeId client scoping | REAL AND CONNECTED (client) | `firebase-office.js` builds `offices/{officeId}` refs |
| Cross-office isolation | PARTIAL | Rules + Worker auth; gaps in claims + broad catch-all |

---

## Broader platform audit

| Area | Classification | Evidence |
|------|----------------|----------|
| Opportunity intake pipeline | REAL AND CONNECTED | Worker `/pipeline/*`, `/meta/webhook` |
| Analysis engine | PARTIAL | Local parser, not AI extraction adapter |
| Opportunity Bank UX | MISSING / PARTIAL data | `opportunities` written; no bank UI |
| Matching engine | PARTIAL | `findAndSaveMatches`; idempotent-ish `mat_…` ids; no general rematch API |
| Operations Center live data | PARTIAL | `workflow-office.js` `startLiveData` / `emitOperations` + HTML demo seed |
| Cooperation workflow | MISSING | No collections/UI |
| WhatsApp production | PARTIAL | Inbound adapter; outbound blocked; credentials required |
| Telegram production | MISSING | No API integration |
| Firestore rules tests | MISSING | None found |

---

## Security risks (audit)

1. `officeNameClaims` update allowed without verifying existing claim ownership (**BROKEN** → fixed in Phase 1).
2. Broad `offices/{officeId}/{collectionName}/{docId}` write catch-all.
3. Unauthenticated public intake/media abuse potential (by design for public forms; needs rate limits — Phase 8).
4. No automated rules unit tests.

---

## Tests observed

- Executable: `cd worker && npm test` → historically 40 tests in `worker/test/worker.test.mjs`.
- Many `VALIDATION-*.txt` files are manual/static historical reports, not a CI suite.
