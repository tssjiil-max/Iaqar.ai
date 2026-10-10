# External cooperating broker — verification

Base: codex/unified-staging-lineage-2026-08-29 at cbe4995.

- npm test: 2063 tests passed, zero failures or skips.
- npm run check: 706 targets parsed.
- npm run test:rules: real Firestore emulator passes 50 tests including anonymous claims, forged verification rejection, no visitor reads, no foreign-office reads, no new membership and no client-side verification bypass.
- node --test test/external-broker.test.mjs: 13 integration tests through the real Worker and isolated in-memory Firestore REST adapter.
- node scripts/qa/office-os/external-broker.e2e.mjs: real Chromium, 390px mobile, four external sale/rent offer/buy/rent request submissions; saved role and pending status; manager review saved; one phone field; no horizontal overflow or page errors.
- Independent review found incorrect rules placement, external-contact dedup mismatch and stale representation after edits. Each reproduced before correction and passed after.

The negotiation room itself is reused. External participants remain represented by the office: no owner/client proposal or room links are issued for these journeys. Owner/client negotiation regression tests pass.

Identity, license and authority are self-declared until the office reviews evidence. There is no automated FAL verification integration. No financial liability or commission default is created. Existing channel integrations are reused; tests do not claim live Telegram/WhatsApp delivery. Follow-up remains via the office; no new external accounts or public follow-up tokens.

Rollback: revert the additive feature commit. No migration, deletion, change of office links or Production release is included.
