# IAQAR.AI Project Constitution

Status: Approved and mandatory.

IAQAR.AI is an intelligent operating system for real-estate offices and licensed brokers. It is not a public real-estate listings site.

## Non-negotiable product rules

1. Preserve the current stack and infrastructure: Firebase Authentication, Firestore, Firebase Cloud Messaging/PWA support, Firebase Hosting, Firestore Security Rules, and the existing Cloudflare Worker backend.
2. Preserve the approved Arabic RTL, mobile-first interface: white background, light green accents, dark green headings, rounded cards, soft shadows, and simple spacing.
3. The broker sees only the next required action. Internal ingestion, analysis, matching, and routing must run in the background.
4. The approved home page contains only:
   - Office Card.
   - Add Opportunity.
   - Operations Center.
5. Do not add a bottom navigation bar, deals page, separate settings button, unapproved dashboard widgets, static demo operations, unrequested menu items, or unrequested opportunity status labels.
6. Office Settings open only from the office logo or the office cover/display image. There is no visible standalone settings button.
7. Every office-scoped record must include `officeId`; broker-scoped records include `brokerId` and `officeId` where applicable.
8. Frontend hiding is not security. Tenant isolation must be enforced by Firestore Security Rules and backend authorization.
9. Cross-office access is allowed only through explicit approved cooperation records and must expose minimum necessary data.
10. Owner/customer contact information remains hidden from cooperating brokers until approved permissions allow disclosure.
11. Office name uniqueness is global, normalized, and backend/database enforced. Office URL handles/slugs are separate stable identifiers when needed.
12. External integrations must be labeled honestly. Mock/simulated WhatsApp or Telegram behavior must not be presented as production connected.
13. Outbound owner/customer messaging is draft-first by default; do not mark messages sent without a real send action or confirmed external response.
14. Matching, operations, notifications, cooperation, and message workflows must be idempotent and tenant-aware.
15. No production path may depend on fake data. A feature is working only when connected, persisted, access-controlled, tested, and accepted.

## Execution rule

Implement one approved phase at a time. After each phase, run tests/build checks, report changed files, acceptance criteria, and limitations, then stop for owner approval before the next phase.
