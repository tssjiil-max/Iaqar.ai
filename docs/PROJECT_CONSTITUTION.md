# IAQAR.AI — Project Constitution (دستور المشروع)

Status: APPROVED AND MANDATORY — derived from the Master Engineering Directive v1.0.
Every change to this repository must comply with this document. When a requirement is
unclear, implement only the unambiguous part, record the open point in
`docs/DECISIONS.md`, and stop.

## 1. Product definition

IAQAR.AI is **not** a public real-estate listings website. It is an intelligent
operating system for real-estate offices and licensed brokers. The supreme product rule:

> **THE SYSTEM WORKS IN THE BACKGROUND. THE BROKER SEES ONLY THE NEXT REQUIRED ACTION.**

The system must: receive opportunities from multiple sources, analyze and normalize
incoming content, extract structured real-estate data, save all usable opportunities
internally, re-run matching automatically when relevant data changes, create operational
events only when broker action is needed, prepare suitable WhatsApp/Telegram messages,
notify the correct office or broker, enable controlled broker-to-broker cooperation, and
preserve opportunity ownership and office privacy.

## 2. Non-negotiable execution rules

1. Work only inside this repository. Preserve the current stack:
   Firebase Auth + Firestore + FCM, Cloudflare Worker backend, Cloudflare R2 media,
   static Arabic-RTL PWA frontend on Firebase Hosting. No framework/database/hosting
   migration without explicit owner approval.
2. Do not remove working code merely because another implementation is preferred.
3. Do not visually redesign the approved interface.
4. Never add: a bottom navigation bar, a deals page (`الصفقات` as a page/module),
   a separate visible settings button, unapproved dashboard widgets, static demo
   operations, unrequested menu items, or unrequested opportunity status labels.
5. A feature counts as **working** only when: the code path is connected, data is
   persisted correctly, access control is enforced, automated tests pass, the acceptance
   scenario passes, and no production path depends on fake data. "Code written" ≠ "done".
6. No deploys to production and no pushes outside the agreed workflow unless requested.
7. Implement in controlled phases (see `docs/IMPLEMENTATION_PLAN.md`). At the end of
   every phase: run tests, run the build/checks, report changed files, report acceptance
   criteria PASS/FAIL, report limitations honestly, and stop for approval.

## 3. Roles

- Internal: real-estate office, licensed broker, (later) authorized office team member.
- External: property owner, customer, cooperating broker.
- Owners/customers must never access: the internal Opportunity Bank, matching logic,
  other office information, other customers/owners, unrelated cooperation records,
  internal operations, or internal scoring. External participants may only open the
  office link, submit an offer/request, complete missing information through a secure
  link, receive approved messages, and respond through supported channels.

## 4. Tenant isolation (absolute)

- Every office-scoped record carries `officeId`; broker-scoped records also carry
  `brokerId` where applicable.
- No office may read, modify, query, or infer another office's data — applies to
  opportunities, files, customers, owners, matches, operations, messages, notifications,
  cooperation requests, settings, analytics, and audit records.
- Cross-office access only through an explicit approved cooperation record, exposing the
  minimum data required; contact information stays hidden until cooperation permissions
  allow it.
- Firestore Security Rules **and** Worker authorization must both enforce isolation.
  Frontend hiding is never sufficient.

## 5. Approved home page

Target home page contains only: **Office Card**, **Add Opportunity**, **Operations
Center**. No bottom navigation, no deals page, no separate settings button, no extra
permanent sections without approval. Interface: Arabic, RTL, mobile-first, clean, white
background, light-green accents, dark-green headings, rounded cards, soft shadows.

## 6. Office Card and Office Settings

- The Office Card displays: office logo, office cover/display image, office name, broker
  name, license number, city, approved services summary.
- Office Settings opens by clicking the office **logo** or the office **cover** —
  never via a visible standalone settings button. Both targets must be accessible
  (keyboard + clear but subtle feedback).
- Visible office data fields are: office name, broker name, license number, city,
  mobile number. **No email field** in this interface.
- Office name: ≥ 4 visible characters, unique system-wide after normalization
  (Arabic + Latin supported), validated after trimming, enforced at the backend/database
  level against races (`officeNameClaims` transaction), clear Arabic validation message,
  never silently changed. A stable slug (`publicSlug`) backs the office URL.
