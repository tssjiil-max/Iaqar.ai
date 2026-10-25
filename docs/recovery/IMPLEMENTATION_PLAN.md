# Claude recovery integration plan — 2026-10-25

Goal: recover implemented work onto the verified Firebase Staging source without redesign or deployment.
Architecture: dependency-selected patches, one independently tested recovery commit per behavior. Existing engines and office isolation remain authoritative.
Tech stack: JavaScript ES modules, Firebase/Auth/Firestore, Cloudflare Worker, Node tests, Playwright, Firestore emulator.
Spec: owner task in this session, 2026-10-25.

## Verified references
- Candidate October 19: e23b3ae2580275b67492f5fb103b9cbe26e39a5e (preserved locally).
- Approved channel: https://iaqar-ai-staging--staging-9c4b0k7h.web.app
- Its version.json: 351e7c32b611c9cdd30f61d4fa714af31ddbd136, deployed 2026-10-24T17:44:01.199Z.
- index.html, runtime-config.js and guest-search.css fetched read-only and byte-identical to this commit.
- Project root URL serves e17a7e5 from August; it is not the approved channel.
- Baseline therefore 351e7c3, preserved as recovery/staging-20261024-351e7c3.

## Constraints
No full branch merge, destructive git command, source deletion, production/staging deployment, database writes, published rules change, redesign or customer data. Existing deployed fixes are retained, not duplicated. All new index flags remain off.

## Tasks (execute in this session)
- [x] Inventory all fetched refs and date-range commits; compare deployed source and candidate.
- [x] Scout stable identity / atomic lease: replay source regression on baseline, apply minimal source patch, rerun, commit.
- [x] Scout push deadlines / persistent outbox / bounded retry: reproduce regression, port dependency patches, run scout tests, commit.
- [x] Matching pagination: run imported regression against old reader, port reader and existing notices, test isolation and ceiling, commit.
- [x] Index retrieval and conditional writes: import original tests, establish red, port disabled-by-default feature with local rules only; test mutation cases and concurrent edits, commit.
- [x] Manual rules tool: reproduce red, port safe manual tool and tests; never execute its deploy action, commit.
- [x] Preserve future architecture as explicitly unimplemented documentation. Classify city-form changes separately because they alter protected form UI.
- [x] Run broad tests, emulator and browser journeys; compare baseline/integration screenshots and static visual asset hashes.
- [ ] Record files, evidence, existing capabilities, gaps and deployment instructions. Push new integration/ref branches only and open draft PR after checking workflow triggers.

## Review focus
Office/user switches; overlapping jobs; edits during index backfill; scan ceilings; no accidental published rules or UI changes. Tests must exercise these, not only source strings.
