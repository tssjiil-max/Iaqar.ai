# Economic Test Mode Implementation Plan
> **For agentic workers:** Use superpowers:executing-plans; implement in this session. Owner explicitly requests autonomous execution.
**Goal:** A manager can test intake → review → repository → central matching → availability with no paid model and no outbound message.
**Architecture:** Reuse the existing WhatsApp queue and Office OS services; add a single scoped policy and manager test panel.
**Tech Stack:** ES modules, Cloudflare Worker, Firestore store, existing Office OS UI.
**Spec:** docs/superpowers/specs/2026-10-16-economic-test-design.md

## Global Constraints
Staging only; one configured office; no Production; no number registration; no subscriptions or paid provider calls; no external sends.
## Review Focus
Stale sending flag cannot bypass economic mode. Cached Claude replies cannot be reused. Missing office scope fails closed. Client-supplied cross-office ids fail. Expiry sweep cannot send reminders.

### Task 1: Scoped economic backend
Files: worker/src/office-os/economic-test-service.js; whatsapp-agent-service.js; routes.js; test/economic-test-mode.test.mjs.
- [ ] Add failing full Worker tests for receive/replay, review/save, matching, sold confirmation, expiry, cross-office and zero provider calls.
- [ ] Run red tests; implement scoped policy and manager endpoints with existing services.
- [ ] Add economic RULES path to existing WhatsApp queue, never send or call Claude.
- [ ] Verify new and existing queue/security suites.
### Task 2: Office panel and release evidence
Files: public/os/views/economic-test.js; public/os/app.js; public/os/views/agent.js; scripts/qa/office-os/economic-test.e2e.mjs; docs/whatsapp/ECONOMIC_TEST_MODE.md.
- [ ] Add Arabic RTL panel using existing components and manager-only API; explicit simulation/source labels and review confirmation.
- [ ] Run mobile/desktop browser journeys against actual Worker with isolated in-memory data.
- [ ] Run npm test and npm run check, record results and limitations, create independent Staging PR.
- [ ] Deploy only if release gates and exact office scope can be established safely; otherwise report concrete blocker.
