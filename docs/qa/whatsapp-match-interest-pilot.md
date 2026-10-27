# WhatsApp match interest pilot

This branch adds a disabled-by-default staging pilot. It does not deploy, enable WhatsApp, or complete the full flexible-office automation specification.

## Behavior

The existing WhatsApp queue sweep prepares separate owner/client questions for eligible current matches. Both explicit button responses must come from the corresponding phone, refer to unchanged records/prices, and follow confirmed delivery. Both interested parties open the existing canonical journey and one follow-up task. Interest is not a final agreement, agreed price, payment, ownership transfer, or completed deal. Telegram is not a dependency of this path.

Existing staging project, office/recipient allowlists, number connection, consent, handoff, opt-out, delivery window and outbox checks remain required. WHATSAPP_MATCH_INTEREST_MODE is off when absent; `simulate` prepares internal questions only, and `enabled` permits the policy-checked outbox. WHATSAPP_AGENT_SEND must independently permit actual delivery. No environment settings are changed by this branch.

## Validation

Local `npm test` and `npm run check` pass. Targeted match-interest and WhatsApp journey suites pass 51 tests, including a mocked two-party inbound/outbound journey, duplicate webhook replay, wrong phone, changed price, decline, uncertain delivery, human takeover and duplicate follow-up prevention. No real customer messages were sent. These are local results, not a claim of GitHub CI or deployed verification.

## Pilot limits and remaining work

The sweep examines at most 25 matches and 25 interest records per office, and at most 300 conversations. It has no advancing pagination and must not be enabled for a general rollout. Add a durable per-match trigger/cursor and test larger offices first. Unreachable, blocked or uncertain deliveries are retained for review rather than automatically resent. Timeout/reminder policy for unanswered interest questions remains to be implemented. Match qualification is currently a score threshold of 75 plus existing integrity, lifecycle and cooperation checks; this is a pilot policy requiring product review.

Real-number coexistence, Meta delivery, reconnect behavior, opt-out races, production activation and end-to-end viewing/negotiation/document completion remain unverified or unimplemented. Continue with staging-only data and mocked delivery until those checks are complete.
