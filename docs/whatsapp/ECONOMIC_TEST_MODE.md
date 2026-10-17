# WhatsApp economic test mode (Staging only)

This change is stacked on draft PR #238 and does **not** activate WhatsApp Cloud API or prove coexistence.

Economic mode is **on by default**. It stays on when `ECONOMIC_TEST_MODE` is missing, empty, `enabled`, differently cased or any unknown value; only the exact value `disabled` turns it off. Turning it off lifts this gate alone: Claude still needs `WHATSAPP_AGENT_CLASSIFIER=claude` and its keys, and real delivery still needs `WHATSAPP_AGENT_SEND=enabled`, a Meta token and the pilot-office gates in `docs/whatsapp/CLAUDE_PIPELINE.md`. In this mode:
- The classifier uses deterministic Arabic keyword rules, returns `simulated:true`, and makes no Anthropic network call. This is **not** equivalent to Claude and does not understand arbitrary free text.
- The WhatsApp service skips Claude attempt/token accounting and **always** records an outbound reply as `SIMULATED`, even if `WHATSAPP_AGENT_SEND=enabled` and Anthropic/Meta keys are present. The Meta transport itself also refuses to send (`economic_mode_no_send`), so no caller can bypass the gate.
- Incoming events still require valid Meta signatures and the existing office ownership, allowlist, consent, coexistence, and webhook controls. Without real Meta connectivity, use local signed webhook fixtures.
- Offer messages, sensitive financial/contract instructions, and unsupported media still go to human review through the existing flow. Do not use simulation output to promise property availability.
- Do not add Anthropic credentials, buy credits, change Meta registration, enable production, or send real customer messages.

## Staging deploy
`worker/wrangler.toml` sets `ECONOMIC_TEST_MODE = "enabled"` under `[env.staging.vars]` only. The Staging deploy workflows no longer pass `GEMINI_API_KEY`, and `scripts/deploy-staging.sh` never sets it: after the Worker deploy it deletes any old `GEMINI_API_KEY` and proves it is gone by reading secret **names** only (`wrangler secret list`; values are never read). If the names cannot be read or the key is still there, the deploy stops before any Staging test runs.

## Validation
Run `node --test test/whatsapp-economic-mode.test.mjs test/whatsapp-claude-pipeline.test.mjs test/whatsapp-webhook-runtime.test.mjs`, then `npm test` and `npm run check` on a full checkout. The economic-mode tests check offline classification, human escalation, the fail-safe default for missing/unknown values, and that no Anthropic or Meta request leaves while it is on. Before staging activation, test the full Worker pipeline in economic mode and verify no outbound Meta requests or Anthropic calls occur.

## Rollback
Set `ECONOMIC_TEST_MODE=disabled` (exact value) to leave economic mode; only do so with explicit authorization, and keep the WhatsApp agent disabled until then. Removing the variable keeps economic mode on. No production changes.
