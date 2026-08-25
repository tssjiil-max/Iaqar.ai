# Live Staging Core Flow

**CORE FLOW NOT YET VERIFIED**

Hosting: `https://iaqar-ai-staging--staging-9c4b0k7h.web.app`  
Worker: `https://iaqar-intake-staging.iaqar-ai.workers.dev`  
Deployed hosting: `b8f91d8` (`cursor/office-collaboration-workflow-c864`, 2026-08-25T04:45:23Z)  
Authoritative headless run: `livee2e_mt8frf5y`  
Headed run: `livee2e_mt8fu4dr` (same journey; district save flaked on the overlay save button)

No mocks. No QA harness. No unit-test PASS reused as E2E.

## Final table

| Test | Unit | Live E2E | Persistence after reload | Evidence |
|---|---|---|---|---|
| District save | PASS — UNIT ONLY | PASS — LIVE E2E | PASS — LIVE E2E | `POST /opportunity/patch` 200; Firestore `district=العزيزية_livee2e_mt8frf5y`; UI after reload |
| Last field → قيد المطابقة | PASS — UNIT ONLY | PASS — LIVE E2E | PASS — LIVE E2E | status `needs_completion` → `matching` without reload; still `matching` after reload |
| Client interested | PASS — UNIT ONLY | FAIL — LIVE E2E | PASS — LIVE E2E | `POST /party/sessions/:token/reply` 200; `replyAction=interested`; reload keeps مهتم. Follow-up **أريد معاينة** / **المعلومات والصور كافية** did **not** render on this hosting SHA |
| Owner available | PASS — UNIT ONLY | PASS — LIVE E2E | PASS — LIVE E2E | independent owner context; `POST .../reply` 200; reload keeps **العقار متاح** |
| Same taskId | PASS — UNIT ONLY | PASS — LIVE E2E | PASS — LIVE E2E | `match_livee2e_mt8frf5y` before client, after client, after owner |
| Broker receives client update | PASS — UNIT ONLY | FAIL — LIVE E2E | FAIL — LIVE E2E | match `livingStage` stayed `MATCH_FOUND`; no **العميل مهتم** timeline on the broker card |
| Broker receives owner update | PASS — UNIT ONLY | FAIL — LIVE E2E | FAIL — LIVE E2E | same; no **المالك أكد توفر العقار** |
| Cooperation data | PASS — UNIT ONLY | FAIL — LIVE E2E | NOT RUN | seeded `COOPERATION_MATCH` never appeared in live Daily Tasks |
| Live console / network | — | PASS — LIVE E2E | — | no unexpected pageerror/console.error on the critical Worker calls |

## Six success conditions

| # | Condition | Result |
|---|---|---|
| 1 | Save + Firestore + Reload | PASS — LIVE E2E |
| 2 | Real list move | PASS — LIVE E2E |
| 3 | Real Client Party HTTP | HTTP 200 + session persist PASS; required next-stage buttons FAIL on deployed SHA |
| 4 | Real Owner Party HTTP | PASS — LIVE E2E |
| 5 | Real Broker sync | FAIL — LIVE E2E |
| 6 | Real same task persistence | PASS — LIVE E2E |

Because 3 (full client next-stage) and 5 failed: **CORE FLOW NOT YET VERIFIED**. STOP for review. No merge. No production deploy.

## Why broker sync failed on live Staging

Hosting SHA `b8f91d8` maps every living match to **مطابقة جديدة**. The deployed party reply handler writes the party session only; it does **not** stamp `matches.livingStage` or a living timeline. After مهتم and العقار متاح, Firestore still had `livingStage=MATCH_FOUND`.

## taskId evidence

```
before client:  match_livee2e_mt8frf5y
after client:   match_livee2e_mt8frf5y
after owner:    match_livee2e_mt8frf5y
```

## HTTP evidence (headless `livee2e_mt8frf5y`)

- `POST .../opportunity/patch` 200 — district persisted, `matchingReadiness=READY_FOR_MATCHING`
- `POST .../party/sessions` 200 — client token minted
- `POST .../party/sessions/:token/reply` 200 — `replied: true`, `replyLabel: مهتم`, `actions: []`
- `POST .../party/sessions` 200 — owner token minted
- owner reply 200 — `العقار متاح` remained after reload
