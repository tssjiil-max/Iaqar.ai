# IAQAR.AI Implementation Plan

## Control rules

- Read `PROJECT_CONSTITUTION.md`, `SYSTEM_ARCHITECTURE.md`, and this file before changing code.
- Work on one approved phase at a time.
- Preserve unrelated working infrastructure.
- Commit only evidence-backed completion. External configuration remains “adapter ready” until tested live.
- At each phase boundary run tests/build, update this plan, publish PASS/FAIL criteria, and stop for owner approval.

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundation audit and governance | Implemented; verification pending |
| 1 | Office Card and Office Settings | Implemented; verification pending |
| 2 | Unified Opportunity intake | Not started; approval required |
| 3 | Opportunity Bank | Not started |
| 4 | Matching engine and rematching | Not accepted under this plan; legacy code exists |
| 5 | Operations and notifications | Not accepted under this plan; legacy code exists |
| 6 | Cooperation | Not started beyond Phase 1 preference |
| 7 | Message drafts and adapters | Not accepted; official inbound adapter exists |
| 8 | Hardening/full acceptance | Not started |

## Phase 0 — Foundation and audit

Deliverables:

- Factual repository audit with exact evidence.
- Governance documents under `docs/`.
- Persistent Cursor constitution rule.
- No framework, database, hosting, or architecture migration.

Primary findings are recorded in `REPOSITORY_AUDIT.md`.

## Phase 1 — Office Card and Office Settings

Implemented scope:

- Office logo and display-image settings entry targets.
- No visible standalone settings label/button.
- Three office identity assets: logo, display image, and configurable-ratio wide cover.
- File type/size validation, local preview, focus/zoom crop, replace, remove, loading, success, and error states.
- Approved office fields only; no visible email, secondary WhatsApp, or specialty editor.
- Shared browser/Worker name normalization, pre-save availability feedback, Firestore transactional claim, and backend broker-approval claim.
- Stable office link copy, native share, QR, public preview, and branded office-card generation.
- Six persisted notification categories plus preserved per-device FCM enablement.
- Opportunity Bank settings entry with a private, honest Phase 3 boundary screen; no bank records are fabricated.
- Cooperation modes with `APPROVAL_REQUIRED` default and no automatic contact exposure.
- Office-scoped settings and append-only settings audit event.
- Manager-authorized, tenant-scoped R2 identity uploads/removals.
- Match/follow-up notification preference enforcement.
- Removal of production-visible demo operations and visible Deals navigation.

Verification commands:

```bash
npm run build
npm run test:phase1
npm run test:rules
npm --prefix worker test
npm test
```

No lint or TypeScript command exists in the repository. `npm run build` performs syntax checks for browser, Worker, service-worker, and admin JavaScript; compiles inline scripts; and validates the static PWA/Firebase configuration.

## Phase 1 risks and dependencies

- Firebase Rules emulator requires Java and the latest Firebase CLI fetched by `npx`.
- Live save/upload tests require a deployed Worker, Firebase project, R2 binding, and an authorized manager account. Unit/rules tests do not prove deployed connectivity.
- Browser image cropping relies on Canvas/WebP support; supported current browsers provide it.
- Public office media is intentional branding. Private opportunity attachments must use different, authorization-protected paths in later phases.
- Existing Worker and workflow modules contain later-stage functionality. It is preserved but must be reconciled to the constitution in its assigned phase.

## Phase 1 acceptance status

Final PASS/FAIL results are filled only after the verification gate:

| Criterion | Status before verification |
|---|---|
| Logo opens settings | Pending |
| Display cover opens settings | Pending |
| No visible Settings button | Pending |
| No bottom navigation | Pending |
| Name minimum/normalization/unique race guard | Pending |
| Office A blocked from Office B | Pending |
| Identity upload/crop/replace/remove contracts | Pending |
| Link copy/share/QR/preview | Pending |
| Notification preferences persisted | Pending |
| Opportunity Bank entry | Pending |
| Cooperation mode default/persistence | Pending |
| Arabic RTL/mobile layout | Pending |
| No Deals page/navigation | Pending |
| Existing tests/build | Pending |

## Exact next recommended phase

After owner approval of the Phase 0/1 report: **Phase 2 — Unified Opportunity Intake**. Do not implement Opportunity Bank listing, new matching behavior, cooperation records, or smart-message delivery as part of Phase 2 unless the phase scope is explicitly expanded.
