# IAQAR.AI Implementation Plan

## Current progress

| Phase | Status | Notes |
|---|---|---|
| 0 — Foundation and audit | Implemented in current branch; verification pending | Factual audit and governance documents created; no stack migration |
| 1 — Office Card and Office Settings | Implemented in current branch; verification pending | Backend-enforced names, identity, links, preferences, bank entry, cooperation mode |
| 2 — Unified Opportunity intake | Not started | Explicitly outside the current execution |
| 3 — Opportunity Bank | Not started | Phase 1 provides only the private entry/read-only shell |
| 4 — Matching engine | Not started under the new constitution | Historical matcher exists and requires model/idempotency alignment |
| 5 — Operations and notifications | Not started under the new constitution | Existing workflow/FCM is partial input, not completion |
| 6 — Cooperation | Not started | Phase 1 stores only the office mode |
| 7 — Smart messages/adapters | Not started | Existing WhatsApp is inbound-only; outbound remains disabled |
| 8 — Hardening | Not started | Requires emulator/E2E/security/performance/accessibility work |

## Phase dependencies

1. Phase 2 depends on the governance model, office identity, and tenant authorization from Phases 0–1.
2. Phase 3 depends on the unified Opportunity schema and source linkage from Phase 2.
3. Phase 4 depends on normalized Opportunity data, deduplication identities, and data versions.
4. Phase 5 depends on idempotent Match events and defines actionable Operation/notification records.
5. Phase 6 depends on protected ownership metadata and explicit minimum-data projections.
6. Phase 7 depends on Operations, recipient permissions, and auditable send states.
7. Phase 8 exercises every earlier phase and closes security/performance/accessibility gaps.

## Phase 0 audit snapshot

| Area | Classification | Evidence |
|---|---|---|
| Firebase Hosting/Firestore/Auth tenant runtime | REAL AND CONNECTED | `firebase.json`; `public/js/firebase-office.js` |
| Cloudflare Worker and R2 | REAL AND CONNECTED, configuration-dependent | `worker/src/index.js`; `worker/wrangler.toml` |
| Office membership isolation | REAL AND CONNECTED, automated isolation test missing | `firestore.rules` (`isOfficeMember`, `canManage`); `authorizeOfficeRequest` |
| Existing Office Settings persistence | PARTIAL before Phase 1 | Former `reserveOfficeName`, cover-only flow in `public/js/office-settings.js` |
| Logo/display-image entry to Settings | PARTIAL before Phase 1 | Logo opened settings; no Office Card cover trigger |
| Full visual identity workflow | MISSING/PARTIAL before Phase 1 | Cover upload existed; logo, wide cover, user crop, and removal absent |
| Office-name uniqueness | PARTIAL before Phase 1 | Client transaction existed; broker approval used inconsistent normalization and no claim |
| Public office link/share | PARTIAL before Phase 1 | Stable-ish hash slug, copy/share card; no visible QR or preview action |
| Granular notification preferences | MISSING before Phase 1 | Only device-level FCM enable/disable existed |
| FCM device/send path | REAL AND CONNECTED, live delivery UNKNOWN | Worker `/fcm/*`; service worker; FCM tests |
| Opportunity Bank | PARTIAL before Phase 1 | `opportunities` collection existed; no private bank entry/surface |
| Smart cooperation | MISSING before Phase 1 | No mode field or UI |
| Operations Center | PARTIAL/DEMO before Phase 1 | Live listeners existed, but `public/index.html` shipped six static demo operations |
| No Deals page | BROKEN before Phase 1 | Home had `data-main="deals"` card and deal filter |
| WhatsApp integration | PARTIAL | Official inbound webhook/embedded signup exist; runtime credentials and real callback tests unknown |
| Telegram integration | MISSING | No adapter |
| Automated tests | PARTIAL | Worker unit tests only; no frontend, rules-emulator, or E2E suite |
| Build/lint/typecheck | PARTIAL | Syntax/deploy preflight exists; no root build, lint, or typecheck configuration |

Detailed evidence is in `docs/PHASE_0_AUDIT.md`.

## Current Phase 1 deliverables

- Office logo and display image are accessible Settings triggers.
- No visible Settings button, bottom navigation, Deals home card, or demo Operations data.
- Logo, display image, and configurable-ratio wide cover support selection, preview, focal crop/zoom, replacement, removal, validation, loading/error status, upload, and save.
- Office data exposes only office name, broker name, license number, city, and mobile.
- Worker normalization plus Firestore transactions enforce global name uniqueness and stable public handle claims.
- Office link copy/share/preview and on-screen QR are present.
- Six notification preferences persist per office and filter existing Worker push sends.
- Opportunity Bank entry opens an authenticated office-scoped read-only shell; Phase 3 functionality remains deferred.
- Cooperation mode defaults to `APPROVAL_REQUIRED`.
- Rules protect `officeId`, ownership, office name, claims, handles, and public projection writes.

## Risks and limitations

- Existing offices with legacy public slugs use a fallback query until their next Phase 1 settings save creates `officeHandles`.
- Browser and Firebase emulator E2E infrastructure is absent; Node contract tests cannot prove live authorization, R2, FCM, native share, or concurrent Firestore behavior.
- Fixed R2 image keys mean a successful upload can replace object content before a later profile-save network retry completes.
- The Worker remains a large monolith. Refactoring requires a dedicated approved change and must preserve routes.
- Historical `deals` data/code remains internal for compatibility even though the Deals home surface is removed.
- Existing unauthenticated public-intake media abuse controls and broad tenant subcollection rule patterns require Phase 8 hardening.

## Exact next recommended phase

After owner approval of the Phase 1 report: Phase 2 — Unified Opportunity Intake. Start by documenting the source/attachment contract and unified Opportunity schema migration, then implement the compact text/link field, paperclip chooser, source persistence, deterministic normalization, missing-data flow, and input deduplication. Do not start matching or cooperation work in that phase.
