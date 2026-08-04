# IAQAR.AI — Implementation Plan

Phases, dependencies, risks, and current progress. Execution is controlled: one
approved phase at a time; stop for owner approval between phases (Section 28, 31).

## Progress snapshot

| Phase | Title | Status |
|---|---|---|
| 0 | Foundation & audit | ✅ done (this run) |
| 1 | Office Card & Office Settings | ✅ delivered (this run) — awaiting owner approval |
| 2 | Unified Opportunity intake | ⏳ not started |
| 3 | Opportunity Bank | ⏳ not started |
| 4 | Matching engine | ⏳ not started |
| 5 | Operations Center & notifications | ⏳ not started |
| 6 | Cooperation | ⏳ not started |
| 7 | Smart messages & integration adapters | ⏳ not started |
| 8 | Hardening | ⏳ not started |

## Phase 0 — Foundation & audit (done)

- Repository audited; features classified with file/line evidence (see final
  report and `docs/`).
- Governance documents created under `docs/`.
- Persistent Cursor rule created at `.cursor/rules/iaqar-project-constitution.mdc`.
- No product UI changed during Phase 0.

## Phase 1 — Office Card & Office Settings (done)

Deliverables and dependencies:

- Logo click **and** cover click open Office Settings; no visible Settings button.
- Visual identity: logo upload + cover upload with configurable WhatsApp cover
  crop ratio, preview, replace, remove, validation, loading/error states.
- Office data: name, broker, license, city, mobile. No email field.
- Office name: ≥ 4 visible chars + system‑wide normalized uniqueness (client
  transaction + Firestore rules + `officeNameClaims`).
- Office link: copy, share, QR display, preview public link.
- Notification preferences (6 channels) persisted per office.
- Opportunity Bank entry card ("بنك الفرص") — entry point only; full Bank is
  Phase 3, so the entry honestly indicates the Bank phase.
- Smart cooperation mode ("السماح بالتعاون الذكي") persisted, default
  approval‑required.
- Arabic RTL, mobile‑first, `officeId` isolation, loading/success/empty/error
  states, automated tests.

Dependencies: Firebase Auth + Firestore + Worker R2 (logo upload endpoint).

Risks / notes:

- **Dual phone/whatsapp vs. "Mobile number" (7.2):** the directive lists only
  "Mobile number" while the existing UI has both a contact phone and a WhatsApp
  number that downstream sharing depends on. Removing WhatsApp would delete
  working functionality (also forbidden). Resolution: both fields retained; logged
  in `docs/DECISIONS.md` as an open point for owner confirmation. No email field.
- Full runtime tenant‑isolation and manual mobile/PWA verification are scheduled
  for Phase 8; Phase 1 relies on audited Firestore rules + automated unit tests +
  markup review because this environment has no Firebase credentials.

## Phases 2–8

Scope per directive Section 28. Not started; each begins only after the previous
phase is approved. Cross‑cutting invariants (tenant isolation, honesty, no
Deals page, no bottom nav, ownership preservation) apply to every phase.
