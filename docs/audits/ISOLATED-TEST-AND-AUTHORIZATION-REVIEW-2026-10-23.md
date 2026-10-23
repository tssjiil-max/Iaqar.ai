# Isolated test and authorization audit — 2026-10-23

Scope: source inspection of Iaqar.ai main and candidate branches. No secrets used, deployment performed or production data accessed.

## Execution status
- GitHub connector successfully fetched worker/src/index.js, worker/test/worker.test.mjs, firestore.rules, and branch tests for central search, public search and WhatsApp economic mode.
- Local clone attempt failed with DNS failure resolving github.com. The connector available here does not expose an Actions workflow dispatch or comprehensive run listing.
- Consequently no actual Node.js test-suite pass/fail outcome can be claimed. GitHub Actions workflow definition exists on maintenance branch but its successful execution remains unverified.

## Source tests identified
- main: worker/test/worker.test.mjs (Node built-in test runner).
- chatgpt/central-search-20261016: test/office-os-central-search.test.mjs; uses QA office harness.
- chatgpt/public-search-20261016: test/office-os-public-search.test.mjs; seeds public/private records and sensitive contact fields.
- chatgpt/economic-whatsapp-test-20261017: test/whatsapp-economic-mode.test.mjs; economic-mode no-network expectation and human handoff for contracts and price changes.

## Firestore rules — hypotheses requiring emulator tests
1. offices/{officeId}/members/{uid}: allow write if canManage(officeId) without member-field restrictions. Test that manager cannot escalate another user to owner/admin or modify membership beyond intended policy. Severity: critical candidate, not confirmed vulnerability.
2. offices/{officeId}/{collectionName}/{docId}: authenticated member writes to records with matching officeId. Test field-level integrity and intended member-role restrictions; officeId boundary is present.
3. offices/{officeId}/publicIntake/{docId}: public create validation bounds some fields, but no allowed-key schema visible. Test unexpected fields, spam/resource exhaustion and abuse protections at ingestion layer. Severity: high candidate.
4. Nested timeline creates require membership, but do not themselves enforce write payload schema. Test event attribution, immutability and authorization.
5. Guarded devices and whatsapp_accounts collections deny direct client access; preserve tests for both.

## Mandatory isolated test plan
- Run Worker: node --check worker/src/index.js && node --test worker/test/worker.test.mjs from repository root on an isolated checkout.
- Run isolated branch suites with their actual test harnesses and Node version; record full output and SHA per branch.
- Use Firebase Emulator Suite for Firestore deny/allow assertions; never point tests at real Firebase project.
- For WhatsApp, use mocked transports to prove no unapproved outbound activity, webhook authentication, privacy guards and human approval for changes to price/contract.
- Confirm deployment baseline and rollback before any merge.

## Merge gate
BLOCKED pending actual clean test runs, authorization review, and manual reconciliation of diverged branches. Do not delete branches or merge to main.
