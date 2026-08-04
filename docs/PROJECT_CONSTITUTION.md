# IAQAR.AI — Project Constitution

Status: APPROVED AND MANDATORY · Version 1.0

This document is the highest authority for the IAQAR.AI product. It restates the
non‑negotiable rules from the Master Engineering Directive. Any change that
conflicts with this document is not allowed without explicit project‑owner
approval recorded in [`DECISIONS.md`](./DECISIONS.md).

## 1. Product definition

IAQAR.AI is **not** a public real‑estate listings website. It is an intelligent
operating system for real‑estate offices and licensed brokers.

> **Supreme product rule:** THE SYSTEM WORKS IN THE BACKGROUND. THE BROKER SEES
> ONLY THE NEXT REQUIRED ACTION.

The broker must not manually search large lists to discover what to do. Matching,
analysis and routing run internally; the UI surfaces only the next useful action.

## 2. Execution rules

- Work only inside this repository. Inspect before modifying.
- Preserve the current stack: Firebase Auth, Firestore, Firebase Cloud
  Messaging (FCM), existing media storage (Cloudflare R2 via the Worker),
  Cloudflare Worker backend, PWA support, existing security rules, existing
  tests, and the approved Arabic RTL interface.
- Do **not** migrate framework, database, hosting, state management, or
  architecture without explicit owner approval.
- Do not remove working code merely for preference. Do not visually redesign the
  approved interface.
- Never claim a feature works merely because code exists (see §7 below).
- Do not push or deploy unless explicitly requested.
- Implement in controlled phases; stop for approval at the end of each phase.

## 3. Approved home page (do not add sections without approval)

The home page contains **only**:

1. Office Card
2. Add Opportunity
3. Operations Center

Forbidden on the home page / product:

- Bottom navigation bar
- A Deals page (`الصفقات`) or deals module
- A separate standalone Settings button
- Unapproved dashboard widgets / menu items
- Static demo operations or fake demo cards in production
- Unrequested opportunity status labels

Interface identity: Arabic, RTL, mobile‑first, white background, light‑green
accents, dark‑green headings, rounded cards, soft shadows, spacious, simple.

## 4. Office Card & Settings

- The Office Card shows: office logo, office cover/display image, office name,
  broker name, license number, city, approved services summary.
- **Office Settings opens when the broker clicks the office logo OR the office
  cover image.** There must be **no visible standalone "Office Settings"
  button**. Both targets must be keyboard accessible with subtle feedback.
- Office Settings visible fields: office name, broker name, license number,
  city, mobile number. **No email field** in this interface.
- Office name: ≥ 4 visible characters, unique system‑wide after normalization,
  validated after trimming, Arabic + Latin allowed, blank/whitespace rejected,
  enforced at the database level (not frontend only).

## 5. Tenant & data isolation

- Every office‑scoped record includes `officeId`; broker‑scoped records include
  `brokerId` + `officeId` where applicable.
- No office may read, modify, query, or infer another office's data.
- Cross‑office access only through an explicit, approved cooperation record, and
  even then expose only the minimum data. Owner/customer contact details stay
  hidden from a cooperating broker until permissions allow.
- Isolation is enforced by Firestore Security Rules **and** backend
  authorization. Frontend hiding alone is never sufficient.
- Do not weaken existing Firestore rules to make development easier.

## 6. Ownership, cooperation & honesty

- Opportunity ownership never transfers because cooperation is enabled.
- Cooperation modes: `DISABLED`, `APPROVAL_REQUIRED` (default), `SMART_AUTOMATIC`.
  Automatic cooperation must never auto‑expose private contact information.
- The system must not decide commission, financial entitlement, contractual
  division, or legal responsibility.
- External integrations (WhatsApp/Telegram) must be labelled honestly:
  `adapter ready` / `simulated`, never `production connected`, unless credentials,
  webhooks, signature validation, delivery handling and real tests exist.
- Default outbound behaviour: generate a draft; the broker reviews and initiates
  sending. Never store fake delivery success.

## 7. Definition of "working"

A feature is working **only** when all hold:

- The code path is connected.
- Data is persisted correctly.
- Access control is enforced.
- Automated tests pass.
- The acceptance scenario passes.
- No production path depends on fake data.

"Code written" does not mean "done".

## 8. Security baseline

No secrets in the repo or client code; validate file type/size; secure storage
paths; check `officeId` on every sensitive backend action; least privilege;
protect public intake endpoints; validate webhooks where supported; prevent
arbitrary document reads; prevent mass assignment of protected fields; prevent
brokers from changing ownership fields; log sensitive cooperation actions; use
expiring secure links for external completion.