- Office Settings also contains: office link (copy/share/QR/preview), notification
  preferences, the **بنك الفرص** (Opportunity Bank) entry, and the smart cooperation
  setting «السماح بالتعاون الذكي بين الوسطاء» with modes DISABLED /
  APPROVAL_REQUIRED (default) / SMART_AUTOMATIC.
- The cover crop ratio is a configurable design setting — never hard-code an external
  platform's dimensions into the workflow.

## 7. Opportunities

- Add Opportunity is one unified intake gateway: one compact text/link input, one
  paperclip, one submit action. Sources (office link, text, image, screenshot, PDF,
  Word, Excel, audio, WhatsApp Business API, Telegram, shares) are ingestion channels,
  not home-page sections.
- Every source becomes one unified `Opportunity` entity (see `docs/DATA_MODEL.md`).
- Lifecycle statuses (INGESTED…DELETED) are internal. Never show labels such as
  «فرصة مرصودة», «فرصة قيد المتابعة», «فرصة غير مطابقة».
- When no match exists, the opportunity is stored silently in the office Opportunity
  Bank; it stays eligible for automatic rematching. No Operations item and no extra
  broker action just because it was saved.
- Broker-confirmed values always take precedence over extracted guesses; AI output must
  never silently overwrite confirmed data.

## 8. Matching, Operations, Notifications

- Matching runs automatically on relevant events; the broker never presses a "rematch"
  button in the normal workflow. Matching is idempotent: the same opportunity pair +
  matching rule version + data version never produces duplicate Match records.
- Thresholds are configuration, not UI-scattered constants. A weak match is never a
  confirmed result.
- The Operations Center shows only actionable work items — never every saved
  opportunity, queue events, technical logs, static/demo cards, or non-actionable match
  calculations. Duplicate open operations for the same action + source event are
  forbidden (deduplicationKey).
- Notifications route to the correct office/broker, respect preferences, link to the
  related operation, avoid duplicates, and are auditable. Existing FCM/PWA behavior is
  preserved, with an in-app fallback when push permission is unavailable.

## 9. Messages and external integrations (honesty rules)

- Message drafts are generated in Arabic; the broker reviews and initiates sending by
  default. No automatic owner/customer sending without an approved sending policy.
- Never store fake delivery success. Never label an integration "production connected"
  without valid credentials, configured webhooks, verified callbacks, signature/token
  validation, delivery/error handling, and real integration tests. Without credentials,
  build the adapter + webhook contract + deterministic fixtures and label it honestly
  ("adapter ready" / "simulated").
- Only official, authorized integrations. No scraping, account hijacking, browser
  automation, or unauthorized message access.

## 10. Cooperation and ownership

- Office cooperation modes: DISABLED / APPROVAL_REQUIRED (default) / SMART_AUTOMATIC.
- Ownership never transfers merely because cooperation is enabled. Originating
  office/broker, original createdAt, current owning office, and cooperation references
  are always preserved.
- Visible cooperation statuses: «لم تُشارك», «بانتظار الموافقة», «تعاون نشط»,
  «رُفض الطلب», «انتهى التعاون».
- "Share the entire bank" means: explicit opt-in, revocable, scoped, filterable,
  read-only by default, minimum data exposure, contacts hidden by default, ownership
  preserved — never raw database access.
- The system never decides commission percentages, financial entitlement, contractual
  division, or legal responsibility, and never creates automatic financial commitments.

## 11. No deals page

No page or module named "Deals" / «الصفقات». Successful progression is stored internally
as state; completion may surface as a badge, a completion operation, a success
notification, or a status update inside the relevant record.

## 12. Security and audit

- No API keys or secrets in client code or in the repository.
- Validate file types and sizes; use secure storage paths; check `officeId` on every
  sensitive backend action; validate authenticated identity; least privilege; protect
  public intake endpoints (rate limiting where supported); validate webhook
  authenticity; prevent arbitrary reads, mass assignment of protected fields, and direct
  ownership-field changes by brokers; log sensitive cooperation actions; use expiring
  secure links for external completion links.
- Never weaken existing Firestore rules for development convenience.
- Keep internal audit records for critical actions. The broker-facing Opportunity Bank
  activity summary shows only: date added + cooperation status. Debug logs never appear
  in the UI.

## 13. Definition of Done (per phase)

Required functionality implemented; no approved functionality removed; tests pass;
build/checks pass; lint/type checks pass when available; security rules updated and
tested when needed; tenant isolation still enforced; no production path requires demo
data; documentation updated; changed files reported; known limitations reported
honestly; acceptance criteria listed as PASS or FAIL.
