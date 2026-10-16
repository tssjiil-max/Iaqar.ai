# WhatsApp economic test mode (Staging only)

This change is stacked on draft PR #238 and does **not** activate WhatsApp Cloud API or prove coexistence.

Set `ECONOMIC_TEST_MODE=enabled` on the **staging Worker only** alongside the existing pilot-office gates documented in `docs/whatsapp/CLAUDE_PIPELINE.md`. In this mode:
- The classifier uses deterministic Arabic keyword rules, returns `simulated:true`, and makes no Anthropic network call. This is **not** equivalent to Claude and does not understand arbitrary free text.
- The WhatsApp service skips Claude attempt/token accounting and **always** records an outbound reply as `SIMULATED`, even if `WHATSAPP_AGENT_SEND=enabled`.
- Incoming events still require valid Meta signatures and the existing office ownership, allowlist, consent, coexistence, and webhook controls. Without real Meta connectivity, use local signed webhook fixtures.
- Offer messages, sensitive financial/contract instructions, and unsupported media still go to human review through the existing flow. Do not use simulation output to promise property availability.
- Do not add Anthropic credentials, buy credits, change Meta registration, enable production, or send real customer messages.

## Validation
Run `node --test test/whatsapp-economic-mode.test.mjs test/whatsapp-claude-pipeline.test.mjs test/whatsapp-webhook-runtime.test.mjs`, then `npm test` and `npm run check` on a full checkout. These checks have **not** been executed in this GitHub-editing session; results must be reported after running them. The new test file checks offline classification and human escalation. Before staging activation, test the full Worker pipeline in economic mode and verify no outbound Meta requests or Anthropic calls occur.

## Rollback
Unset `ECONOMIC_TEST_MODE` to restore the original Claude-dependent behavior; keep the WhatsApp agent disabled until explicit authorization. No production changes.
