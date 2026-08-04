# IAQAR.AI Project Constitution

Status: approved and mandatory.

IAQAR.AI is an intelligent operating system for real-estate offices and licensed brokers. It is not a public real-estate listings website.

## Non-negotiable product rules

1. The system works in the background. The broker sees only the next required action.
2. Preserve the current stack: Firebase Authentication, Firestore, Firebase Cloud Messaging/PWA behavior, existing worker/backend, existing rules, and approved Arabic RTL mobile-first UI.
3. Every office-scoped record must include `officeId`. Broker-scoped records include `officeId` and `brokerId` where applicable.
4. Frontend hiding is not security. Firestore rules and backend authorization must enforce office isolation.
5. The approved home page contains only:
   - Office Card.
   - Add Opportunity.
   - Operations Center.
6. Do not add a bottom navigation bar, deals page, separate settings button, unapproved widgets, fake operations, unrequested menu items, or unrequested public status labels.
7. Office Settings opens from the office logo or office cover/display image only.
8. Visible Office Data fields are: office name, broker name, license number, city, and mobile number. Do not show email.
9. Office names must be trimmed, normalized, at least four visible characters, unique system-wide, and protected against duplicate races by backend/database enforcement.
10. The Opportunity Bank is private to the current office and is opened from Office Settings through "بنك الفرص". It must not become a permanent fourth home section.
11. Opportunity intake sources are internal ingestion sources, not separate permanent home sections.
12. Do not claim WhatsApp or Telegram production integration is complete without real credentials, webhooks, validation, delivery/error handling, and real integration tests.
13. Default outbound communication is a broker-reviewed Arabic draft. Do not mark fake delivery as sent.
14. Matching, operations, notifications, cooperation, and audit flows must be idempotent, tenant-aware, retry-safe, and auditable.
15. Opportunity ownership never transfers merely because cooperation is enabled.
16. Cooperation contact data is hidden by default and exposed only by explicit approved permissions.
17. Do not implement automatic financial commitments, commission splits, legal responsibility, or contractual division without a separately approved agreement feature.
18. Implement one approved phase at a time. Stop after Phase 1 until owner approval.

## Current execution scope

This run is limited to:

- Phase 0: foundation and audit.
- Phase 1: Office Card and Office Settings.

Phase 2 and later work must not start until the Phase 1 report is approved.
