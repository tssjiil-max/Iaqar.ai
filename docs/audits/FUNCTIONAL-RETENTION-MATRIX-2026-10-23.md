# iAqar — Functional retention / merge / cleanup matrix
Date: 2026-10-23
Branch: maintenance/repository-audit-20261023
Status: evidence-backed review; NO deletions or production updates.

## Verification of safe-code-audit workflow
- File found at .github/workflows/safe-code-audit.yml on maintenance branch.
- Workflow grants contents: read, does not have deployment steps or production secrets, invokes node --check and node --test for worker.
- Linked PR-triggered workflow-run lookups for commit be585aa63fd175bc4fdd7f81e400c0177332983a and 2807d5db7e8d86e393231481cbc71e5f3692ed41 returned no runs. The connector method checks only PR-triggered runs, so this is NOT proof no push runs exist; success is unverified.
- Workflow has no schedule and is not on main. No continuous schedule claimed.
- Next validation: publish test workflow on an eligible test branch, inspect GitHub Actions run via UI/Actions API (with authorized permissions), ensure worker unit tests pass. Do not switch on automated deployment.

## Git comparisons
| Base -> head | Result | File records | Key evidence |
|---|---|---:|---|
| structural-unification -> central-search | ahead 2 / behind 0 | 5 | central search domain/service, routes and tests |
| central-search -> public-search | ahead 1 / behind 0 | 13 | public search views, routes, Firestore, tests |
| public-search -> economic-whatsapp-test | ahead 7 / behind 0 | 14 | WhatsApp pipeline, transport, webhook, tests |
| public-search -> mobile-interior-refinement | ahead 45 / behind 0 | 95 | many UI, admin and site styling changes |
| economic-whatsapp-test -> mobile-interior-refinement | diverged: ahead 43 / behind 5 | 95 | divergent feature history; manual reconciliation necessary |

These are commit comparisons; no runtime verification.

## Decision matrix
| Component | Evidence | Decision | Condition before merge / cleanup |
|---|---|---|---|
| Iaqar.ai main Firebase/Worker baseline | firebase.json, worker/package.json, wrangler.toml, firestore.rules | RETAIN | Verify backup and production linkage |
| Firestore tenant isolation | security rules exist | RETAIN, SECURITY REVIEW | cross-office authorization tests |
| Central search | central-search branch + tests | EVALUATE FOR MERGE | run isolated tests, security review |
| Public search | public-search branch + tests | EVALUATE FOR MERGE | legal publication controls, rules and public access tests |
| Economic WhatsApp pipeline | economic-whatsapp-test branch + tests | DEFER MERGE pending review | opt-in, data handling, transport security and webhook tests |
| Mobile and interior UX | mobile-interior-refinement branch | EVALUATE FOR MERGE | visual regression and accessibility tests |
| iaqar-one Vercel configuration | vercel.json disables git deployment | RETAIN SEPARATELY PENDING INVENTORY | confirm no running production dependency |
| BrokerRadar-Android | Android Gradle project | RETAIN SEPARATELY | build/test and data-consent review |
| Old backup/staging/chatgpt branches | many branches detected | RETAIN | no branch deletion during current stage |
| README / docs / audit files | repository docs | RETAIN; CLASSIFY later | explicit duplication evidence |

## Safe next actions
1. Verify test executions through an Actions runs source; do not interpret empty PR-only queries as failed tests.
2. Examine service tests and CI configurations in candidate feature branches.
3. Establish release baseline and backup manifest.
4. Create narrowly scoped changes in maintenance branch, run tests and record output.
5. Require explicit approval before any main merge, publication or destructive cleanup.
