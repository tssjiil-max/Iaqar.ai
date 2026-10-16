# Structural visual unification implementation plan

**Goal:** Continue the user-approved corrective brief: real shared composition across existing iAqar interfaces, Arabic RTL, preserving behavior and data.
**Architecture:** Extend existing DOM primitives with a shared page header, surface builder and navigation tile. Migrate existing callers rather than introduce a framework or parallel theme. Keep current office as visual reference.
**Tech stack:** ES modules, existing CSS, Node tests, isolated Playwright harness.
**Spec:** User corrective brief supplied on 2026-10-16; staging base d61f38e.

## Constraints
- New branch from staging. No main/production changes, no merging or deployment before review.
- Preserve existing nodes, listeners, data attributes, roles, references and navigation callbacks.
- Capture baseline screenshots before editing product code; use identical isolated fixtures after.
- Do not call overflow/font tests visual matching. Record untested surfaces explicitly.

## Tasks
1. Inventory route/view files and standalone entry points. Install project/browser dependencies; run baseline suite. Capture baseline at 390 and 1280 widths.
2. Add failing behavioral tests for shared header composition, safe text, callback/action preservation, card attributes and navigation tiles. Implement primitives in core/dom.js. Migrate all existing page-head and card constructors and settings navigation to explicit shared builders. Use office icon/title/description hierarchy; shared spacing and responsive layout in the existing site-theme.css.
3. Add browser structural assertions and screenshot comparisons to the existing harness. Cover routed views, loaded/empty/error/access states and sheets where fixtures support them. Run full npm test, npm run check, existing browser suites and expanded width coverage. Inspect contact sheets and individual screenshots; fix defects.
4. Commit changes and evidence/report. Push feature branch and open draft PR against staging. Report actual tested coverage and remaining limits; await visual acceptance before merge/deploy.

## Review focus
- Long Arabic titles with references/actions at 320px.
- Dynamic form titles retain live text updates.
- Busy/error/empty states retain original controls and payloads.
- Settings tiles preserve routes and manager-only controls.
- Sheets outside the application container inherit the same hierarchy.
