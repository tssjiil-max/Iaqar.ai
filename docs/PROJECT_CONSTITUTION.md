# IAQAR.AI Project Constitution

Version: 1.0  
Status: mandatory  
Source of authority: IAQAR.AI Master Engineering Directive v1.0

## Product definition

IAQAR.AI is an intelligent operating system for real-estate offices and licensed brokers. It is not a public listings website. It receives opportunities, normalizes and stores them, rematches them when relevant data changes, and creates broker-facing work only when action is required.

The supreme product rule is:

> THE SYSTEM WORKS IN THE BACKGROUND. THE BROKER SEES ONLY THE NEXT REQUIRED ACTION.

Owners, customers, and cooperating brokers must never gain general access to internal opportunities, matching logic, office data, internal scores, operations, or unrelated cooperation records.

## Non-negotiable product rules

1. Preserve the existing Firebase Authentication, Firestore, FCM, Cloudflare Worker/R2, PWA, Arabic RTL interface, and existing working infrastructure.
2. Do not migrate frameworks, databases, hosting, state management, or backend architecture without owner approval.
3. Do not redesign the approved visual language: Arabic, RTL, mobile-first, white cards, light-green accents, dark-green headings, rounded corners, soft shadows, and spacious layouts.
4. The home page contains only the Office Card, Add Opportunity, and Operations Center.
5. Do not add a bottom navigation bar, Deals/الصفقات page, visible standalone Settings button, unapproved widgets, static production operations, or unapproved opportunity labels.
6. Office Settings opens from the office logo and the office cover/display image.
7. Office Settings data fields are only office name, broker name, license number, city, and mobile number. Email is not shown.
8. The Opportunity Bank entry is inside Office Settings; it is not a fourth home section.
9. Smart cooperation defaults to `APPROVAL_REQUIRED`. Automatic cooperation never exposes private contacts automatically.
10. Broker-confirmed values always take precedence over extraction guesses.
11. No production feature may depend on fake data or claim an external integration is connected without credentials, verified webhooks, delivery/error handling, and real integration tests.
12. Outbound WhatsApp and Telegram communication defaults to a broker-reviewed draft. No automatic sending policy is implied.
13. Ownership never transfers merely because cooperation is enabled. The system does not decide commissions, financial entitlement, contractual division, or legal responsibility.

## Tenant isolation and authorization

- Every office-scoped record contains `officeId`, even when nested under an office path.
- Broker-scoped records also contain `brokerId` when applicable.
- No office may read, query, modify, download, or infer another office's data.
- Cross-office access requires an explicit approved cooperation record and exposes only the minimum permitted fields.
- Frontend hiding is not security. Firestore Rules and backend authorization enforce identity, office membership, role, protected ownership fields, and least privilege.
- Public links expose only the approved public office profile and public intake.
- Office media uploads use allowlisted types, bounded sizes, tenant-scoped paths, and manager authorization.
- Critical settings, sharing, cooperation, ownership-sensitive changes, deletion/archive, and send attempts require internal audit records.

## Opportunity and workflow invariants

- All sources become one internal `Opportunity`; the original source remains linked and large files load lazily.
- Duplicate input must not create duplicate opportunities, matches, operations, notifications, or cooperation requests.
- Matching is automatic, configurable, tenant-aware, retry-safe, idempotent, and versioned.
- A no-match opportunity is stored in the private bank without creating a non-actionable Operation.
- An actionable result creates at most one open Operation per action/source event.
- Notifications route to the correct office/broker, respect preferences, link to an Operation, avoid duplicates, remain auditable, and have an in-app fallback.
- Internal parser logs, confidence details, queues, debug output, and match-engine run counts are never broker-facing.

## Approved implementation order

Implementation proceeds one approved phase at a time:

0. Foundation and factual audit.
1. Office Card and Office Settings.
2. Unified opportunity intake.
3. Opportunity Bank.
4. Matching engine.
5. Operations Center and notifications.
6. Cooperation.
7. Smart messages and integration adapters.
8. Hardening and full acceptance.

At each phase boundary, run the existing tests, new phase tests, build, and configured lint/type checks; update documentation; report changed files, database and security changes, PASS/FAIL acceptance results, and limitations; then stop for approval.

## Definition of done

A phase is done only when its code paths are connected, persistence and access control are enforced, tests and build pass, relevant acceptance scenarios pass, documentation is current, and limitations are reported honestly. Code presence alone is not evidence that a feature works.

Phase 2 must not begin until the project owner approves the Phase 0/1 report.
