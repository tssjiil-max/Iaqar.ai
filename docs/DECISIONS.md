# IAQAR.AI Architecture Decisions

This is an append-only decision record. New decisions require owner approval when they change product behavior or architecture.

## ADR-001 — Preserve the existing platform stack

Status: approved by constitution.

Firebase Authentication/Firestore/FCM, Firebase Hosting, the static Arabic PWA, Cloudflare Worker, and R2 remain the platform. No framework or database migration is introduced.

## ADR-002 — Global office-name uniqueness uses normalized claim documents

Status: implemented in Phase 1.

`officeNameClaims/{normalizedKey}` is the unique identity. Profile edits claim it in the same Firestore transaction as the office update. The normalized key is shared between browser and Worker and tested against Arabic/Latin equivalence. Broker approval creates the claim with a backend create-if-absent operation.

Display names remain exactly broker-entered after trimming/collapsing whitespace; they are not silently renamed. `publicSlug` is a separate stable URL handle.

## ADR-003 — Office identity media remains in R2

Status: implemented in Phase 1.

The existing R2 storage architecture is preserved. Office branding uses allowlisted tenant-scoped keys and manager-authorized upload/removal. Browser-side crop produces bounded WebP output. Crop ratios and output widths are supplied through one design configuration boundary rather than repeated UI constants.

Public branding is intentionally public. This decision does not authorize public opportunity attachments.

## ADR-004 — Notification category settings are separate office settings

Status: implemented in Phase 1.

Preferences live at `offices/{officeId}/officeSettings/notifications`; FCM device registrations remain Worker-only. Missing preferences default to enabled to preserve existing behavior. Match and follow-up emitters consult the persisted category before creating alerts/push.

Per-broker routing remains a later requirement where operations have an assigned broker.

## ADR-005 — Cooperation defaults to approval and never exposes contacts automatically

Status: implemented in Phase 1 settings only.

The persisted default is `APPROVAL_REQUIRED`. `exposeContactsAutomatically` is fixed to false. Cooperation records, scoped sharing, acceptance, and revocation are Phase 6.

## ADR-006 — Phase 1 provides only the Opportunity Bank entry boundary

Status: implemented.

Phase 1 requires the settings entry; Phase 3 owns record listing, details, edit/archive/delete, and scoped sharing. The entry opens an honest private boundary state and does not fabricate records or reuse the Operations Center as a bank.

## ADR-007 — Remove production-visible mock Operations and Deals navigation

Status: implemented in Phase 1 compliance work.

The Operations Center now starts with its empty state until authoritative office data arrives. Internal legacy `deals` storage/workflow code is preserved, but there is no visible Deals page, card, shortcut, or navigation item.

## ADR-008 — Use Firebase Rules emulator for tenant and uniqueness acceptance

Status: implemented.

The repository adds Node tests using the official Rules test library and the latest Firebase CLI through `npx`. This verifies office isolation, settings scope, minimum name length, unique-name acceptance, and concurrent claim behavior without production writes.

## Deferred decisions

- Exact Opportunity schema migration from existing client/owner/match records: Phase 2.
- Opportunity Bank deletion versus archive retention policy: Phase 3.
- Matching weights, nearby-district rules, and thresholds: Phase 4.
- Operation type catalogue and broker assignment: Phase 5.
- Cooperation permission matrix and post-revocation historical visibility: Phase 6.
- WhatsApp/Telegram outbound approval and delivery policy: Phase 7.

These are not to be guessed before their approved phase.
