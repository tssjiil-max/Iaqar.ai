# IAQAR.AI — Implementation Plan

## Progress snapshot

| Phase | Name | Status |
|---|---|---|
| 0 | Foundation and audit | COMPLETE (this run) |
| 1 | Office Card and Office Settings | COMPLETE pending owner approval (this run) |
| 2 | Unified Opportunity Intake | NOT STARTED — requires owner approval after Phase 1 |
| 3 | Opportunity Bank | NOT STARTED |
| 4 | Matching Engine | NOT STARTED |
| 5 | Operations Center and Notifications | NOT STARTED |
| 6 | Cooperation | NOT STARTED |
| 7 | Smart Messages and Integration Adapters | NOT STARTED |
| 8 | Hardening | NOT STARTED |

## Phase 0 — Foundation and audit

Deliverables:

- Repository audit with evidence classifications (`docs/PHASE0_AUDIT.md`)
- Governance documents in `docs/`
- Persistent Cursor rule `.cursor/rules/iaqar-project-constitution.mdc`
- No product UI redesign in Phase 0 document-only work

## Phase 1 — Office Card and Office Settings

Required deliverables:

- Logo click → settings
- Cover click → settings
- No visible standalone Settings button
- Logo / display cover / WhatsApp-wide cover upload with configurable crop
- Office fields: name, broker, license, city, mobile (no email)
- ≥4 character + normalized uniqueness + race-safe claims
- Office link copy / share / QR
- Notification preference categories
- Opportunity Bank entry (“بنك الفرص”)
- Smart cooperation mode (default APPROVAL_REQUIRED)
- Arabic RTL, mobile-first, officeId isolation, loading/success/error states
- Automated tests

Out of scope for this run: Phase 2 intake gateway, full bank CRUD/sharing, matching engine rewrite.

## Dependencies

- Firebase project + Hosting rewrite `/o/**`
- Cloudflare Worker + R2 binding `IAQAR_MEDIA`
- Existing Firestore rules/indexes
- Existing FCM Worker routes

## Risks

| Risk | Mitigation |
|---|---|
| Home still shows legacy «الصفقات» main card | Documented; remove/replace only with owner approval (constitution vs existing UI) |
| Seed demo operations in `index.html` | Phase 5 must ensure production path never depends on them |
| Name uniqueness historically bypassable via Worker approve | Fixed in Phase 1 Worker + rules |
| WhatsApp production incomplete | Keep honest inbound-only labeling |

## Definition of Done (every phase)

Required functionality implemented; approved functionality preserved; tests/build/lint pass when configured; security rules updated when needed; tenant isolation held; no demo-dependent production path; docs updated; limitations reported; acceptance criteria PASS/FAIL listed.
