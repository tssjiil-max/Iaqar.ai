# IAQAR.AI Project Constitution

Status: approved and mandatory  
Source: IAQAR.AI Master Engineering Directive v1.0

## Product purpose

IAQAR.AI is an intelligent operating system for licensed real-estate offices and
brokers. It is not a public listings site. The system receives and normalizes
opportunities, stores them privately, rematches them in the background, and
creates an operation only when broker action is required.

The controlling product rule is:

> The system works in the background. The broker sees only the next required
> action.

## Non-negotiable product rules

- The home page contains only the Office Card, Add Opportunity, and Operations
  Center.
- There is no bottom navigation, Deals page, standalone settings button, fake
  production operation, or unapproved dashboard widget.
- Office Settings opens from the office logo or cover image.
- The Opportunity Bank is private and is entered from Office Settings, not from
  a fourth home section.
- The interface remains Arabic, RTL, mobile-first, white and light-green, with
  dark-green headings, rounded cards, soft shadows, and the approved layout.
- Owners and customers cannot access internal opportunities, matches,
  operations, scores, cooperation data, or another office's information.
- Broker-to-broker cooperation is explicit, scoped, revocable, read-only by
  default, and never transfers ownership.
- Contact data remains hidden from a cooperating party until an approved
  permission allows access.
- WhatsApp and Telegram messages are drafts for broker review by default.
- No external integration may be described as connected without valid
  credentials, verified webhooks, callback validation, error handling, and real
  integration tests.

## Tenant and ownership invariants

- Every office-scoped record contains `officeId`.
- Every broker-scoped record contains `officeId` and, where applicable,
  `brokerId`.
- Firestore rules and backend authorization enforce tenant boundaries; client
  hiding is not security.
- A broker cannot directly change protected ownership fields.
- Cross-office access is allowed only by an explicit cooperation record and
  exposes the minimum required data.
- Opportunities retain originating office, originating broker, original
  creation time, current owner, and cooperation references.

## Office identity invariants

- Visible office data is limited to office name, broker name, license number,
  city, and mobile number. No email appears in Office Settings.
- Office names contain at least four visible characters after trimming, support
  Arabic and Latin characters, and are unique system-wide after normalization.
- Uniqueness is reserved atomically in the backend/database; frontend
  validation is advisory only.
- Public URLs use a stable handle and do not silently rename an office.
- Logo, display image, and wide cover uploads validate type and size and support
  preview, configurable crop, replace, removal, save, loading, and failure
  states.

## Operational invariants

- Every source becomes one unified Opportunity linked to its original source.
- Confirmed broker values take precedence over extracted guesses.
- Matching runs automatically for relevant changes and is idempotent.
- No-match opportunities remain in the private bank and do not create an
  operation merely because they were saved.
- Match, operation, notification, cooperation, and ingestion processing is
  tenant-aware, retry-safe, auditable, and deduplicated.
- Operations contain actionable work only; internal logs and non-actionable
  calculations remain hidden.
- Notifications respect office/broker preferences and link to an operation.
- Delivery is never marked successful without a real provider result.

## Security invariants

- No secrets or service credentials are committed or exposed to client code.
- Sensitive actions authenticate identity, verify `officeId`, validate input,
  apply least privilege, prevent mass assignment, and write an audit record.
- Uploads use office-scoped paths and validated media types and sizes.
- Public intake and webhooks require abuse controls and authenticity validation
  where the provider supports it.
- Existing rules must not be weakened for convenience.

## Delivery discipline

- Preserve the current Firebase, Firestore, FCM, Cloudflare Worker/R2, PWA, and
  Arabic RTL implementation unless the owner approves a migration.
- Implement one approved phase at a time.
- A phase is complete only after connected persistence, access control,
  automated tests, acceptance verification, build/lint checks, documentation,
  and an honest limitations report.
- Do not proceed beyond the currently approved phase.
