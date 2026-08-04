# IAQAR.AI Architecture Decisions

## ADR-001 — Preserve the deployed stack

Status: approved.

Keep the static Arabic RTL PWA, Firebase Auth/Firestore/FCM, Cloudflare Worker, and R2. No Next.js, alternate database, hosting migration, or new state-management system is introduced.

## ADR-002 — Backend-owned office-name and handle claims

Status: accepted in Phase 1.

Office-name normalization must not be trusted to the browser. `POST /office/settings` normalizes names and atomically updates `officeNameClaims` with the office profile and public projection. `officeHandles` provides a stable, uniquely claimed route. Client rules deny claim/public-projection writes and direct office-name changes.

## ADR-003 — Preserve existing specialty data without exposing unapproved office-data fields

Status: accepted in Phase 1.

Existing `specialties` values remain stored and appear as the approved services summary on the Office Card. The Phase 1 office-data form exposes only office name, broker name, license number, city, and mobile number.

## ADR-004 — R2 remains the visual identity store

Status: accepted in Phase 1.

Logo, display image, and wide cover use manager-authorized office-scoped R2 keys. The existing cover route remains as a compatibility alias. The wide-cover crop ratio is a design configuration (`window.IAQAR_DESIGN_SETTINGS.officeWideCoverRatio`) rather than an asserted external-platform dimension.

## ADR-005 — Notification category preferences augment, not replace, FCM

Status: accepted in Phase 1.

The six office preferences are stored on the office profile and checked by the existing Worker send path. Existing FCM device registration, service worker, and in-app Operations behavior remain.

## ADR-006 — Cooperation mode is configuration only in Phase 1

Status: accepted.

The office mode defaults to `APPROVAL_REQUIRED`. No cross-office permission, automatic sharing, contact disclosure, or invented broker performance score is implemented before Phase 6.

## ADR-007 — Opportunity Bank scope in Phase 1

Status: accepted.

Phase 1 adds the Settings entry and an authenticated, office-scoped, read-only shell so the entry is connected and does not show a fake empty state. Editing, archive/delete policy, sharing, scoped bank access, and cooperation permissions remain Phase 3/6 work.

## ADR-008 — Remove production demo Operations and separate Deals surface

Status: accepted in Phase 1.

The home starts from a genuine empty Operations state until authoritative listeners return records. The separate Deals card/filter is removed. Historical deal records and workflow code remain internal for compatibility and require a later migration plan.

## ADR-009 — No external crop dependency

Status: accepted in Phase 1.

The browser Canvas API implements deterministic focal-position and zoom cropping. This avoids adding a UI framework/dependency and keeps image output under the existing upload contract.

## ADR-010 — Future event processing

Status: approved target, not implemented.

Use an idempotent Firestore-backed outbox/background-job pattern when asynchronous extraction/rematching requires durability. A large external message broker requires explicit approval.

## Open decisions

- Exact archive versus hard-delete policy and retention period for Opportunities.
- The approved scopes/filters for whole-bank sharing.
- Contact-release permissions and timing during cooperation.
- External completion-link lifetime and revocation policy.
- Production extraction/transcription providers and data-processing terms.
- WhatsApp/Telegram outbound sending policy beyond broker-reviewed drafts.

These items must not be guessed in implementation.
