# Match creation integrity — root fix report

Status: **MATCH INTEGRITY VERIFIED — READY FOR STAGING DEPLOY REVIEW**

No Staging Deploy. No Merge. No Production Deploy. STOP.

Office audited: `staging-logo-live-20260807`  
Live QA office: `qa-e2e-dedicated`  
Branch: `cursor/match-creation-integrity-c864`

---

## 1. Root cause of the 45 broken Daily Tasks

The mapper hid 45 `INVALID_TASK_DATA` rows. Those rows were not one bug.

**38 match documents + 7 orphan MATCH_REVIEW operations = 45 mapper rows.**

Dump: `qa/broken-match-dump.json`

### Reason grouping (mapper diagnosis, before repair)

| reason | N |
| --- | ---: |
| missing_requestId | 41 |
| missing_offerId | 41 (same 41 rows as missing_requestId) |
| unresolved_request | 4 |
| unresolved_offer | 4 (same 4 rows) |
| other | 0 |

The 41 “missing IDs” rows are **34 opportunity-vs-opportunity matches + 7 orphan operations** whose match docs are gone. The 4 unresolved rows are intake party-id matches.

This was **not** a persist race as the main cause. Matching ran after records existed. The stored linkage was wrong or incomplete.

---

## 2. Creator path (from stored fields — not guessed)

### Group A — 34 matches — REPAIRABLE

- Path: `findAndSaveMatchesForOpportunity` → `persistScoredMatch` in `worker/src/index.js`
- Collections: `opportunities → opportunities`
- Stored: `opportunityId` + `counterpartOpportunityId` (canonical `opp_*`)
- Empty: `clientRequestId` / `ownerOfferId` / `requestId` / `offerId`
- Canonical REQUEST/OFFER opportunity docs exist (`kind` `client_request` / `owner_offer`)
- Mapper only read `clientRequestId`/`requestId` and `ownerOfferId`/`offerId` → `missing_requestId` + `missing_offerId`

**Root defect:** persist wrote the proven pair on opportunity alias fields and left the Daily Tasks linkage fields blank.

### Group B — 4 matches — UNREPAIRABLE

- Path: `findAndSaveMatches` after public intake (`handlePublicIntakeMatching`) / WhatsApp inbox
- Collections: `owners → clients` or `clients → owners`
- Stored IDs like `cli_intake_intake_cycle_mt3oco8s_req` / `own_intake_intake_cycle_mt3oco8s_offer`
- Canonical `opp_intake_…` documents **do not exist**
- Clients/owners exist with `sourceIntakeId` but no proven `opportunityId` pair

**Root defect:** matching used intake/party record IDs as if they were canonical opportunity IDs. Temporary intake IDs are not a substitute for `opportunityId`.

### Group C — 7 MATCH_REVIEW operations — UNREPAIRABLE

- `matchId` documents are missing (`mat_55174ded…`, `mat_4868da6c…`, `mat_b659e7c6…`, `mat_88ef4e65…`, `mat_83e371eb…`, `mat_9e05657e…`, `mat_1094d534…`)
- Marked `integrityReason=match_document_missing`
- Kept as diagnostic/archive; hidden from Active Daily Tasks

---

## 3. Missing IDs vs race vs temporary intake IDs

| cause | role |
| --- | --- |
| Missing canonical `requestId`/`offerId` on opportunity-vs-opportunity matches | **Primary** for 34/45 |
| Temporary intake / party IDs stored as request/offer | **Primary** for 4/45 |
| Matching before opportunity persist (race) | **Not the historical cause.** Intake already persisted, then matched the **wrong collection**. Prevention still added: confirm GET of canonical opportunity before matching. |
| Orphan operations with deleted match docs | 7/45 |

---

## 4–6. Historical repair

Script: `scripts/repair-historical-matches.mjs --apply`  
Result: `qa/historical-match-repair.json`

Repairable = **34**  
Unrepairable matches = **4**  
Unrepairable orphan operations = **7**

**Backfill method (repairable only):** copy proven `opportunityId` / `counterpartOpportunityId` into `requestId`, `offerId`, `clientRequestId`, `ownerOfferId` after both IDs resolve to canonical REQUEST + OFFER in the same office. Then `integrityStatus=VALID`.

**Not used:** district, price, or text similarity.

Unrepairable matches: `integrityStatus=INVALID` + reason; remain out of Active Daily Tasks.

This was a **Firestore data mutation on staging**, not a Worker/Hosting deploy.

