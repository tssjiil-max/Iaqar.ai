# WhatsApp readiness implementation — 29 October 2026

Status: draft engineering changes, NOT deployed. Coexistence for the user's known number: **UNVERIFIED**.

## Baseline and actual evidence
- PR #288 is an open draft containing a requirements document only.
- Live staging-release.json on 29 October still points to 549d6f05e614e161b6889ce1687abd8b667ee26b (blue office). main contains separate deployment tooling and must not replace the application source.
- This branch starts from the same application tree ad7895013c12b27d710ba86e814df5a9d6712f01. Its draft targets fix/blue-office-staging-20261028, pending PR #286 review.
- Live staging health reports project iaqar-ai-staging, inbound-only, outboundMessaging false. This is not Meta connectivity evidence.
- No authenticated Meta app dashboard is accessible to the agent. App review, configuration eligibility, current number state, token validity, webhook subscription and business verification remain unverified. Do not repeat the failed cloud-browser handoff loop.
- The official Meta implementation documentation fetch returned HTTP 429. Embedded Signup parameters were deliberately left unchanged pending authoritative confirmation of the app's current configuration.

## Implemented
- Channel status derives historical coexistence evidence only from the authoritative phone-to-office mapping, requiring CLOUD_API, CONNECTED, isOnBizApp=true and a link timestamp. An ordinary connected flag, configuration, browser signup event or another tenant's integration cannot establish coexistence.
- UI distinguishes missing configuration, no Meta evidence and historical Meta evidence. It labels requested onboarding mode rather than promising eligibility. No eligibility/unavailability outcome is invented.
- Explicit protection warning: stop if Meta requests account deletion or number migration. Standard mode directs use of an independent/test number; it does not authorize the known number's migration.
- A manager-only staging rehearsal route analyzes four fixed synthetic sale/purchase/rental messages. It makes no Meta calls and no CRM/queue/channel writes; only an audit record. Response explicitly says webhookVerified=false and outboundSent=false. The UI button is hidden unless both deployment environment and Firebase project are staging.
- Fixed a reproduced intake parser defect: leading area or room count was incorrectly used as price; Saudi phone numbers could also be read as money. Five regressions prove price/area/rooms stay separate.

## Reused services, not newly built
The deployed source includes whatsapp-agent-service, whatsapp-agent-transport, public search/matching, mandate and session services. Existing tests cover consent, durable idempotent intake, tenant separation, inventory revalidation, service window, recipient allowlist, economic-mode zero sends, human handoff, price mandate decisions and viewing approval. Existing negotiation remains human-gated; this PR does not implement autonomous counteroffer scheduling, template enrollment or live messaging activation.

## Validation
- New tests were run failing before implementation, then passed.
- npm test: 2350 web tests pass, Worker command passes.
- Firestore emulator: 83 tests pass.
- npm run check passes.
- Playwright wa-readiness.e2e.mjs: 390 and 1280 widths pass; unverified and historical-evidence states rendered, external network blocked.
- No production writes, live-number operations, real outbound sends or paid model calls performed.

## Remaining gates
1. Obtain authenticated Meta dashboard access via a working user-controlled environment; inspect actual app/config roles, domains, review and products.
2. Confirm known-number eligibility only through official Meta evidence. Do not infer it from Business Suite or system-user permissions.
3. Provision or select a separate official test number if needed, after the account owner completes any Meta-required terms/permissions. No test number has been provisioned by this task.
4. Review this draft and PR #286; then deploy both application and Worker to staging with isolated credentials. The current Hosting workflow pins the old source and does not deploy Worker code, so rerunning it alone will NOT publish this feature.
5. Complete signed inbound verification against the test number and the correct office. Internal rehearsal is not that test.
6. Add reviewed bounded autonomous counteroffer policy, concurrency/round/expiry controls and approval versions before enabling negotiation automation. Keep sends disabled until separate explicit authorization.
