# IAQAR.AI — Implementation Plan

Phases follow directive §28. One phase at a time; each ends with tests, build, a changed-file
report, honest limitations and an explicit stop for owner approval.

Current position: **Phase 0 complete, Phase 1 complete, awaiting owner approval for Phase 2.**

---

## Phase 0 — Foundation and audit ✅

* Inspected the repository and produced `docs/REPOSITORY_AUDIT.md` with per-feature
  REAL / PARTIAL / DEMO / MISSING / BROKEN classification and file:line evidence.
* Recorded the stack, working features, demo-only paths and six ranked security risks.
* Created `docs/PROJECT_CONSTITUTION.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/DATA_MODEL.md`,
  `docs/EVENT_WORKFLOW.md`, `docs/ACCEPTANCE_TESTS.md`, `docs/IMPLEMENTATION_PLAN.md`,
  `docs/DECISIONS.md`.
* Created the persistent rule `.cursor/rules/iaqar-project-constitution.mdc`.
* No product UI was changed in this phase.

## Phase 1 — Office Card and Office Settings ✅

Delivered:

* Office Card cover/display image, clickable, opens Office Settings; logo trigger kept and the
  visible "إعدادات المكتب" caption removed (no standalone settings button remains).
* Visual identity workflow for logo, display image and wide share cover: upload, preview,
  aspect-ratio crop with a focus slider, replace, remove, save, type/size validation, loading and
  error states. Crop ratios are configuration values in `public/js/office-identity.js`.
* Office data fields limited to office name, broker name, licence number, city and mobile
  numbers; no email field.
* Office-name rules: ≥ 4 significant characters, Arabic + Latin, whitespace rejected, normalized
  system-wide uniqueness, transactional reservation, and hardened Firestore rules that prevent
  one office from overwriting another office's claim.
* Office link: copy, share, QR code display and public-link preview.
* Notification preferences: six categories, office scope plus per-broker override, stored in
  `offices/{officeId}/officeSettings`.
* Opportunity Bank entry ("بنك الفرص") inside Office Settings, honestly labelled as opening in
  Phase 3 and showing no fabricated records.
* Smart cooperation mode with the three approved modes and `approval_required` as the default.
* Tests: Node unit tests for the shared rules module, jsdom DOM tests for the Office Card and
  Office Settings behaviour, static policy tests for the home page and Firestore rules, plus new
  Worker tests for the media-kind routing.

Risks accepted: see `docs/DECISIONS.md` D-002 (existing deals surface), D-003 (WhatsApp number
field), D-005 (no Firestore emulator in this environment).

## Phase 2 — Unified opportunity intake (next)

Dependencies: Phase 1 settings storage, R2 media pipeline.

* Unified home-page intake card: one text/link input + paperclip + submit in one row.
* Attachment chooser for camera, image, screenshot, PDF, Excel, Word, audio.
* `opportunitySources` persistence with checksum-based deduplication.
* Unified `Opportunity` schema (directive §11) with raw / extracted / normalized / confirmed value
  separation and a `version` counter.
* Missing-data flow that asks only for what extraction could not supply.
* Event outbox skeleton (`eventOutbox`) with idempotent handlers.
* Risks: file parsing adapters have no credentials in this environment; they ship as adapters with
  fixtures and are labelled simulated.

## Phase 3 — Opportunity Bank

Private office bank opened from the Phase 1 entry; essential list and details; date added and
cooperation status only in the activity summary; edit/archive/delete rules; single and multi
sharing; scoped bank-sharing model.

## Phase 4 — Matching engine

Eligibility, configurable thresholds, scoring, reasons, mismatch fields, idempotent match identity
(canonical pair + rule version + data version), automatic rematching from the outbox.

## Phase 5 — Operations Center and notifications

Real `operations` records with `deduplicationKey`; replace the demo array on the home page; empty
state; match, missing-data and cooperation operations; wire the Worker's FCM router to the Phase 1
preference model; in-app fallback.

## Phase 6 — Cooperation

Requests, approvals, revocation, permission scopes, ownership preservation, cooperation audit
logging.

## Phase 7 — Smart messages and integration adapters

Arabic templates, WhatsApp and Telegram adapter contracts, webhook validation structure, local
simulation fixtures, honest integration state labels, message entities with real send/delivery
state.

## Phase 8 — Hardening

Security review, Firestore emulator rules tests, tenant-isolation tests, rate limiting for public
intake and R2 uploads (audit risks 4.2 and 4.3), performance, indexes, retry behaviour, error
handling, accessibility, mobile testing, PWA validation, full end-to-end acceptance suite.

---

## Cross-phase risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| No Firestore emulator in CI | rules regressions ship unverified | static rule assertions now; emulator suite in Phase 8 |
| Demo operations array still on the home page | violates §16 | removed in Phase 5 together with real Operations |
| Deals surface conflicts with §21 | constitution conflict | owner decision D-002 before any removal |
| Anonymous intake endpoints unthrottled | abuse | Phase 8 rate limiting |
| Single 380 KB `index.html` with inlined base64 images | maintainability | logo/cover now come from R2; extracting CSS is a future clean-up, not a redesign |
