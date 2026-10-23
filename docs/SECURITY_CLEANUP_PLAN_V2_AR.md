# iAqar.ai 2.0 — Security & Cleanup (Pilot Plan)
Status: Approved for isolated branch work — 2026-10-23
Branch: `plan/security-cleanup-v2`
Budget: Free tiers only; no billing activation.

## Guardrails
- Never edit, merge to, or deploy from `main` during this phase.
- No destructive database operations. Treat production configuration, credentials, and user records as protected even if current property records are test data.
- No file deletion without dependency inventory, evidence of non-use, reproducible tests, and a rollback method.
- Use local synthetic fixtures, not live Firestore, for tests.
- No paid services or automatic upgrades.

## Inventory / provisional disposition
| Component | Decision | Check required |
| --- | --- | --- |
| Firestore and office-scoped model | Keep, audit | cross-office authorization and field-level writes |
| Cloudflare Worker API | Keep, modularize cautiously | authentication on every route and route inventory |
| Property inventory / requests / deals | Keep | schema and end-to-end tests |
| Matching and follow-ups | Keep, benchmark | false positives and audit trail |
| WhatsApp, R2, push notifications | Keep optional | real use, secrets and free-tier consumption |
| Legacy `/ingest` MacroDroid flow | Candidate for retirement | references, logs, callers, replacement |
| Legacy login / alert paths | Candidate to consolidate | migrations, callers, compatibility |
| Historical scripts and reports | Archive candidate | active CI/deploy references |
| Multiple deploy scripts | Consolidate later | deployment dependency map |

## Work packages in order
### P0 — Inventory and evidence
- Record branch SHA and file tree; catalogue deployed entrypoints, environment variables (names only), Firestore rules, worker routes, CI scripts and data flows.
- Build a route-to-permission matrix and an inventory of legacy references.
- Record evidence for each removal candidate; label uncertain items `hold`.

### P1 — Security tests before edits
- Test unauthenticated, member, manager, owner and platform-admin access.
- Test cross-office reads/writes, role changes, owner transfers, protected financial fields and public intake spam controls.
- Run tests against emulator/mocks only. A role or office ID in request parameters is never sufficient authorization by itself.

### P2 — Non-destructive cleanup
- Isolate inactive legacy modules behind feature flags or routes disabled by default.
- Archive historical documentation; avoid removing active code until callsite search and tests pass.
- Split worker modules incrementally with API compatibility tests and unchanged behavior.

### P3 — One-office acceptance pilot
- Synthetic property -> client request -> deterministic match -> follow-up -> deal closure.
- Record data correctness, match precision, no cross-office leakage, zero unexpected costs.
- Then test at least two separate offices in emulator and verify strict tenant isolation.

## Acceptance gates
1. Baseline tests pass before refactor; regression tests pass after.
2. All protected endpoints require server-verified authorization.
3. Unauthorized cross-office access denied in positive/negative tests.
4. No unexpected production DB writes and no paid resource activation.
5. Demonstrated restore or revert procedure before any later deletion.
6. Human approval required before PR merge, production deployment, or deletion.

## Rollback
Use individual small commits on this branch; revert offending commits. No database migration in this phase.
