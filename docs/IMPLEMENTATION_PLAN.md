# IAQAR.AI — Implementation Plan

Phases follow the Master Engineering Directive (§28). One approved phase at a time;
each phase ends with tests, checks, a changed-files report, acceptance status, and a
stop for owner approval.

## Phase 0 — Foundation and audit — ✅ DONE (this run)

Repository audited (findings below), governance documents created
(`docs/PROJECT_CONSTITUTION.md`, `SYSTEM_ARCHITECTURE.md`, `DATA_MODEL.md`,
`EVENT_WORKFLOW.md`, `ACCEPTANCE_TESTS.md`, this plan, `DECISIONS.md`), persistent
Cursor rule added (`.cursor/rules/iaqar-project-constitution.mdc`). No product UI
changed in Phase 0.

### Audit summary (feature classification)

| Area | Classification | Evidence |
| --- | --- | --- |
| Multi-office isolation (rules + Worker auth) | REAL AND CONNECTED | `firestore.rules` (`isOfficeMember` wildcard, officeId required on writes), `authorizeOfficeRequest` in `worker/src/index.js` |
| Office settings (name/broker/license/city/phone, specialties, cover upload, link, share card) | REAL AND CONNECTED | `public/js/office-settings.js`, `/media/office-cover`, `officeNameClaims` transaction |
| Office name uniqueness (normalized, race-safe) | REAL AND CONNECTED | `normalizeOfficeNameKey` + Firestore transaction + rules ≥ 4 chars |
| Phone login / broker application / admin approval | REAL AND CONNECTED | `/auth/phone-login` (rate-limited), `/broker/apply`, `/admin/broker-applications*`, `access-gate.js` |
| Public intake (client/owner forms, media to R2) | REAL AND CONNECTED | `access-gate.js`, `/media/public-intake`, `publicIntake` rules |
| Arabic parser + matching engine + workflow (match→deal state machines) | REAL AND CONNECTED | Worker pipeline + 40 passing tests |
| FCM push (FID-first) + PWA + share target | REAL AND CONNECTED | `fcm-fid.js`, `firebase-messaging-sw.js`, `/fcm/*`, cron follow-ups |
| WhatsApp Business (Meta Cloud API) | PARTIAL / adapter-ready | Full webhook + embedded signup code; `META_APP_ID/CONFIG_ID` empty in `wrangler.toml` ⇒ UI honestly reports «يحتاج إعداد Meta». Inbound-only; outbound blocked (403) |
| Operations Center (formal operation records, dedup keys, empty state) | MISSING (workspace list streams matches/deals directly) | Phase 5 |
| Unified Add-Opportunity gateway (paperclip, files, OCR/docs/audio) | MISSING (text/share/public-form only) | Phase 2 |
| Opportunity Bank UI | MISSING before Phase 1 (data exists in `opportunities` collection) | Phase 1 entry + Phase 3 full bank |
| Cooperation (records, approvals, revocation) | MISSING | Phase 6 (mode setting shipped in Phase 1) |
| Telegram | MISSING | Phase 7 |
| Static demo operations on home page | DEMO/MOCK — **violation of §1.6** | Removed in Phase 1 |
| «الصفقات» tab + PWA deals shortcut | PRESENT — conflicts with §21 target | Scheduled removal in Phase 5 restructure (D-004) |
| `public/js/public-intake.js` | DEAD CODE (not loaded by `index.html`) | Removal proposed (D-005) |
| Email field in office settings | ABSENT (compliant) | — |
| Bottom navigation | ABSENT (compliant) | — |

### Security notes from the audit (tracked for Phase 8)

- `/pipeline/public-intake` is unauthenticated by design (public form) — acceptable, but
  rate limiting/abuse protection should be added in Phase 8.
- Public intake Firestore `create` is open by rules design (validated fields); the
  `mediaMissing/completeness/amount` fields written by the client are not in the rules
  whitelist — tighten in Phase 8.
- CORS is `*` on the Worker; endpoints are token-protected, but Phase 8 should restrict
  origins.

## Phase 1 — Office Card & Office Settings — ✅ IMPLEMENTED (this run, awaiting owner approval)

Delivered: logo & cover open settings; no visible settings button; logo upload;
cover upload with configurable wide (WhatsApp-style) crop preset + preview/replace/
remove; office data fields (no email); 4-char + system-wide unique name validation
(pre-existing, verified); office link copy/share/QR/preview; per-office notification
preferences enforced by the Worker push path; «بنك الفرص» entry opening the private
per-office bank list (real `opportunities` data, date added + cooperation status only);
smart cooperation mode (`disabled`/`approval_required` default/`smart_automatic`);
RTL/mobile-first preserved; loading/success/empty/error states; automated tests.

## Phase 2 — Unified opportunity intake — NOT STARTED (do not begin without approval)

Unified input + paperclip chooser on the home card; source persistence (R2);
normalization; missing-data flow; deduplication fingerprints; tests. Includes replacing
the «الفرص/الصفقات» tabs area with the approved Add-Opportunity card *only after owner
sign-off on the home-page restructure* (D-004).

## Phase 3 — Opportunity Bank (full)

Essential list/details, edit/archive/delete rules, single & multi share, scoped bank
sharing model, tests.

## Phase 4 — Matching engine hardening

Eligibility, scoring config, match reasons, matching-rule version in match identity,
automatic rematch triggers on updates/completion, tests.

## Phase 5 — Operations Center & notifications

Real `operations` records with `deduplicationKey`, approved empty state, match/
missing-data/cooperation operations, FCM + in-app routing, removal of the «الصفقات»
tab and PWA deals shortcuts (TEST 14 turns PASS here), tests.

## Phase 6 — Cooperation

Requests, approvals, revocation, permissions, ownership preservation, visible statuses
(«لم تُشارك» … «انتهى التعاون»), tests.

## Phase 7 — Smart messages & integration adapters

Arabic template store, WhatsApp/Telegram adapter contracts, webhook validation
structure, local simulation fixtures, honest integration states, tests.

## Phase 8 — Hardening

Security review, rules-emulator tenant-isolation suite, rate limiting on public
endpoints, CORS restriction, indexes, retries, accessibility, mobile/PWA validation,
end-to-end acceptance suite.

## Risks

- **Home-page restructure** (deals tab removal + Add-Opportunity card) touches the
  approved visual layout — requires explicit owner approval before Phase 2/5 execution.
- **Meta/Telegram credentials** are absent; integrations remain honestly
  "adapter-ready" until the owner provides credentials + review approvals.
- **No build system / no lint config** exists; verification = `node --check` syntax
  gate + test suites. Adding lint tooling is a Phase 8 candidate.
- **Firestore emulator tests** for rules are not yet set up; isolation currently rests
  on rule design + Worker checks (Phase 8 closes this gap).
