# IAQAR.AI — Project Constitution

Version: 1.0 · Status: APPROVED AND MANDATORY · Authority: highest in this repository.

This file is the transcription of the approved product rules. Any change to code,
schema, rules or copy that contradicts this file is invalid, regardless of how
reasonable it looks in isolation. If a requirement here is genuinely unclear, stop,
record the open question in `DECISIONS.md`, and implement only the unambiguous part.

---

## 1. What the product is

IAQAR.AI is **not** a public real-estate listings website. It is an intelligent
operating system for real-estate offices and licensed brokers.

The supreme product rule:

> **THE SYSTEM WORKS IN THE BACKGROUND. THE BROKER SEES ONLY THE NEXT REQUIRED ACTION.**

The system must receive opportunities from many sources, normalize and extract
structured data, store every usable opportunity internally, re-run matching
automatically when relevant data changes, create an operational event **only** when a
broker action is needed, prepare WhatsApp/Telegram messages, notify the correct
office or broker, enable controlled broker-to-broker cooperation, and always preserve
opportunity ownership and office privacy.

The broker must never have to search a long list to discover what to do.

## 2. Non-negotiable engineering rules

1. Work only inside this repository. Preserve the current stack: Firebase Auth,
   Firestore, Firebase Cloud Messaging, the existing media storage (Cloudflare R2 via
   the Worker), the Cloudflare Worker backend, PWA support, the existing Firestore
   security rules, the existing tests, and the approved Arabic RTL interface.
2. Do not migrate framework, database, hosting, state management or architecture
   without explicit owner approval.
3. Do not delete working code because another implementation would be nicer.
4. Do not visually redesign the approved interface.
5. Never claim a feature works because code exists. A feature is working only when the
   code path is connected, data persists correctly, access control is enforced,
   automated tests pass, the acceptance scenario passes, and **no production path
   depends on fake data**.
6. Do not push or deploy unless explicitly requested.
7. Before changing code: inspect `git status`, identify uncommitted work, never
   overwrite unrelated work, and report conflicts before proceeding.
8. Implement in controlled phases. At the end of every phase: run tests, run the
   build, report changed files, report completed acceptance criteria, report
   limitations honestly, then stop for approval.

## 3. Forbidden additions

Never add any of the following:

- A bottom navigation bar.
- A deals page (`Deals` / `الصفقات`) or a deals module the broker must manage.
- A separate, visible "Office Settings" button.
- Unapproved dashboard widgets.
- Static demo operations or fake demo cards in a production path.
- Unrequested menu items.
- Unrequested opportunity status labels — specifically never surface
  `فرصة مرصودة`, `فرصة قيد المتابعة`, or `فرصة غير مطابقة`.

Internal lifecycle statuses (`INGESTED`, `ANALYZING`, `NEEDS_DATA`, `READY`, `MATCHED`,
`CLOSED`, `ARCHIVED`, `DELETED`) are implementation details and must stay internal.

## 4. Approved home page

Exactly three sections, in this order:

1. **Office Card**
2. **Add Opportunity**
3. **Operations Center**

No bottom navigation. No deals page. No standalone settings button. No additional
permanent sections without approval.

Interface: Arabic, RTL, mobile-first, clean, white background, light-green accents,
dark-green headings, rounded cards, soft shadows, spacious, simple. Preserve the
currently approved visual layout; do not reinterpret it.

## 5. Office Card

Displays: office logo, office cover/display image, office name, broker name, license
number, city, approved services summary.

Office Settings opens when the broker clicks **the office logo** or **the office
cover/display image**. There must be no visible standalone "Office Settings" button.
Both click targets need accessible click areas, keyboard support, clear but subtle
interaction feedback, and no visual clutter.

## 6. Office Settings — approved sections only

- **7.1 Visual identity** — logo, display image, wide WhatsApp-compatible cover.
  Workflow must support upload, preview, crop, replace, remove (when allowed), save,
  file type/size validation, loading state, error state. The cover crop ratio is a
  **configurable design setting**, never a hard-coded unverified external platform
  dimension. Identity must be consistent across the IAQAR office page, the shared
  office link, share previews, WhatsApp materials and QR materials.
- **7.2 Office data** — visible fields are exactly: office name, broker name, license
  number, city, mobile number. **No email field in this interface.**
