# IAQAR.AI — Project Constitution

Status: APPROVED AND MANDATORY
Source of authority: IAQAR.AI Master Engineering Directive v1.0
This document restates the non-negotiable product rules. If code and this document disagree,
this document wins and the code must be corrected.

---

## 1. What the product is

IAQAR.AI is **not** a public real-estate listings website. It is an intelligent operating system
for real-estate offices and licensed brokers.

Supreme product rule:

> **THE SYSTEM WORKS IN THE BACKGROUND. THE BROKER SEES ONLY THE NEXT REQUIRED ACTION.**

The system receives opportunities from many sources, normalizes and extracts structured data,
stores every usable opportunity internally, re-runs matching automatically, creates operational
items only when a broker action is needed, prepares Arabic messages, notifies the right office or
broker, and enables controlled broker-to-broker cooperation without transferring ownership.

## 2. Roles

Internal: real-estate office, licensed broker, authorized office team member (when supported).
External: property owner, customer, cooperating broker.

External participants may only open the office link, submit an offer or request, complete missing
information through a secure link, receive approved messages, and reply on supported channels.
They must never reach the Opportunity Bank, matching logic, other offices' data, internal
operations, internal scoring, or unrelated cooperation records.

## 3. Tenant isolation

* Every office-scoped record carries `officeId`. Every broker-scoped record carries `brokerId`
  (plus `officeId`) where applicable.
* No office may read, modify, query or infer another office's data — opportunities, files,
  customers, owners, matches, operations, messages, notifications, cooperation requests, office
  settings, analytics or audit records.
* Cross-office access happens only through an explicit, approved cooperation record, exposing the
  minimum data required. Owner/customer contact data stays hidden until cooperation permissions
  allow it.
* Firestore Security Rules **and** backend authorization enforce isolation. Hiding things in the
  frontend is never sufficient.

## 4. Approved home page

The home page contains exactly three things:

1. Office Card
2. Add Opportunity
3. Operations Center

Forbidden: bottom navigation bar, deals page, standalone settings button, unapproved dashboard
widgets, static demo operations, unrequested menu items, unrequested opportunity status labels.

Interface: Arabic, RTL, mobile-first, clean, white background, light-green accents, dark-green
headings, rounded cards, soft shadows, spacious, simple. The approved visual layout is preserved,
not reinterpreted.

## 5. Office Card

Displays office logo, office cover/display image, office name, broker name, license number, city,
and the approved services summary.

Office Settings opens when the broker activates **the logo** or **the cover image**. There is no
visible standalone "Office Settings" button. Both triggers are accessible, keyboard-operable and
give subtle interaction feedback.

## 6. Office Settings — approved sections

1. **Visual identity** — logo, display image, wide WhatsApp-compatible cover. Upload, preview,
   crop, replace, remove when allowed, save, type/size validation, loading state, error state.
   The cover crop ratio is a configurable design setting, never a hard-coded external platform
   dimension.
2. **Office data** — office name, broker name, license number, city, mobile number. **No email
   field is shown in this interface.**
3. **Unique office name** — at least 4 visible characters, longer allowed, unique system-wide
   after trimming and normalization, Arabic and Latin supported, blank/whitespace rejected. A
   normalized key is stored for duplicate checking, a stable handle/slug is used for the office
   URL. Availability is checked before saving, the Arabic validation message is clear, and the
   database prevents race-condition duplicates. Office names are never silently changed.
4. **Office link** — copy, share, QR code, preview of the public office link.
5. **Notifications** — enable/disable match, owner-and-customer, cooperation, message,
   appointment/follow-up, and important-system notifications. Preferences are stored per office
   and, where needed, per broker, and only reach the correct office or broker. The existing FCM
   implementation is preserved, not replaced.
6. **Opportunity Bank entry** — a card/icon named "بنك الفرص" that opens the office's private
   bank. The bank never becomes a permanent fourth home-page section.
7. **Smart cooperation** — "السماح بالتعاون الذكي بين الوسطاء" with three modes: disabled,
   approval required for every request (default), smart automatic under approved rules. Automatic
   cooperation never exposes private contact information automatically.

## 7. Add Opportunity

One compact text/link input, one paperclip, one small submit action in the same row. No permanent
per-file-type buttons. Accepts URL or copied text; the paperclip accepts camera, image,
screenshot, PDF, Excel, Word, audio and supported shared files.

After submission: store the source safely, analyze, extract, ask only for missing required
information, never re-ask for extracted data, create or update one unified Opportunity, and
trigger matching only when the minimum matching data exists. Visible states: uploading, analyzing,
missing information, saved, failed with retry. Technical logs are never shown to the broker.

## 8. Sources

