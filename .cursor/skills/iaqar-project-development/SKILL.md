---
name: iaqar-project-development
description: Develop and review IAQAR.AI (Arabic RTL PWA for licensed brokers) following project constitution, architecture, and phase plan. Use when implementing features, fixing bugs, reviewing PRs, running tests, or deploying staging for this repository (iaqar.ai, workflow-office, opportunity bank, Cloudflare Worker, Firestore).
disable-model-invocation: true
---

# IAQAR.AI — Project Development Skill

## Product rule (supreme)

> **THE SYSTEM WORKS IN THE BACKGROUND. THE BROKER SEES ONLY THE NEXT REQUIRED ACTION.**

Before any change, read (do not skip):

1. `docs/PROJECT_CONSTITUTION.md`
2. `docs/SYSTEM_ARCHITECTURE.md`
3. `docs/IMPLEMENTATION_PLAN.md`
4. `docs/AUDIT_PHASE0.md` — several changelog claims are partial; verify before assuming a feature works.

Do not contradict approved requirements. Do not redesign the approved UI. Implement **one approved phase at a time**.

---

## Stack (fixed — do not migrate without owner approval)

| Layer | Location | Notes |
|-------|----------|-------|
| App shell | `public/index.html` | Inline CSS, SVG sprite, RTL Arabic |
| Front-end | `public/js/*.js` | No framework, no bundler, no build step |
| Pure domain logic | `public/js/*-domain.js` (ES modules) | No DOM; shared by browser + `node:test` |
| Classic UI scripts | e.g. `workflow-office.js` | IIFE; bridge via `window.IAQAR.*` |
| Backend | `worker/src/index.js` | Single Cloudflare Worker; Firestore/FCM REST only |
| Rules | `firestore.rules` | Never weaken for dev convenience |
| Tests | `npm test`, `npm run check` | Root runs web + worker suites |

Worker has **no Firebase SDK**. Front-end hiding is never security — enforce isolation in rules **and** Worker.

---

## Approved home page (only these three sections)

1. Office Card  
2. Add Opportunity  
3. Operations Center  

**Never add:** bottom nav, deals page (`Deals` / `الصفقات`), visible settings button, unapproved dashboard widgets, static demo operations, unrequested menu items, or broker-visible labels `فرصة مرصودة` / `فرصة قيد المتابعة` / `فرصة غير مطابقة`.

Office Settings opens **only** by clicking office logo or cover image. Visible fields there: office name, broker name, license number, city, mobile — **never email**.

Opportunity Bank (`العروض والطلبات`) is entered from Office Settings only — not a fourth home section.

---

## Multi-tenancy and data

- Every office-scoped document stores `officeId` as a field even when the path contains it (rules compare the field).
- Cooperation default: `APPROVAL_REQUIRED`; never auto-expose contact info.
- Broker-visible Opportunity Bank activity: date added + cooperation status only (no technical logs, scores, queue details).

---

## Code placement conventions

| Kind of logic | Where |
|---------------|-------|
| Pure, testable business rules | `public/js/*-domain.js` or `*-domain.mjs` |
| HTML builders (no DOM side effects) | `public/js/*-workspace-ui.js`, `*-ui.js` |
| DOM + Firestore + Worker calls | Classic IIFEs (`workflow-office.js`, parts of bank) |
| Bridge for non-module scripts | `public/js/opportunity-domain-bridge.js` → `window.IAQAR` |
| Worker-only logic | `worker/src/*.js`, `worker/src/*.mjs` |

Match surrounding naming, comment level, and patterns. Minimize diff scope.

### Script load order

- ES module bridges (`type="module"`) load **deferred** before deferred classic scripts.
- If a classic script needs `window.IAQAR.*` from a module bridge, give the classic script `defer` so the module runs first (see `workflow-office.js` + `opportunity-domain-bridge.js`).

---

## Broker action progress (checkmarks)

When the broker completes an action, show **✓ on the far left inside the button** and persist progress so leaving and returning preserves state.

| Piece | File |
|-------|------|
| Action keys + merge | `public/js/broker-action-progress-domain.js` |
| DOM marks | `public/js/broker-action-progress-ui.js` |
| Bridge | `public/js/opportunity-domain-bridge.js` → `window.IAQAR.brokerActionProgress` |
| Workflow UI | `public/js/workflow-office.js` — `data-broker-action`, `is-action-done`, `applyWorkflowBrokerMarks()` |
| Bank UI | `public/js/opportunity-bank.js`, `opportunity-bank-workspace-ui.js` |
| Persistence | `worker/src/index.js` — field `brokerActionProgress` on lifecycle actions |
| CSS | `public/index.html` — `.is-action-done::before { left: 12px; }` |

Pattern:

```html
<button class="iaqar-workflow-btn …" data-broker-action="followup:outcome:confirmed">تم التأكيد</button>
```

After save: `mergeBrokerActionProgress(record, actionKey)` → Firestore; on render: `applyBrokerActionMarks(root, record)`.

Lifecycle actions that must update progress: `contact_outcome`, `whatsapp_opened`, `call_opened`, `set_followup`, `followup_outcome`, `complete_followup`, `listing_shared_whatsapp`, `listing_copied`, `party_action`, `broker_action_done`.

---

## Integrations honesty

Never label an integration "production connected" without credentials, webhooks, signature validation, delivery handling, and real integration tests. Use **adapter ready** or **simulated**. Never store fake delivery success.

---

## Testing workflow (required before claiming done)

```bash
npm test          # web (node:test test/*.test.mjs) + worker suite
npm run check     # parse all shipped JS/JSON/HTML shells
```

For UI or persistence changes:

1. Add/update tests in `test/*.test.mjs` for domain logic; jsdom OK for mark application.
2. Manual or Playwright on staging **only after deploy** — staging may lag behind branch.
3. Provide evidence (screenshots/video/logs); do not claim untested integrations work.

Optional staging verify (Playwright not in root deps — install temporarily if needed):

```bash
node scripts/verify-broker-checkmarks-staging.mjs
```

Staging login (default): `0511123456` / `StagingLogo9`  
Hosting: `https://iaqar-ai-staging--staging-9c4b0k7h.web.app/`

Safe deploy script `scripts/deploy-staging-safe.sh` may require branch `cursor/opportunity-lifecycle-transfer-ed07` — check guard before assuming deploy works from any branch.

---

## Implementation checklist

Copy and track:

```
- [ ] Read PROJECT_CONSTITUTION + SYSTEM_ARCHITECTURE + IMPLEMENTATION_PLAN
- [ ] Scope matches one approved phase; no forbidden UI
- [ ] officeId isolation in rules + Worker (not front-end only)
- [ ] Domain logic in testable modules where possible
- [ ] npm test && npm run check pass
- [ ] Manual/staging evidence for broker-visible UX
- [ ] Honest report of partial/mock integrations
```

---

## Git and PR

- Branch prefix for cloud agents: `cursor/<descriptive-name>-9d79`
- Commit logical units; do not force-push unless asked
- Do not deploy or merge PRs unless explicitly requested

---

## Additional resources

- File map and Worker routes: [reference.md](reference.md)
- Always-applied rule: `.cursor/rules/iaqar-project-constitution.mdc`
