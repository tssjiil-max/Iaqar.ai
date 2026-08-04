# IAQAR.AI — Project Constitution

Status: APPROVED AND MANDATORY. This document restates the non‑negotiable
product rules from the Master Engineering Directive (v1.0). It is the highest
authority for the project. Code that contradicts these rules is defective by
definition, even if it "works".

## 1. Product definition

IAQAR.AI is **not** a public real‑estate listings website. It is an intelligent
operating system for real‑estate offices and licensed brokers.

Supreme product rule:

> THE SYSTEM WORKS IN THE BACKGROUND. THE BROKER SEES ONLY THE NEXT REQUIRED ACTION.

The broker must never have to manually search large lists to discover what to do.

## 2. Approved home page (Section 5)

The home page contains **only**:

1. Office Card
2. Add Opportunity
3. Operations Center

Explicitly forbidden on the home page / product:

- Bottom navigation bar.
- A Deals page (`Deals` / `الصفقات`).
- A separate/standalone "Office Settings" button.
- Unapproved dashboard widgets, static demo operations, unrequested menu items,
  unrequested opportunity status labels.

Interface must remain: Arabic, RTL, mobile‑first, clean, white background, light
green accents, dark green headings, rounded cards, soft shadows, spacious,
simple. **Do not redesign the approved UI.**

## 3. Office Card (Section 6)

Displays: office logo, office cover/display image, office name, broker name,
license number, city, approved services summary.

- Clicking the **logo** OR the **cover/display image** opens Office Settings.
- There must be **no visible standalone "Office Settings" button**.
- Logo and cover must have accessible click targets, keyboard support, subtle
  interaction feedback, and no visual clutter.

## 4. Office Settings (Section 7)

Approved sections only:

- 7.1 Visual identity: logo, display image, wide WhatsApp‑compatible cover.
  Upload/preview/crop/replace/remove/save + type & size validation + loading and
  error states. Cover crop ratio is a **configurable design setting**, not a
  hard‑coded external dimension.
- 7.2 Office data (visible fields only): office name, broker name, license
  number, city, mobile number. **No email field.**
- 7.3 Unique office name: ≥ 4 visible characters, trimmed, normalized, unique
  system‑wide, Arabic + Latin, reject blank/whitespace. Backend/database must
  prevent race‑condition duplicates. Never silently rename an office.
- 7.4 Office link: copy, share, QR code, preview public link.
- 7.5 Notification preferences: match, owner/customer, cooperation, message,
  appointment/follow‑up, important system. Saved per office (and per broker
  where needed). Preserve existing FCM.
- 7.6 Opportunity Bank entry card/icon named "بنك الفرص". Must NOT become a
  permanent fourth home‑page section.
- 7.7 Smart cooperation setting "السماح بالتعاون الذكي بين الوسطاء" with modes:
  disabled / approval‑required (**default**) / smart‑automatic. Automatic
  cooperation must never auto‑expose private contact info.

## 5. Tenant & data isolation (Section 4, 25)

- Every office‑scoped record carries `officeId`; broker‑scoped records carry
  `brokerId` + `officeId` where applicable.
- No office may read, modify, query, or infer another office's data.
- Cross‑office access only through an explicit, approved cooperation record, and
  even then only the minimum necessary data; owner/customer contact stays hidden
  until cooperation permissions allow it.
- Firestore Security Rules **and** backend authorization enforce isolation.
  Frontend hiding alone is never sufficient.
- Do not weaken existing Firestore rules to make development easier.

## 6. Honesty rules (Section 7.6, 10, 12, 18, 30)

- A feature is "working" **only** when the code path is connected, data persists
  correctly, access control is enforced, automated tests pass, the acceptance
  scenario passes, and no production path depends on fake data.
- Never label an integration "production connected" without real credentials,
  configured webhooks, verified callbacks, signature/token validation, delivery
  handling, and real integration tests. Otherwise it is "adapter ready" or
  "simulated".
- Do not store fake delivery success. Do not show mock data as real delivery.
- Do not expose technical logs, parser internals, confidence scores, or queue
  details in the broker UI.

## 7. Ownership (Section 20)

Opportunity ownership never transfers merely because cooperation is enabled.
Originating office/broker and original `createdAt` are always preserved. The
system must not decide commission, financial entitlement, contractual division,
or legal responsibility, and must not create automatic financial commitments.

## 8. Change discipline (Section 1, 28, 30)

- Work only inside this repository. Inspect before modifying. Preserve the
  existing stack (Firebase Auth, Firestore, FCM, storage, Cloudflare Worker, PWA,
  security rules, tests, Arabic RTL UI). No framework/DB/hosting migration
  without explicit owner approval.
- Do not remove working code merely due to preference.
- Implement in controlled phases; at each phase end run tests + build, report
  changed files, report PASS/FAIL acceptance criteria, report limitations
  honestly, and stop for approval.
- "Code written" does not mean "done".
