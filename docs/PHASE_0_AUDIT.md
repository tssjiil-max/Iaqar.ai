# Phase 0 Factual Repository Audit

Audit baseline: commit `ea66a81` on `main`. Classifications describe the repository before the Phase 1 changes in this branch.

## Architecture and connected services

| Feature | Classification | Exact evidence |
|---|---|---|
| Firebase Hosting and Firestore deployment | REAL AND CONNECTED | `firebase.json` serves `public`, rewrites `/o/**`, and references `firestore.rules`/`firestore.indexes.json`; `.firebaserc` selects `aqar-b5d76` |
| Firebase client runtime | REAL AND CONNECTED | `public/index.html` loads Firebase compat SDKs/init; `public/js/firebase-office.js` creates `IAQAR.office`, office paths, and references |
| Firebase Authentication | REAL AND CONNECTED | `public/js/access-gate.js` phone login through `/auth/phone-login`, Firebase custom-token sign-in, admin email sign-in, and `verifyAccess` |
| Cloudflare Worker | REAL AND CONNECTED, secrets-dependent | `worker/src/index.js` exports `fetch`/`scheduled`; `worker/wrangler.toml` binds R2 and cron |
| R2 media | REAL AND CONNECTED | `uploadPublicIntakeMedia`, former `uploadOfficeCover`, and public media serving in `worker/src/index.js` |
| PWA | REAL AND CONNECTED | `public/manifest.webmanifest`, `share-target.html`, `firebase-messaging-sw.js` |
| Automated tests | PARTIAL | Only `worker/test/worker.test.mjs`; baseline 40 tests covered helpers/parser/matching/FCM previews but not UI/rules/E2E |
| Build/lint/typecheck | PARTIAL | No root `package.json`; `deploy-all.ps1` used `node --check` and Worker tests; lint/typecheck absent |

## Home and Office Settings baseline

| Requirement | Classification | Exact evidence |
|---|---|---|
| Arabic RTL/mobile visual shell | REAL AND CONNECTED | `<html lang="ar" dir="rtl">` and mobile CSS in `public/index.html` |
| No bottom navigation | REAL AND CONNECTED | No `<nav>` or bottom-navigation component in `public/index.html` |
| No Deals page/surface | BROKEN | `public/index.html` had `data-main="deals"` and visible “الصفقات”; inline `state.main` filtered it |
| Production Operations data | DEMO OR MOCK until listeners loaded | Inline `let data` contained six static A1/M1/F1/M2/D1/D2 cards; `workflow-office.js` later replaced them through `emitOperations` |
| Logo opens Settings | REAL AND CONNECTED | `#officeSettingsBtn`; `whatsapp-office.js` `openSettings` |
| Display image opens Settings | MISSING | No Office Card display-image control existed |
| No visible Settings control | BROKEN | Office logo showed visible text “إعدادات المكتب” |
| Dialog accessibility | PARTIAL | `role="dialog"`, `aria-modal`, Escape existed; focus entry/trap/restore did not |
| Office data fields | PARTIAL | Required fields existed, but separate WhatsApp and specialty controls exceeded the approved office-data list |
| Email hidden from office settings | REAL AND CONNECTED | No email input in `#officeProfileForm`; emails existed only in account/admin flows |

## Phase 1 feature baseline

