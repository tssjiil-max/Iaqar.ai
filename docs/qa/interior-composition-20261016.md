# Interior composition checkpoint — 2026-10-16

Release status: **INCOMPLETE; PR #235 remains a draft. No merge or deployment of this round.**

Base: `8d4bc811ca22031d31c2236cfa65162609258f1a` on `codex/unified-staging-lineage-2026-08-29`.
Work branch: `codex/interior-composition-20261016`.
PR: https://github.com/tssjiil-max/Iaqar.ai/pull/235

## Completed source batches

- `3e21048e9d2300ab52a0928154f122d8b49686b5`: real sections for office identity/licensing/contact/specialties, original photo controls, link/cooperation/notification settings, search states, market semantic table and calculator.
- `9725f6171db659f5dfa084ff069315ca27c23499`: record create/edit sections and assistant/scout settings. Smart/manual visibility, names, values, error slots and original handlers remain.
- `ba0a88d34c909ba2021553f9dd6b9dca701cabdc`: matching, cooperation and negotiation interior cards use shared heading/body slots. Cooperation edit redraw keeps its heading; session badges and supplied ARIA labels survive.
- `730d299b2b26e399434b317493760a7051f3b29b`: public owner/request intake, scout new search/detail interiors, feedback-copy preservation and desktop public shell. Removed the public shell's inline 560px constraint; final desktop field layout avoids narrow columns and large empty grid cells.

Existing shell/navigation, modal/sheet, tabs/filters, loading/empty/feedback and comparison primitives were reused. No backend, API, login, permission or Firestore-rule changes.

## Verification actually executed

| Suite | Result |
|---|---|
| Office OS unit tests | 398/398 |
| Settings, including save/photo/permissions | 58/58; final rerun also passed |
| Office completion, including search | 110/110 |
| Journey | 45/45; public-intake rerun also passed |
| Community/cooperation | 34/34 |
| Session, parties and broker | 13/13; no page errors |
| Agent | 19/19 |
| Scout | 82/82; final affected-page suite passed |
| Smart fill, public and office | 12 checks; final rerun passed |
| External broker | Browser script exited 0; conditional capacity/consent behavior preserved |
| Final focused unit set | 61/61 |
| Syntax/config parser | 785 targets parsed; this is not a type checker or linter |

Initial completion test was 109/110: the new initial empty state satisfied the test's generic wait before the 120ms search debounce finished. The test now waits for the actual «لا توجد نتائج» state; the unchanged result-navigation assertions pass. No test was removed.

Independent code review found no critical/important regressions in the three reviewed groups. Additional fixes from direct inspection preserved supplied ARIA labels and placed dynamic session/cooperation updates inside the shared body slot.

## Visual evidence: keep the three gates separate

- `qa/structural-visual/interior-coverage.json`: **399 application route/state × width captures**, plus **28 standalone entry captures**; widths 320, 360, 390, 430, 768, 1024 and 1440.
- Matching before captures use source `8d4bc81` against the same isolated harness. Captures include manual public/office forms, search results/empty state, API-created scout find/task and anonymous owner/client/reply pages.
- `qa/structural-visual/interior-review.html`: 22 self-contained before/after comparison pairs from real browser PNGs. Display copies use WebP at the original pixel dimensions; PNG hashes are embedded.
- The matrix marks six individually reviewed comparisons. **The remaining visual reviews are pending. A layout check is not visual acceptance.**
- The 28 standalone checks cover the access/entry screens of admin/legacy/completion/scout inbox, not every authenticated interior.
- Raw PNGs are reproducible local intermediates; selected comparison images are embedded in the committed HTML. Logs are under `qa/structural-visual/interior-logs/`.

## Exact continuation — do not restart

