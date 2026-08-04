# IAQAR.AI Acceptance Tests

Status values are `PASS`, `FAIL`, `PARTIAL`, or `NOT RUN`. Passing code-contract tests does not substitute for a live Firebase/R2/FCM integration test.

## 1. Office Settings access

Given the authenticated home page, clicking either the office logo or office display image opens Office Settings. Both controls are keyboard-accessible. No visible standalone Settings button exists.

Phase: 1.

## 2. No bottom navigation

The approved home has no bottom navigation bar.

Phase: 1.

## 3. Office-name validation

- Fewer than four visible characters is rejected.
- Equivalent normalized duplicate names are rejected.
- A unique name is accepted.
- Concurrent reservations cannot produce duplicate names.

Frontend checks are insufficient by themselves; `POST /office/settings` and an atomic Firestore claim transaction enforce the rule.

Phase: 1.

## 4. Office privacy

Office A cannot read, query, modify, or download Office B private records or media-management endpoints. Public office projections expose only approved public fields.

Phase: 1 and repeated in Phase 8.

## 5. Opportunity intake

One compact field accepts URL or text; the paperclip accepts supported attachments; one Opportunity is created or updated.

Phase: 2. Not implemented in Phase 1.

## 6. No match

A valid no-match Opportunity is saved in the current office bank and does not create an Operation merely for being saved.

Phase: 2–4.

## 7. Automatic rematch

Creating a compatible later counterpart automatically requests matching without a broker rematch action.

Phase: 4.

## 8. Exactly one Match

Repeated processing of the same pair and matching/data version creates exactly one current Match.

Phase: 4.

## 9. Operation creation

One actionable Match creates exactly one Operation for the correct office and assigned broker.

Phase: 5.

## 10. Notification

An actionable Match creates a notification linked to its Operation, routed to the correct office/broker, and filtered by saved preferences.

Phase: 5. Phase 1 stores/enforces the preference categories on existing push paths.

## 11. Cooperation ownership

Sharing preserves originating office/broker ownership; the cooperating broker receives only approved minimum access.

Phase: 6.

## 12. Cooperation revocation

Revocation removes future cooperating-party access according to policy while preserving audit history.

Phase: 6.

## 13. Message draft

A Match or communication Operation can generate an Arabic WhatsApp/Telegram draft. It is not marked sent without a real send action or confirmed external response.

Phase: 7.

## 14. No Deals page

There is no separate Deals page or bottom-navigation item. Internal completion states may remain in relevant records.

Phase: 1.

## 15. Production honesty

Mock adapters and deterministic fixtures are visibly separate from production integration state. No fake WhatsApp/Telegram delivery success is shown.

Phase: all phases.

## Phase 1 automated contract coverage

`worker/test/phase1.test.mjs` verifies:

- normalized Arabic/Latin office-name behavior and minimum length
- backend default notification/cooperation values
- office-scoped image keys
- two accessible Office Settings triggers and no visible standalone Settings control
- five approved office-data inputs and no settings email input
- three visual identity inputs/crop controls
- link copy/share/preview/QR controls
- six notification categories, Opportunity Bank entry, and cooperation modes
- no bottom navigation, Deals home card, or static demo operations
- Firestore rules for protected ownership/name/public projection and backend-only claims
- Worker routes for settings and office images

Live tests still required before production declaration:

- real concurrent Firestore name-claim race
- authenticated cross-office Firestore and Worker denial
- real R2 upload/delete
- browser crop, keyboard/focus, copy/share/QR, and mobile behavior
- actual FCM delivery under every preference category
