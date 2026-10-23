# iAqar repository audit — 2026-10-23

## Scope and safety
Read-only GitHub comparisons; no deletion, production deployment, or code merge. Preserve all repositories and existing backup branches.

## Confirmed comparison against main
| Branch | Git status | Ahead | Behind |
|---|---|---:|---:|
| chatgpt/central-search-20261016 | diverged | 1040 | 3 |
| chatgpt/public-search-20261016 | diverged | 1041 | 3 |
| chatgpt/structural-unification-20261016 | diverged | 1038 | 3 |
| chatgpt/economic-whatsapp-test-20261017 | diverged | 1048 | 3 |
| chatgpt/mobile-interior-refinement-20261017 | diverged | 1086 | 3 |
| baseline/golden-journey-2026-08-28 | diverged | 319 | 3 |
| maintenance/repository-audit-20261023 | identical (at time of comparison) | 0 | 0 |

Caution: ahead/behind counts are Git commits, not functional feature counts. The compare endpoint returned at most 300 file records in several large differences, so that list is insufficient as a complete inventory.

## Targeted comparisons
- central-search -> public-search: public-search ahead by 1 commit; 13 changed file records, including public-search views, worker routes/services, Firestore rules and tests.
- structural-unification -> economic-whatsapp-test: economic-whatsapp-test ahead by 10 commits; 26 changed file records, including WhatsApp test docs and tests.
- economic-whatsapp-test -> mobile-interior-refinement: branches diverged, mobile branch ahead 43 / behind 5; 95 file records. Do not merge blindly.

## Findings and next gate
1. Determine authoritative functional baseline by examining CI/test runs, release workflows and deploy references, not branch name alone.
2. Compare candidate branches against each other for unmerged work. Inspect security-sensitive diffs manually.
3. Validate worker unit tests, Firestore rules, UI tests and Android build in a reproducible isolated environment.
4. Produce a per-component retain/merge/defer matrix and documented rollback plan before code deletion.
5. Leave main, deployments, databases and all repositories unchanged until verification and explicit release approval.
