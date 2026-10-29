# Embedded Signup access diagnosis — 29 October 2026

## Observed facts
- Historical root-host check (`iaqar-ai-staging.web.app`, path `/staging-release.json`; not the approved user-facing channel) returns sourceSha `549d6f05e614e161b6889ce1687abd8b667ee26b`, project `iaqar-ai-staging`.
- Live staging `/meta/config?officeId=platform` returns enabled=true, appId `976041872203912`, configId `935400705477695`, onboardingMode=coexistence, outboundMessaging=false. These are public identifiers, not evidence of permissions or eligibility.
- Cloudflare's read-only settings API confirms those same public identifiers and the staging Firebase project. Required Meta secret binding names are present; their values were not read or validated.
- PR #288 is requirements only. This fix is stacked on PR #289, which is based on the deployed blue-office source. Main has different frontend source.
- The supplied settings/channels route uses `public/os/core/channels.js`; `public/js/whatsapp-office.js` is the legacy settings adapter. Changing only the legacy adapter would not fix this route.
- No authenticated Meta browser session was available. Official Meta implementation and business-app-onboarding documentation requests returned HTTP 429. Launch parameters/events were consequently left unchanged.

## Root-cause status
`UNKNOWN_META_ERROR`: the user's access-denied screen has no captured official error code and the app dashboard configuration has not been inspected. Do not claim INVALID_CONFIG_ID, missing review, restricted app mode, unsupported configuration version or number ineligibility without evidence.

The reproduced application defects are separate from that external access-denied cause: malformed identifiers accepted as configured, simultaneous signup attempts, loss of official numeric error diagnostics, and accepting an unconfirmed completion response. New failing tests demonstrated these before the fixes.

## Changes
- Share numeric public-identifier validation between channel status, frontend preparation and Worker config. Missing configuration disables actions. This verifies syntax only, not that a configuration belongs to the app.
- Single in-flight frontend signup; release lock on result/error; ignore repeated completion callbacks while completion is pending.
- Permission/domain errors use numeric Meta codes with static Arabic guidance. Other errors remain unknown. Arbitrary Meta messages, token-bearing objects and event labels are not logged or displayed.
- Require connected=true from server before resolving the UI operation successfully.
- Remove raw Meta token-exchange/subscription/phone-state error payloads from logs; scrub unexpected signup request exception messages.
- Existing backend manager authorization and phone-to-office checks remain in place. This change does not claim a new atomic backend reservation mechanism or full cross-request idempotency. That concurrency hardening remains a review gate before live onboarding.

## Safe test and external gate
1. In Meta App Dashboard, open app `976041872203912` → Facebook Login for Business → Configurations → configuration `935400705477695`. Inspect the actual login variation, selected products/business-app onboarding support, app mode/review/access level, business ownership and roles. Confirm the exact allowed SDK domain `iaqar-ai-staging.web.app` and required OAuth settings. Do not change production settings or grant new access during inspection.
2. Record the exact missing setting or official denial code. There is currently no evidence naming a particular missing setting. A system-user role is not evidence of Embedded Signup access.
3. After authoritative configuration validation and deployment review, open one staging preview only. Do not select/verify the known number, scan an onboarding QR, accept permission grants or complete onboarding in this task. Stop at any migration, account deletion or terms screen.
4. Coexistence configuration request exists; app configuration support and known-number eligibility are `UNVERIFIED`. No Meta registration/subscription/message calls were made by this investigation, and neither the known number nor production was changed.

## Release scope
Prepared as a separate draft PR, not deployed. The live hosting workflow pins 549d6f05 and does not publish Worker code. A rerun is not a deployment of this fix. Do not replace main or deploy the stacked PRs as though already reviewed. No Firebase rules or indexes were changed here.

## Validation performed on this change
- Test-first regressions: four frontend cases, Worker malformed identifier case, and disabled channel-action case were observed failing, then passing.
- `npm test`: 2355 web tests pass; the complete Worker script succeeds, including 90 core Worker tests.
- `npm run test:rules`: 83/83 Firestore emulator tests pass, including tenant/manager restrictions. This is local emulator evidence, not live Meta onboarding.
- `wa-readiness.e2e.mjs`: 390px and 1280px pass, no page errors, all external network blocked. These exercise readiness rendering only; no claim of live SDK or live Embedded Signup validation.
- `npm run check` and `git diff --check` executed; see PR validation status for final result.
