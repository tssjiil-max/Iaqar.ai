# IAQAR.AI Decisions

## ADR-0001: Preserve current Firebase/Worker stack

- Status: accepted.
- Decision: keep Firebase Hosting/Auth/Firestore/FCM and the existing worker backend.
- Reason: mandated by the constitution and already wired in the repository.

## ADR-0002: Office Settings opens from visual identity surfaces

- Status: accepted.
- Decision: Office Settings opens from the office logo and the office cover/display image. No visible standalone settings button is used.
- Reason: mandated approved UX.

## ADR-0003: Use `officeNameClaims` for unique office-name enforcement

- Status: accepted.
- Decision: continue using `officeNameClaims/{officeNameKey}` and Firestore transactions for uniqueness.
- Phase 1 change: rules now distinguish claim creation from update and prevent an existing claim from being transferred to another office.

## ADR-0004: Extend existing office media endpoint for Phase 1 images

- Status: accepted.
- Decision: reuse `/media/office-cover` with a constrained `X-Media-Kind` value: `logo`, `cover`, or `whatsapp-cover`.
- Reason: avoids introducing a new storage architecture while preserving backend authorization and file validation.

## ADR-0005: Store notification preferences and cooperation mode on the office document

- Status: accepted.
- Decision: save Phase 1 preferences on `offices/{officeId}`.
- Reason: preferences are office-scoped and must not be exposed through public office metadata.

## ADR-0006: Do not implement Phase 2+ workflows in Phase 1

- Status: accepted.
- Decision: show a Phase 1 Opportunity Bank entry with private read-only preview only; do not implement full bank management, unified intake, matching, operations, cooperation workflows, or message adapters in this run.
- Reason: current execution order explicitly stops after Phase 1.

## Future decisions needed

- Whether to migrate or contain legacy internal `deals` collection and terminology.
- Approved schema for `operations` as a first-class collection.
- Approved Firestore emulator/security test setup.
- Approved WhatsApp and Telegram production credential/webhook configuration.