Hidden ingestion sources may include the office public link, text, images, screenshots, PDF, Word,
Excel, audio, WhatsApp Business API, Telegram API/bot, shared content and future approved
integrations. Source metadata is internal and is not displayed as a prominent label. Only official
and authorized integrations are allowed — no scraping, no account hijacking, no browser
automation, no unauthorized message access.

## 9. Integration honesty

An integration may only be called "production connected" when it has valid credentials, configured
webhooks, verified callback handling, signature/token validation, delivery and error handling and
real integration tests. Otherwise it is labelled "adapter ready" or "simulated" and is backed by
adapter interfaces, webhook contracts, deterministic fixtures and mock tests.

Default outbound behaviour: generate a draft, let the broker review, let the broker send. No
automatic owner/customer messages without an approved sending policy. Fake delivery success is
never stored or displayed.

## 10. Data and lifecycle

One unified `Opportunity` entity per source, carrying at minimum: id, officeId, brokerId,
createdAt, updatedAt, createdBy, sourceType, source reference, opportunityKind (OFFER/REQUEST),
purpose, propertyType, city, district, nearby districts, price/budget, area, rooms, bathrooms,
attributes, owner/customer reference, extraction confidence, data completeness, internal lifecycle
status, cooperation state, ownership metadata, deduplication fingerprint and version.

Internal lifecycle statuses (INGESTED, ANALYZING, NEEDS_DATA, READY, MATCHED, CLOSED, ARCHIVED,
DELETED) are implementation details and are never surfaced as broker-facing labels such as
"فرصة مرصودة" or "فرصة غير مطابقة".

Extraction keeps raw source, extracted values, normalized values and broker-confirmed values
separate. Broker-confirmed values always win; AI values never silently overwrite them.

## 11. Opportunity Bank

Private to the office, opened from Office Settings. Unmatched opportunities are stored
automatically without an extra broker action and without creating an Operations item. The visible
administrative activity summary shows only **date added** and **cooperation status**. Engine run
counts, parser logs, confidence maths, queue details and debug output stay internal.

"Share the entire bank" means an explicit, revocable, scoped, filterable, read-only-by-default
permission with contact information hidden by default and ownership preserved — never raw database
access.

## 12. Matching and operations

Matching runs automatically on relevant events; a manual rematch button is not the normal broker
workflow. Matching is idempotent per canonical opportunity pair + rule version + data version,
uses configurable thresholds, and produces score, reasons, compatible/mismatched fields,
confidence, recommended action and routing.

The Operations Center shows only actionable work items. It never shows decorative tasks, demo
cards, every saved opportunity, queue events, technical logs or non-actionable calculations. Each
Operation carries a `deduplicationKey`; duplicate open Operations for the same action and source
event are forbidden. An approved empty state is shown when there is nothing to do.

## 13. Cooperation and ownership

Cooperation modes: DISABLED, APPROVAL_REQUIRED (default), SMART_AUTOMATIC. Ownership never
transfers because cooperation is enabled. Every opportunity preserves the originating office and
broker, the original creation time and the current owning office. Every cooperation record stores
its parties, scope, timestamps, status, permissions and revocation information.

Visible cooperation statuses: لم تُشارك، بانتظار الموافقة، تعاون نشط، رُفض الطلب، انتهى التعاون.

The system never decides commission percentages, financial entitlement, contractual division or
legal responsibility, and never creates automatic financial commitments.

## 14. No deals page

No page named "Deals" or "الصفقات". Successful progression is stored internally as state; the
broker may receive a badge, a completion operation, a success notification and a status update
inside the relevant record.

## 15. Architecture

Event-driven workflow, using the existing stack. A database-backed job/outbox pattern is
acceptable; a large new message broker is not, without approval. Every event handler is
idempotent, retry-safe, tenant-aware, auditable and able to record failure state. A failing
external integration must never corrupt an Opportunity.

## 16. Security

No API keys in client code, no secrets in the repository, validated file types and sizes, secure
storage paths, `officeId` checked on every sensitive backend action, authenticated identity
validated, least privilege, protected public intake endpoints, rate limiting where supported,
webhook authenticity validation, no arbitrary document reads, no mass assignment of protected
fields, brokers cannot change ownership fields, sensitive cooperation actions logged, expiring
secure links for external completion. Existing Firestore rules are never weakened for developer
convenience.

## 17. Definition of done

A phase is complete only when the functionality is implemented, no approved functionality was
removed, tests pass, the build passes, lint/type checks pass where available, security rules are
updated and tested where needed, tenant isolation still holds, no production path needs demo data,
documentation is updated, changed files are reported, limitations are reported honestly, and each
acceptance criterion is listed as PASS or FAIL.

**"Code written" does not mean "done".**