- **7.3 Unique office name** — at least 4 visible characters, more allowed, unique
  across the entire system, validated after trimming, equivalent duplicates rejected
  after normalization, Arabic and Latin supported, blank/whitespace-only rejected.
  Store a normalized value for duplicate checking. Use a separate stable office
  handle/slug for the office URL when necessary. Check availability before saving,
  show a clear Arabic validation message, prevent race-condition duplicates at the
  backend/database level, never rely on front-end validation alone, and never silently
  change an office name.
- **7.4 Office link** — copy, share, QR code, preview the public office link.
- **7.5 Notifications** — the broker can enable/disable: match notifications, owner and
  customer notifications, cooperation notifications, message notifications, appointment
  and follow-up notifications, important system notifications. Preferences are saved per
  office and, where needed, per broker. Notifications reach only the correct office or
  broker. Preserve and integrate the existing FCM implementation; do not replace it.
- **7.6 Opportunity Bank entry** — a clear card or icon named **`بنك الفرص`** that opens
  the private Opportunity Bank for the current office. The bank must never become a
  permanent fourth home-page section.
- **7.7 Smart cooperation** — **`السماح بالتعاون الذكي بين الوسطاء`** with three modes:
  cooperation disabled, cooperation requires broker approval for every request, smart
  automatic cooperation per approved rules. **Default: approval required.** Automatic
  cooperation must never expose private contact information automatically.

## 7. Tenant and data isolation

Every office-scoped record carries `officeId`. Every broker-scoped record carries
`brokerId` and `officeId` where applicable. No office may read, modify, query or infer
another office's data — opportunities, files, customers, owners, matches, operations,
messages, notifications, cooperation requests, office settings, analytics or audit
records.

Cross-office access exists only through an explicit approved cooperation record, and
even then only the minimum necessary data is exposed. Owner/customer contact
information stays hidden from a cooperating broker until cooperation permissions allow
it. Firestore rules **and** backend authorization must both enforce isolation.
Front-end hiding is never sufficient.

## 8. Ownership and rights

Opportunity ownership never transfers because cooperation is enabled. Every
opportunity preserves originating office, originating broker, original `createdAt`,
current owning office, and cooperation references.

Visible cooperation statuses are exactly: `لم تُشارك`, `بانتظار الموافقة`,
`تعاون نشط`, `رُفض الطلب`, `انتهى التعاون`.

The system must never decide commission percentage, financial entitlement, contractual
division or legal responsibility, and must never create automatic financial
commitments.

## 9. External integration honesty

Never present WhatsApp or Telegram as production-connected without valid credentials,
configured webhooks, verified callback handling, signature/token validation, delivery
and error handling, and real integration tests. Without credentials: build a clean
adapter interface, webhook contracts, deterministic local fixtures and mock tests, and
label the integration **"adapter ready"** or **"simulated"** — never
"production connected".

Default outbound behaviour: generate a draft, let the broker review, let the broker
send. Never auto-send owner/customer messages without an approved sending policy.
Never store fake delivery success.

Use only official, authorized integrations. No scraping, no account hijacking, no
browser automation, no unauthorized message access.

## 10. Security baseline

No API keys in client code. No secrets in the repository. Validate file types and
sizes. Use secure storage paths. Check `officeId` on every sensitive backend action.
Validate authenticated identity. Apply least privilege. Protect public intake
endpoints from abuse and rate limit where supported. Validate webhook authenticity
where supported. Prevent arbitrary document reads, mass assignment of protected fields,
and direct broker edits to ownership fields. Log sensitive cooperation actions. Use
expiring secure links for external completion links. **Never weaken existing Firestore
rules to make development easier.**

## 11. Broker-visible activity summary

In the Opportunity Bank the visible administrative activity summary shows **only**:

- Date added
- Cooperation status

Never show match-engine run counts, parser logs, confidence calculations, queue
details or debug information. Technical logs and audit records stay internal.

## 12. Definition of done

A phase is complete only when required functionality is implemented, no approved
functionality was removed, tests pass, the build passes, lint/type checks pass where
available, security rules are updated and tested where needed, tenant isolation still
holds, no production path requires demo data, documentation is updated, changed files
are reported, known limitations are reported honestly, and each acceptance criterion is
listed as PASS or FAIL.

**"Code written" does not mean "done".**