---

## 7. Prevention rule (fail closed at persist)

File: `worker/src/match-integrity-domain.js`  
Gate: `persistScoredMatch` in `worker/src/index.js`

An **active Match is not written** unless:

1. `requestId` exists
2. `offerId` exists
3. `requestId` resolves to a canonical REQUEST opportunity
4. `offerId` resolves to a canonical OFFER opportunity
5. IDs are not temporary (`cli_intake_…`, `own_intake_…`, `intake_cycle_…`, `cli_wa_…`)

On failure:

- `console.warn("[iaqar-match] REJECTED_ACTIVE_MATCH")`
- diagnostic at `offices/{officeId}/matchDiagnostics/{matchId}`
- return `{ skipped: true }`
- **no Task / no MATCH_REVIEW operation**

Intake / WhatsApp now:

`persist opportunity` → GET confirm canonical id → `matchingReadiness` ready → `findAndSaveMatchesForOpportunity` (canonical opportunities only).

`findAndSaveMatches` (clients/owners) is unused by those callers. If invoked, persist still fail-closes.

Success writes `requestId`, `offerId`, `clientRequestId`, `ownerOfferId`, `integrityStatus=VALID`, schemaVersion 7.

UI mapper still hides `INVALID` and temporary IDs (defense in depth, not the only gate).

---

## 8. Live QA (dedicated office, no deploy)

Hosted Worker/Hosting stay on the old SHA. Matching ran **in-process** with the new Worker against staging Firestore. UI used **local `public/`** (this branch) signed into `qa-e2e-dedicated`.

Natural path:

1. Canonical REQUEST persisted (`opp_livee2e_matchint_mt91xfw6_req`)
2. Canonical OFFER persisted (`opp_livee2e_matchint_mt91xfw6_offer`)
3. `/matching/run` created `mat_8e199315a900f885774987f242535b638e9f`

Proven on the match document:

- `requestId` = `opp_livee2e_matchint_mt91xfw6_req`
- `offerId` = `opp_livee2e_matchint_mt91xfw6_offer`
- both resolve
- `integrityStatus=VALID`

Daily Task showed: نوع العقار / الغرض / الحي / السعر / referenceCode `#A-2916`.

Reload (second Playwright pass, same docs): same `matchId`, `requestId`, `offerId`.

An earlier in-process run (`mat_157ef331…` / `mt91neuo`) also created a VALID match; that fixture was cleaned after a hung diagnostics query. UI evidence is the `mt91xfw6` pair still in Firestore.

`NEW QA MATCH: VALID = 1, INVALID = 0`

---

## 9–11. Screenshots / video

- New task with real canonical fields: `match_integrity_qa_task.png`
- عرض البيانات (request 120م² + offer 125م²): `match_integrity_qa_view_data.png`
- عرض التفاصيل الكاملة → same `offerId`, owner phone `0502221842`, مالك مباشر: `match_integrity_qa_offer_details.png`
- Flow video: `match_integrity_qa_daily_task_flow.webm`

Sheet `data-opportunity-id` = `opp_livee2e_matchint_mt91xfw6_offer` (same as `match.offerId`).

---

## Integrity counters

**BEFORE (office `staging-logo-live-20260807`):**

- VALID visible sendable = 0
- INVALID_TASK_DATA = 45
- match `integrityStatus` VALID = 0 (field not written yet)

**AFTER HISTORICAL REPAIR:**

- match docs VALID = 34
- match docs INVALID = 4
- visible sendable Daily Task groups = 12 (grouped by request)
- INVALID_TASK_DATA remaining = 11 (4 unrepairable matches + 7 orphan operations)

**NEW QA MATCH (`qa-e2e-dedicated`):**

- VALID = 1
- INVALID = 0

---

## Tests run

- `npm test --prefix worker` including `match-integrity-domain.test.mjs` — pass
- `test/matching-phase4.test.mjs` — 39 pass
- `test/content-v2-daily-tasks.test.mjs` — pass
- `npm run check` — 355 targets parsed

Full root `npm test` still fails on pre-existing stacked-branch checks (header/voice/import/bank/staging-branch name). Those systems were not changed.

---

## Stop line

**MATCH INTEGRITY VERIFIED — READY FOR STAGING DEPLOY REVIEW**

Do not merge. Do not deploy until this review is approved. Deploying the previous mapper-only branch without this persist + backfill would have emptied Daily Tasks after hiding the 45 broken rows.
