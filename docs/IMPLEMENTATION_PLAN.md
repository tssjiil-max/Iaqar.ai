# IAQAR.AI Implementation Plan

## Current execution scope

Only Phase 0 and Phase 1 are in scope for this run. Do not begin Phase 2 until the project owner approves the Phase 1 report.

## Phase progress

| Phase | Scope | Status |
| --- | --- | --- |
| Phase 0 | Repository audit, architecture/documents/rules | In progress in this branch; governance docs created |
| Phase 1 | Office Card and Office Settings | Implemented in this branch; verification pending |
| Phase 2 | Unified Opportunity Intake | Not started |
| Phase 3 | Opportunity Bank | Not started; Phase 1 only adds a private read-only entry point |
| Phase 4 | Matching Engine | Existing partial implementation; not modified for Phase 4 |
| Phase 5 | Operations Center and Notifications | Existing partial implementation; not modified beyond removing demo/deals UI |
| Phase 6 | Cooperation | Not started; Phase 1 stores office preference only |
| Phase 7 | Smart Messages and adapters | Not started |
| Phase 8 | Hardening | Not started |

## Phase 0 findings

- Stack is Firebase PWA + Firestore + Cloudflare Worker + R2 media + FCM/PWA.
- Worker tests exist and cover parser, matching preview, workflow preview, FCM helpers, media intake, and auth normalization.
- No frontend browser E2E or Firestore Rules emulator tests exist.
- The UI had a visible deals tab/PWA shortcut and static demo operations; these conflicted with the constitution.
- Office Settings existed but needed Phase 1 controls and entry-point changes.

## Phase 1 changes planned/implemented

- Open settings from office logo and cover image.
- Remove visible standalone settings button wording.
- Add visual identity media: logo, display cover, WhatsApp-style cover.
- Implement configurable crop ratios in `office-settings.js`.
- Save office data fields only: office name, broker name, license number, city, mobile number.
- Keep email absent from Office Settings.
- Enforce minimum 4 visible office-name characters.
- Preserve normalized global uniqueness through `officeNameClaims`.
- Add office link copy/share/preview and QR code.
- Add office notification preferences.
- Add Opportunity Bank entry inside settings.
- Add cooperation mode with default approval-required.
- Remove visible deals tab/PWA shortcut and static demo operations.

## Risks and dependencies

- Real upload and Firestore transaction behavior still needs browser testing with authenticated manager credentials.
- Rules race-condition proof should be validated with Firestore emulator tests.
- Opportunity Bank entry is read-only/minimal in Phase 1; full bank behavior belongs to Phase 3.
- Notification preferences are stored but not yet enforced across all notification creation paths; that belongs to Phase 5.
- Cooperation mode is stored but does not create cooperation records or access grants; that belongs to Phase 6.
