# IAQAR.AI Acceptance Tests

## Master scenarios

| ID | Scenario | Current phase status |
| --- | --- | --- |
| 1 | Office Settings opens from logo and cover; no separate settings button | Phase 1 covered by static test; browser E2E still needed |
| 2 | Approved home page has no bottom navigation bar | Phase 1 covered by static test |
| 3 | Office name validation rejects <4 chars, rejects normalized duplicates, accepts unique name, backend/database prevents race duplicates | Phase 1 partial: client validation/rules/transaction present; emulator race test still needed |
| 4 | Office A cannot read/query/modify/download Office B data | Existing rules/backend partial; rules emulator tests missing |
| 5 | Unified opportunity intake for URL/text/attachment creates or updates one Opportunity | Phase 2 not started |
| 6 | No-match opportunity is saved to current office Opportunity Bank without operation | Phase 3/4 not completed |
| 7 | Automatic rematch after compatible request | Existing matching path partial; full acceptance pending Phase 4 |
| 8 | Exactly one current Match for same pair/version under repeated events | Existing worker matching dedupe partial; full acceptance pending Phase 4 |
| 9 | Actionable Match creates exactly one Operations Center item | Existing operations path partial; full acceptance pending Phase 5 |
| 10 | Actionable Match creates notification according to preferences | Existing FCM partial; Phase 1 stores preferences; routing tests pending Phase 5 |
| 11 | Cooperation preserves ownership and exposes approved access only | Phase 6 not started |
| 12 | Revoked cooperation removes future access | Phase 6 not started |
| 13 | Match/communication operation generates Arabic WhatsApp/Telegram draft, not sent until real send/confirmation | Phase 7 not started; manual WhatsApp drafts exist in workflow |
| 14 | No separate Deals page or bottom navigation item | Phase 1 covered by static test for visible tab/PWA shortcut |
| 15 | Mock integrations are separated; no fake WhatsApp/Telegram success | Existing worker blocks outbound; production credentials unknown |

## Phase 1 automated checks added

`test/phase1-ui.test.mjs` checks:

- Logo and cover are settings triggers.
- No legacy visible settings button ID.
- No deals tab, PWA deals shortcut, or bottom-nav marker.
- Static demo operations are removed.
- Office Settings contains logo, cover, WhatsApp-style cover, link copy/share/preview, QR, notification preferences, Opportunity Bank entry, and cooperation mode.
- Email is absent and WhatsApp field is hidden.
- Office name minimum length is enforced in client and rules.
- Worker supports logo/cover/WhatsApp-cover media roles.
