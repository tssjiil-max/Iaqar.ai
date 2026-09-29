# Office OS rebuild — implementation plan (Staging)

Branch: `claude/office-os-rebuild-20260930`, cut from the real Staging branch
`codex/unified-staging-lineage-2026-08-29` (head `2ca9160`, PR #130). Any push to that
branch auto-deploys Staging (`.github/workflows/deploy-unified-staging.yml`), so this work
is delivered as a PR only. Production (`main`, `aqar-b5d76`, production Worker) is not
touched.

This plan supersedes the "approved home sections" rule in `PROJECT_CONSTITUTION.md` for
the new office experience, by explicit owner instruction (rebuild brief, §2 and §6). All
other constitutional rules stay: officeId isolation in rules *and* Worker, Worker-only
writes for matches/operations/notifications, honest integration states, no fake data.

## 1. Audit summary — what exists and is kept

| Area | State | Decision |
| --- | --- | --- |
| Repository records `offices/{o}/opportunities` (`opportunityKind` OFFER/REQUEST, `purpose`, lifecycle soft delete) | Works | Keep as the single source of each record. |
| Public office link → `publicIntake` → `POST /pipeline/public-intake` (office from slug, duplicate check, optional area, matching) | Works | Keep; new public page writes the same shape. Add default responsible broker. |
| Matching engine `worker/src/matching-engine.js` (real score, reasons, warnings, versioned ids, supersede) | Works | Keep. Compatibility level is derived from the real score only. |
| `MATCH_REVIEW` operations (deterministic id, re-ensured on replay) | Works | Keep; add top-level `offerId` / `requestId`. |
| `operations` + `notifications` (Worker-only writes, FCM with honest state) | Works | Reused as the Daily Tasks source for all new task types. |
| Match events / party sessions / legacy negotiation workspace | Works but tied to the old shell | Preserved untouched (old links keep working through `legacy.html`); the new flow does not depend on it. |
| `public/index.html` (6.8k lines, old navigation) | Replaced | Moved verbatim to `public/legacy.html`; old deep links (`cv2Party`, completion…) are forwarded there. |

Environment limits found: npm registry is blocked by egress policy here, so `jsdom`,
`firebase-tools` and `web-push` cannot be installed. Baseline: 925/986 web tests pass;
the 61 failures are pre-existing and environment-caused. New code is tested without
those packages; browser checks use the preinstalled Playwright Chromium.

## 2. Structure

Front end (no build step, ES modules):

```
public/index.html           new shell: public office page, office login, office app
public/r.html               lightweight reply page  (/r#<token>)
public/legacy.html          previous shell, unchanged (support tools + old links)
public/os/domain/*.js       pure logic shared with the Worker and node:test
public/os/core/*.js         runtime, api, auth, ui primitives, icons, formatting
public/os/views/*.js        shell, daily tasks, repository, record form/detail,
                            opportunity workspace, composer, public office, reply
public/os/os.css            design tokens + components from the approved reference
```

Worker (new, isolated modules; one route hook in `index.js`):

```
worker/src/office-os/routes.js          /os/* dispatch + auth
worker/src/office-os/store.js           Firestore helpers used by the modules
worker/src/office-os/permissions.js     member / assigned broker / manager checks
worker/src/office-os/records-service.js save, archive/soft-delete, manual candidates
worker/src/office-os/journey-service.js match review decisions, stage changes, close
worker/src/office-os/proposal-service.js proposals, templates, WhatsApp handoff
worker/src/office-os/reply-service.js   token mint/verify, public view, replies
worker/src/office-os/task-service.js    journey tasks in `operations`
worker/src/office-os/event-log.js       append-only journey events
worker/src/office-os/assist-service.js  AI suggestion (Gemini) with deterministic fallback
```

Extensibility: task types, proposal templates, reply options, stages and transitions are
registries in `public/os/domain/*` — adding one is a new registry entry, not new wiring.

## 3. Data model additions (additive only, nothing deleted)

| Path | Written by | Purpose |
| --- | --- | --- |
| `offices/{o}/journeys/{jr_*}` | Worker | The opportunity workspace for one approved match. id = hash(office, matchId) → one per match. Holds `stage`, `status`, `currentAction`, parties' last replies, viewing state, agreement, outcome, `assignedBrokerId`, and a frozen `approvalSnapshotJson` (history only; live data is read from the repository). |
| `offices/{o}/journeys/{j}/events/{ev_*}` | Worker, create-only | Timeline: type, actor, source (`BROKER`, `REPLY_LINK`, `BROKER_NOTE`, `SYSTEM`), time. |
| `offices/{o}/proposals/{pr_*}` | Worker | Proposal per recipient: kind, fields, message text, reply options, status (`ACTIVE`, `SUPERSEDED`, `ANSWERED`, `EXPIRED`, `CANCELLED`), handoff state (`OPENED_EXTERNAL` only), reply + reply history. |
| `replyLinks/{sha256(token)}` | Worker only, clients denied | Maps a random 256-bit token to one proposal + one recipient role. The raw token is never stored. |
| `operations` new types | Worker | `PROPOSAL_REPLY`, `SEND_PROPOSAL`, `AWAITING_REPLY`, `VIEWING_CONFIRM`, `VIEWING_RESULT`, `JOURNEY_FOLLOW_UP`, plus existing `MATCH_REVIEW`, `MISSING_DATA`, `DEAL_ACTION`. Dedup key `JOURNEY|office|journey|action|ref`. |
| `matches/{id}` new fields | Worker | `brokerDecision` (`APPROVED`/`REJECTED`/`POSTPONED`), `journeyId`, decision time/by. |

Rules: `journeys`, `journeys/*/events`, `proposals` = member read, no client writes;
`replyLinks` = no client access at all. Migration: none required; journeys are created
on approval. Legacy approved matches get a journey the first time they are approved in
the new flow. Rollback = redeploy the previous Staging commit; new collections are
simply ignored by the old shell.

## 4. Behaviour decisions

- Reply links: token in the URL fragment (`/r#token`, never sent to Hosting or link
  previewers). Valid until the proposal is superseded/answered-and-closed or expires
  (default 7 days; viewing proposals: until 2 h after the proposed time, max 7 days).
  The recipient may change a reply until the broker acts on it; every change is a new
  event. Replies are marked "initial" — the page states that commitments are confirmed
  with the broker. Same submission id or same option again → no duplicate.
- WhatsApp: the system prepares text + `wa.me` URL; pressing the button records
  `OPENED_EXTERNAL` only. No sent/delivered/read claims.
- Deal completion: explicit action; allowed for office managers, or for the assigned
  broker only when `officeSettings/deals.brokerMayClose == true`.
- Assignment: office-link submissions go to `officeSettings/assignment.defaultBrokerId`
  or the office owner; tasks inherit the record/journey `assignedBrokerId`; managers see
  all tasks, brokers see their own and unassigned ones.
- AI: Gemini (staging key) suggests a next step / short summary from the office's own
  journey data; labelled as a suggestion; any failure falls back to the rule-based
  suggestion and never blocks an action.

## 5. Verification

1. `node --test` for new domain + Worker modules (in-memory Firestore fake).
2. Existing suite: no new failures versus the baseline.
3. Local end-to-end in Chromium against the real Worker modules on an in-memory store:
   office link → offer + request → match → review task → approve → WhatsApp proposal →
   reply via link → task update → viewing → result → close; plus duplicate clicks,
   superseded link, office isolation, optional area, delete/archive, mobile RTL.
4. PR to `codex/unified-staging-lineage-2026-08-29`. Live Staging verification happens
   after merge (the deploy workflow holds the credentials; none exist in this session).

## 6. Delivery record

Delivered on this branch (see the PR for the full list):

- New shell `public/index.html` + `public/os/*` (two sections, Daily Tasks, repository,
  record form/detail with manual search, match review, opportunity workspace, WhatsApp
  composer, manager settings, login, public office page) and `public/r.html` reply page.
- Worker `/os/*` API in `worker/src/office-os/*`, hooked once in `worker/src/index.js`
  (before the outbound-send guard). Existing endpoints unchanged except: office-link
  intake assigns the default broker; `persistScoredMatch` skips pairs with an open
  journey; tasks gain `offerId`/`requestId`/`journeyId`.
- Old shell kept verbatim as `public/legacy.html`; legacy deep links forward there; 41
  legacy-shell tests repointed from `index.html` to `legacy.html`.

How to verify locally:

```bash
node --test test/office-os-domain.test.mjs test/office-os-journey.test.mjs
node scripts/qa/office-os/journey.e2e.mjs      # real Chromium, writes qa/office-os/*
node scripts/qa/office-os/server.mjs           # manual preview on http://127.0.0.1:4173
```

The harness runs the real Worker against an in-memory Firestore REST double and a
Firebase compat stub in the browser. It does **not** execute Firestore security rules or
real FCM/WhatsApp delivery; those need the live Staging deploy after merge.