| Feature | Classification | Exact evidence |
|---|---|---|
| Logo upload | MISSING | No logo file input/API |
| Display/cover upload | REAL AND CONNECTED | Former `#officeCoverInput` -> `onSave` -> `POST /media/office-cover` -> R2 |
| Image preview | REAL AND CONNECTED | Former `#officeCoverPreview` object URL |
| User crop | MISSING | Only internal card-generation center crop (`drawImageCover`) |
| Replace | PARTIAL | Fixed R2 cover key was overwritten |
| Remove | MISSING | No UI/API |
| Wide configurable cover | MISSING | No distinct field, crop preset, or design configuration |
| File validation | REAL AND CONNECTED | Browser and Worker restricted JPEG/PNG/WebP and 10 MB |
| Office-name frontend validation | REAL AND CONNECTED | Former `validateOfficeName`, `normalizeOfficeNameKey` |
| Global race-safe name uniqueness | PARTIAL | Former `reserveOfficeName` used a client Firestore transaction; `decideBrokerApplication` did not claim a normalized name and used `normalizeOfficeId` instead |
| Stable office link | PARTIAL | `buildPublicSlug` generated a hash suffix, but no global handle claim existed |
| Link copy | REAL AND CONNECTED | Former `copyLink` |
| Link share | PARTIAL | Office card sharing existed; no separate native office-link action |
| Visible QR | MISSING | QR existed only inside generated image canvas |
| Public preview action | MISSING | Public route existed; no Settings preview action |
| Device FCM toggle | REAL AND CONNECTED, live delivery UNKNOWN | `workflow-office.js` `enableNotifications`/`disableNotifications`; Worker `/fcm/*` |
| Six notification preferences | MISSING | Only local device enable state was stored |
| Opportunity Bank entry | MISSING | `opportunities` collection existed, but no Settings entry/private bank surface |
| Cooperation mode | MISSING | No field, UI, route, or rule |

## Tenant/security baseline

| Requirement | Classification | Exact evidence |
|---|---|---|
| Office-scoped reads | REAL AND CONNECTED, untested | `firestore.rules` `isOfficeMember`; Worker `authorizeOfficeRequest` |
| Office-scoped media management | REAL AND CONNECTED for cover | `uploadOfficeCover` authorized manager and used `office-covers/{officeId}/cover` |
| Ownership field protection | BROKEN/PARTIAL | Office root update rule did not preserve `ownerUid`; broad tenant catch-all prevented cross-office writes but allowed many same-office fields |
| Public projection | PARTIAL | `publicOffices` was world-readable and manager-writable without a field allowlist |
| Name-claim backend ownership | PARTIAL | Signed-in managers could write `officeNameClaims`; normalization remained client-controlled |
| Public-intake abuse protection | PARTIAL | Public media/intake accepted client-supplied `officeId`; no demonstrated rate limit |
| Secrets in repository | REAL AND CONNECTED for reviewed config | Runtime secret names only in scripts/docs; `wrangler.toml` did not contain secret values |
| CORS least privilege | PARTIAL | Worker returned `Access-Control-Allow-Origin: *` |
| Trial auth bypass | SECURITY RISK if enabled | `authorizeOfficeRequest` supports `ALLOW_TRIAL_NO_AUTH` for `META_TRIAL_OFFICE_ID` |

## Existing domain/workflow baseline

| Feature | Classification | Exact evidence |
|---|---|---|
| Message parsing | REAL AND CONNECTED in deterministic Worker path | `parseRealEstateMessage`; parser tests |
| Matching | REAL AND CONNECTED for current historical model | `rankMatchCandidates`, intake matching, preview tests |
| Unified Opportunity model | PARTIAL | `opportunities` documents existed, but clients/owners/deals remained primary historical workflow |
| Automatic rematching on relevant updates | UNKNOWN/PARTIAL | Intake triggered matching; no evidence for every relevant update event |
| Exactly-one versioned Match | PARTIAL | Deterministic behavior existed, but no canonical pair/rule/data-version acceptance test |
| Action-only Operations | PARTIAL | live workflow created action cards, but demo cards shipped and no dedicated `operations` domain existed |
| WhatsApp production connection | UNKNOWN/PARTIAL | Webhook/signup adapters existed; credentials, callbacks, and real delivery tests were not present in repository evidence |
| Telegram | MISSING | No adapter or webhook |
| Cooperation ownership/revocation | MISSING | No cooperation collections, rules, or handlers |

## Valuable existing documentation retained

The new governance files do not overwrite `docs/ARCHITECTURE-V1-AR.txt`, `docs/WORKFLOW-V5-AR.txt`, Meta/FCM/service-account runbooks, root/Worker Arabic READMEs, historical changelogs, or validation snapshots. Those files remain implementation history; their historical PASS statements are not treated as current automated evidence.