1. Continue on this branch/PR from the latest evidence commit; do not repeat completed refactors.
2. Review the pending comparisons in `interior-coverage.json` against the approved settings tiles; fix actual structural differences rather than declaring all 427 captures accepted.
3. Exercise authenticated admin panels in `public/js/admin-console.js` and legacy internals in `public/legacy.html` and its UI bridges. The current matrix proves their entry screens only. Use isolated fixtures and preserve permissions.
4. Assess the remaining HTML entries listed in the matrix (`share-target`, opportunity preview and `/qa` entries). Establish which are active user routes versus test-only before marking exclusions; none is currently counted as accepted.
5. Expand the dynamic-state matrix for every remaining modal, conditional form, load/error/empty state at the seven widths. Existing suites prove selected flows, not exhaustiveness.
6. Read the latest Office OS gate on the PR. The source-head run was `38864135773`; pending when checked. Evidence pushes may create a newer run. Do not reuse an older green SHA as approval for a new source head.
7. Only after functional, visual and coverage gates are complete: mark PR ready, merge to the Staging branch, run the established Staging workflow, verify published version/assets and inspect the deployed UI. Production remains outside scope.

## Reproduce capture/report tooling

```bash
WIDTHS=320,360,390,430,768,1024,1440 VARIANT=interior-before SOURCE_REF=8d4bc81 SCOUT_DETAILS=1 PARTY_PAGES=1 node scripts/qa/office-os/structural-visual.e2e.mjs
WIDTHS=320,360,390,430,768,1024,1440 VARIANT=interior-after SCOUT_DETAILS=1 PARTY_PAGES=1 node scripts/qa/office-os/structural-visual.e2e.mjs
WIDTHS=320,360,390,430,768,1024,1440 VARIANT=interior-after node scripts/qa/office-os/standalone-structure.e2e.mjs
python scripts/qa/office-os/build-interior-report.py
```

Use `SCREEN` to rerun only affected states. Capture source changes before producing new report images. Keep approval metadata honest: images present are not automatically images reviewed.

## Admin interior follow-up (2026-10-16)

Implemented real shared officeSection/formGrid/field/actionBar composition in authenticated admin overview, office list, office detail, activity, billing and audit. Detail now has five sections; every existing control ID, handler and AdminApi call is retained. AdminApi, server authorization and Firebase boot logic are unchanged.

Validation: admin/domain/authorization unit gate 15/15; browser fixture 42 current captures and 42 faithful baseline captures across 320,360,390,430,768,1024,1440; no horizontal document overflow or page errors. All five management actions (subscription, license, note, suspend, reactivate) retained exact request payloads at every width. These tests mock only admin transport in the local harness, so they are NOT evidence of live platform-admin authorization.

Actual evidence: `qa/structural-visual/admin-interior-review.html`, before/after matrices in `admin-before/results.json` and `admin-after/results.json`. Detail at390 and1440 inspected directly; other comparison pairs remain pending individual visual acceptance. Independent code review found no important product regressions and requested faithful baseline HTML; capture script now substitutes baseline HTML as well as JS/CSS.

Reproduce: `node scripts/qa/office-os/admin-interiors.e2e.mjs`; baseline `SOURCE_REF=730d299 node scripts/qa/office-os/admin-interiors.e2e.mjs`. Raw captures are reproducible intermediates; selected actual screenshots are embedded in the committed report.

Next: authenticated legacy interiors and remaining individual visual reviews. This batch does not satisfy the whole-site release gate. PR235 remains draft; no Staging merge/deployment of this round.

## Continuation — shared navigation and official services (2026-10-16)

New commits on the PR branch:
- `c632fe44`: settings grid tile sizing, Arabic text wrapping, narrow-screen spacing.
- `0beeed21`: shared `navigationTile` supports native links without changing existing button callers.
- `50dab176`: official service entries use that shared semantic component; external target/rel attributes retained.
- `124008c8`: services surface adopts the same responsive settings grid.
- `21bf18c0`: scoped service-link card geometry and visible keyboard focus.

Scope: DOM composition and CSS only; no Firestore, API, authentication, permissions, or production configuration changes. These are source changes, not proof of visual acceptance. Browser regression and individual before/after review for the service links and settings cards remain **PENDING**. Do not mark the PR ready, merge, or deploy on this evidence alone.

Immediate next action: run affected office-tools and settings functional tests; exercise `#/tools/services` at 320, 360, 390, 430, 768, 1024, 1440, verify link target/rel and no horizontal overflow, then review the resulting captures. Continue authenticated legacy interiors and remaining visual matrix thereafter.
