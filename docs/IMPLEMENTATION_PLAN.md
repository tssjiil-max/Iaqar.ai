# IAQAR.AI — Implementation Plan

Version 1.0 · Phases, dependencies, risks, and current progress. Implement one
approved phase at a time; stop for owner approval between phases.

## Progress summary

| Phase | Scope | Status |
|-------|-------|--------|
| 0 | Foundation & audit, governance docs, Cursor rule | ✅ Done (this run) |
| 1 | Office Card & Office Settings | ✅ Implemented (this run) — awaiting owner approval |
| 2 | Unified Opportunity intake | ⛔ Not started (do not start without approval) |
| 3 | Opportunity Bank | ⛔ Not started |
| 4 | Matching engine | ⛔ Not started |
| 5 | Operations Center & notifications | ⛔ Not started |
| 6 | Cooperation | ⛔ Not started |
| 7 | Smart messages & integration adapters | ⛔ Not started |
| 8 | Hardening | ⛔ Not started |

## Phase 0 — Foundation & audit (done)

- Repository audited; architecture, working features and gaps recorded.
- Governance docs created in `docs/`; persistent Cursor rule created at
  `.cursor/rules/iaqar-project-constitution.mdc`.
- No product UI changed in this phase.

## Phase 1 — Office Card & Office Settings (done)

Delivered:

- Office Card now shows the office **logo** and **cover** images; both open
  Office Settings on click and via keyboard; the visible "Office Settings"
  text label was removed (screen‑reader label retained). No standalone button.
- Office Settings: logo + cover upload workflow (preview, replace, remove,
  type/size validation, loading + error states) with a **configurable** cover
  crop ratio (`IAQAROfficeLib.COVER_CROP_RATIO`).
- Office data fields (name, broker, license, city, mobile). No email field.
- Office name ≥ 4 significant chars + system‑wide normalized uniqueness
  (transaction + Firestore rules).
- Office link copy / share / QR / public preview.
- Notification preferences (6 approved categories) persisted per office.
- Opportunity Bank entry card (`بنك الفرص`).
- Smart cooperation mode selector (default `approval_required`).
- Firestore rules hardened: validate new fields; ownership fields
  (`ownerUid`, `officeId`) immutable except for platform admin.
- Worker media upload generalized (logo + cover) with a remove endpoint.
- Tests: `tests/office-settings.test.mjs` (pure logic) + extended worker tests.

Dependencies: none beyond existing stack. Risks: buildless frontend means logic
tests target extracted pure functions (`public/js/office-lib.js`); full UI/E2E
verification is deferred to Phase 8 tooling.

Known limitations carried forward:

- The home page still contains a legacy `الفرص/الصفقات` (opportunities/deals)
  toggle and static demo operation cards. Section 21 forbids a Deals page and
  §16 forbids static demo cards. Removing them requires the Operations Center
  (Phase 5) and unified intake (Phase 2) to exist first, so it is intentionally
  **deferred** and flagged, not silently changed. See `DECISIONS.md`.
- Full Opportunity Bank behaviour (list/detail/edit/share/scoped sharing) is
  Phase 3; Phase 1 only ships the settings **entry point**.

## Phases 2–8

Follow Directive §28 scopes. Each phase ends with: run tests, run build, report
changed files, list acceptance criteria as PASS/FAIL, report limitations, and
stop for approval.
