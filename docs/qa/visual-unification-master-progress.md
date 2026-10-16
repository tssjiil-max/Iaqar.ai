# iAqar.ai visual unification — master progress (resume from here)

Branch: `codex/interior-composition-20261016` · PR #235 (draft) → `codex/unified-staging-lineage-2026-08-29`
Prior checkpoint (still valid): `docs/qa/interior-composition-20261016.md`
Production: untouched. No merge/deploy in this round yet.

## Status per phase

| Phase | Status | Evidence |
|---|---|---|
| A — review prior work, inventory | Done for feedback surfaces; route/state inventory carried over from `interior-coverage.json` (399 + 28 captures) | see prior checkpoint |
| B — find old-identity sources | Done for feedback (below). Remaining: in-page status lines (see "Open") | |
| C — notifications, dialogs, success/delete/error | **Done (40d655a)** | below |
| D — office settings interiors | **Batch 1 done (cf3dcaf)**: reviewed all 9 settings pages at 390 + 1440; fixed checkbox inconsistency and channels intro | below |
| Semantic colours (B, all surfaces) | **Done (61b0058)** | below |
| E–H | Not started in this round (prior PR work covers parts; see prior checkpoint) | |
| I — 7-width interactive matrix | Partial: feedback states only | |
| J — regression + acceptance | Partial | |

## Phase C — what changed (commit 40d655a)

Root causes found:
1. `os/os.css` toasts were solid slabs: navy default, red error, **old forest green `#0f7c4c` success** — this is the «تم الحذف» old look. Positioned `bottom:18px`, covering the bottom navigation.
2. `legacy.html` `#toast`: solid `#087064` bar, 13px.
3. Native browser `confirm()`/`alert()` (unstylable) in: `js/opportunity-bank.js` (2 confirm, 1 alert), `js/workflow-office.js` (1), `js/office-library.js` (1), `js/opportunity-import-advert-ui.js` (1), `js/v2/daily-tasks/controller.js` (1 confirm, 1 alert fallback), `js/v2/opportunity-details/controller.js` (1 alert).

Fix:
- `public/os/feedback.css` = single source for dialog + toast design on every surface (office pages + legacy). Loaded **before** `os.css` (so os.css's desktop sheet-centering media rule still wins). Duplicates removed from `os.css`.
- `os/core/ui.js`: tone chip markup; errors `role=alert`; `confirmDialog` labelled/described, Escape cancels, focus trap, destructive dialogs focus «إلغاء», focus returns; optional `cancelLabel`. Button order/classes unchanged (tests depend on them).
- All native popups → shared `confirmDialog` / toast (same conditions and early returns).
- Bug fixed: opportunity-details «تم الحفظ» toast never hid.

Verification (local Chromium, isolated harness data):
- `scripts/qa/office-os/feedback-states.e2e.mjs` — real record delete flow (Escape cancels with zero delete requests; confirm deletes; success toast above nav), error/info toasts, non-destructive confirm. 7/7 widths.
- `scripts/qa/office-os/legacy-feedback.e2e.mjs` — legacy page rendering of #toast (3 tones) and confirmDialog. 7/7 widths. **Legacy flows themselves are NOT exercised** (legacy needs Firebase; harness cannot boot it).
- Regression suites: library 23/23, settings 58/58, bot 39/39, community 34/34, completion 110/110, journey 45/45, session 13/13.
- Screenshots reviewed by eye at 390px (office: delete confirm, success, error, info, plain confirm; legacy: 3 toasts + confirm). Fixed one issue found in review (legacy toast lost side gutter).
- `test/office-os-system-feedback.test.mjs`: static part run locally; jsdom part runs in CI only.

Local-run note: this sandbox cannot install npm packages. `worker/node_modules/web-push` is a git-ignored local stub so the harness boots; global Playwright + `/opt/pw-browsers` used. Unit tests needing `jsdom` run in CI (PR "Office OS gate").

## Phase D batch 1 (cf3dcaf)

- Found by review: checkboxes differed per page (22px teal on notifications, browser-default on brokers/scout); channels page intro was loose text.
- Fix: one zero-specificity `:where()` checkbox/radio rule in `os.css`; channels intro uses the existing `feedback()` info notice.
- Also fixed a side effect from Phase C: `.os-feedback-icon` is shared with in-page notices; chip rules now scoped to `.os-dialog`/`.os-toast` (measured: in-page icon 22×22 as before).
- Desktop (1440) settings layouts reviewed: home 3-col, بيانات المكتب 2-col sections, OK.
- Tests: settings 58/58, bot 39/39.

## Semantic colours (61b0058)

Old greens/reds in status lines: legacy `--success #388E3C` + `#087064`; negotiation/access-gate `#056647/#af2535`; admin `#e8f7f2/#9e3434`; completion `#fff0f0/#8a2222`. All → office tokens: success `#23764B` on `#E8F5EE`, danger `#B03A3A` on `#FBECEC`. Values only. Checked admin/complete/legacy entry at 320/390/1440 (9/9, 0 console errors) and reviewed at 390.

## Open

- In-page status lines: colours now unified (61b0058). Their layout (text-only line vs. banner) still differs between legacy and office; only change with a visual reason.
- Legacy interior flows (bank, workflow, library, import advert, v2 daily tasks/details) are not exercised in the browser: the local harness cannot boot legacy (needs Firebase). Converted call sites are covered by source review + static test only.
- Phase D onward per the master order.
- Do not mark PR ready / merge / deploy until all gates in the order are met.

## Next action

Visual sweep of office settings interiors (Phase D) at 390 and 1440, compare against the approved office/settings tiles, fix real differences.
