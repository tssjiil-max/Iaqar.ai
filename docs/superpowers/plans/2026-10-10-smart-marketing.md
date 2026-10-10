# Smart Marketing Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, then an independent whole-branch review.

**Goal:** A usable office marketing studio, private drafts and approvals, relevant campaigns, source-backed search and honest reports on Staging.
**Architecture:** Extend the existing Office OS router and store. Keep marketing rules, Canvas export, views and server persistence separate; never consume client property records. External capabilities fail closed.
**Tech Stack:** Existing JavaScript ES modules, Canvas, Firebase Auth/Firestore, Cloudflare Worker, node:test and Playwright.
**Spec:** `docs/SMART_MARKETING_DESIGN_AR.md`.

## Global Constraints
- Staging only; preserve public office links and the property journey.
- Server membership and management approval; no cross-office data, keys or customer data in the client.
- No automatic publication, spending, fabricated links or analytics.
- Preserve the six existing tools, theme, navigation and dimensions.

## Review Focus
- Concurrent edits must invalidate approvals without losing another draft.
- Fonts and inaccessible logos must never silently corrupt PNG export.
- Slow responses after navigation must not reinsert another office's content.
- Search snippets cannot supply system commands, prices or publication permissions.
- Share cancellation and opening a channel are never evidence of publication.

### Task 1: Domain and authorized persistence
Files: `public/os/domain/marketing-domain.js`, `worker/src/office-os/marketing-service.js`, `worker/src/office-os/routes.js`, `test/office-os-marketing.test.mjs`.
Interfaces: `marketingAction(ctx, body, actor) -> result`, `marketingProfile(office, link)`, `makeDraft(input)`, `marketingCampaigns(profile, settings)`.
- [ ] Write domain and real Worker harness tests for invalid input, canonical office identity, two offices, manager approval, edit invalidation and production rejection; run and observe failures.
- [ ] Implement bounded drafts and settings through the existing store with updateTime preconditions, explicit allowlists and request limits.
- [ ] Run `node --test test/office-os-marketing.test.mjs`; expect all PASS.

### Task 2: Real Arabic studio and existing tool integration
Files: `public/os/core/marketing-renderer.js`, `public/os/views/marketing.js`, `public/os/app.js`, `public/os/views/reference-layout.js`, `public/os/os.css`, `scripts/qa/marketing.e2e.mjs`.
Interfaces: `renderMarketing(container) -> cleanup`, `drawMarketing(canvas, profile, draft) -> Promise`, `marketingPng(canvas) -> Promise<Blob>`.
- [ ] Write browser acceptance for office identities, editing, persistence, Arabic rendering, PNG signature/dimensions and mobile overflow.
- [ ] Build five sections, drafts, text lengths, templates, size/font/position controls, campaign preparation and weekly plan. Keep original card dimensions/navigation.
- [ ] Verify local browser screenshots and actual PNG exports, using isolated harness data only.

### Task 3: Search, sharing and truthful reports
Files: server/service and client/view from Tasks 1–2, `test/marketing-search.test.mjs`.
Interfaces: `searchMarketing(ctx, query) -> sourced opportunities`; API search uses a fixed provider URL and server secret, never arbitrary outbound user URLs.
- [ ] Test absent provider, malformed URLs, search failure, source dates, saved favourites, limits and isolated reports.
- [ ] Implement configured Brave Search adapter, indexed-link recheck and explicit unknown publication terms; keep manual share actions and no claimed automatic delivery.
- [ ] Return unavailable visit/conversion metrics until live attribution is connected; report actual draft/approval counts separately from acquisition analytics.
- [ ] Audit current OG/canonical infrastructure without changing public links.

### Task 4: Regression, review and delivery
- [ ] Run new tests, `npm run test:web`, `npm run test:worker`, `npm run check`, browser acceptance, and inspect every failure against baseline.
- [ ] Independent whole-branch review, repair security/functionality issues, rerun relevant checks.
- [ ] Create PR against Staging without merging; use existing isolated preview deployment if credentials/CI permit, and report exact limits if not.
