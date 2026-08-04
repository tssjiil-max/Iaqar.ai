# IAQAR.AI Project Constitution

Status: approved and mandatory  
Authority: master engineering directive v1.0  
Product: an operating system for real-estate offices and licensed brokers, not a public listings portal.

## Supreme product rule

> The system works in the background. The broker sees only the next required action.

## Non-negotiable product rules

- Preserve the existing static Arabic RTL PWA, Firebase Authentication, Firestore, FCM, Cloudflare Worker, R2 media storage, security rules, and tests.
- The approved home contains only the Office Card, Add Opportunity, and Operations Center. There is no bottom navigation, separate Deals page, standalone Settings button, or unapproved widget.
- Office Settings opens from the office logo or display image. Its office-data fields are office name, broker name, license number, city, and mobile number; email is not shown there.
- The Opportunity Bank is private and is entered from Office Settings, not added as a permanent fourth home section.
- Every office-scoped record contains `officeId`. A broker-scoped record also contains `brokerId` where applicable.
- Cross-office access requires an explicit approved cooperation record and exposes only the minimum permitted data. Contact information is hidden by default.
- Office names contain at least four visible characters and are globally unique after normalization. Reservation is atomic on the backend/database.
- Cooperation defaults to `APPROVAL_REQUIRED`. Automatic cooperation never reveals private contact information automatically.
- A source is retained and normalized into one Opportunity. Broker-confirmed values take precedence over extracted or AI-generated guesses.
- Opportunities with no match are saved silently in the office bank. They do not create Operations merely because they were saved.
- Matching and event processing are tenant-aware, idempotent, retry-safe, auditable, and automatically re-run after relevant changes.
- The Operations Center contains actionable work only. Static demo operations, technical queues, parser logs, and non-actionable calculations are prohibited in production.
- Messages are drafts for broker review by default. No fake send or delivery success may be stored or displayed.
- WhatsApp and Telegram are described as production-connected only after credentials, verified webhooks, authenticity checks, delivery/error handling, and real integration tests exist.
- Opportunity ownership is preserved during cooperation. The platform does not decide commission, financial entitlement, contractual division, or legal responsibility.
- No API secrets belong in client code or the repository. Sensitive backend actions validate authentication, office membership, `officeId`, allowed fields, and least privilege.
- Critical ownership, cooperation, sharing, deletion, message-send, and administrative actions are recorded in internal audit logs.

## Approved implementation order

0. Foundation and audit.
1. Office Card and Office Settings.
2. Unified Opportunity intake.
3. Opportunity Bank.
4. Matching engine.
5. Operations Center and notifications.
6. Cooperation.
7. Smart messages and integration adapters.
8. Hardening.

Only an explicitly approved phase may be implemented. Each phase requires tests, build checks, documentation updates, an honest limitations report, and approval before advancing.

## Definition of done

A phase is complete only when its paths are connected, persistence and authorization are enforced, relevant automated tests and acceptance scenarios pass, no production path depends on fake data, and failures or unavailable integrations are described honestly. Code presence alone is not completion.
