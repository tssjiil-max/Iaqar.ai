# IAQAR.AI Acceptance Tests

These scenarios are mandatory. A scenario is PASS only after its connected path, persistence, authorization, and observable result are verified. “Implemented” and “not in the current phase” are not PASS.

## 1. Office Settings access

Given the authenticated home page, clicking the office logo opens Office Settings. Clicking the office cover/display image also opens it. Both targets support keyboard activation and focus feedback. No visible standalone Settings button exists.

## 2. No bottom navigation

The approved home page contains no bottom navigation bar.

## 3. Office name validation

- A name with fewer than four visible characters is rejected.
- A whitespace-only name is rejected.
- Arabic and Latin names are supported.
- An equivalent normalized duplicate is rejected.
- A unique name is accepted.
- Concurrent claims for the same normalized key produce exactly one owner.
- Validation is enforced through a database/backend claim, not frontend code alone.

## 4. Office privacy

Office A cannot read, list/query, modify, or download private Office B data. Public profile assets remain limited to intentional branding. Firestore Rules and Worker authorization enforce tenant boundaries.

## 5. Opportunity intake

A URL or copied text can be submitted through one compact field. A supported attachment can be selected through the paperclip. One Opportunity is created or updated.

## 6. No match

A valid Opportunity without a match is stored in the current office's Opportunity Bank. No Operation is created merely because it was stored.

## 7. Automatic rematch

Given a stored offer, creating a compatible request triggers matching without a manual broker action.

## 8. Exactly one match

A compatible pair creates exactly one current Match for the same matching/data version. Repeated processing creates no duplicate.

## 9. Operation creation

An actionable Match creates exactly one Operation for the correct office and assigned broker when applicable.

## 10. Notification

An actionable Match creates a notification for the correct office/broker according to persisted preferences and links to its Operation. Duplicate processing creates no duplicate notification.

## 11. Cooperation ownership

Sharing an Opportunity preserves the originating office and broker. The cooperating party receives only explicitly permitted fields and contacts remain hidden by default.

## 12. Cooperation revocation

Revocation removes future cooperating access according to policy and records who revoked it and when.

## 13. Message draft

A Match or communication Operation generates a short Arabic WhatsApp or Telegram draft. It remains a draft until a real send action/callback confirms another state.

## 14. No Deals page

There is no separate Deals/الصفقات page or bottom-navigation item. Internal legacy deal state may continue to exist.

## 15. Production honesty

Mock adapters/fixtures are clearly separated from production adapters. No mock response is displayed or stored as real WhatsApp/Telegram delivery success.

## Phase mapping

| Test | Planned phase |
|---|---|
| 1–4, 14 | Phase 1 / security regression |
| 5 | Phase 2 |
| 6 | Phases 2–3 |
| 7–8 | Phase 4 |
| 9–10 | Phase 5 |
| 11–12 | Phase 6 |
| 13, 15 | Phase 7 |
| Full cross-browser/mobile/PWA suite | Phase 8 |

The current phase report in `IMPLEMENTATION_PLAN.md` records executed evidence and PASS/FAIL status.
