# IAQAR.AI — Project Constitution

**Version:** 1.0  
**Authority:** PROJECT CONSTITUTION (highest)  
**Status:** APPROVED AND MANDATORY

This document is the non-negotiable product authority for IAQAR.AI.  
Implementation must not redesign the product, invent requirements, remove approved functionality, change the business model, or conflict with this constitution.

When a requirement is genuinely unclear: complete only unambiguous work, document the unresolved point, and stop before implementing the ambiguous part.

---

## Supreme product rule

> THE SYSTEM WORKS IN THE BACKGROUND. THE BROKER SEES ONLY THE NEXT REQUIRED ACTION.

IAQAR.AI is an intelligent operating system for real-estate offices and licensed brokers — **not** a public listings website.

## Execution contract (summary)

1. Work only inside this repository.
2. Inspect before modifying.
3. Preserve the current stack (Firebase Auth, Firestore, FCM, Storage/R2, Cloudflare Worker, PWA, security rules, Arabic RTL UI).
4. Do not remove working code merely for preference.
5. Do not visually redesign the approved interface.
6. Do not add: bottom navigation, deals page, separate settings button, unapproved widgets, static demo operations, unrequested menu items, or unrequested opportunity status labels.
7. A feature is working only when connected, persisted, access-controlled, tested, and free of fake production data.
8. Implement in controlled phases; stop for approval between phases.
9. Never claim untested integrations are production-connected.

## Approved home page

Only:

1. Office Card
2. Add Opportunity
3. Operations Center

No bottom navigation. No separate deals page. No separate settings button.

Interface: Arabic, RTL, mobile-first, clean white background, light green accents, dark green headings, rounded cards, soft shadows, spacious, simple.

## Office Card

Displays: logo, cover/display image, office name, broker name, license number, city, approved services summary.

Office Settings opens when the broker clicks the **logo** or the **cover/display image**.  
No visible standalone “Office Settings” button.

## Office Settings (approved sections)

1. Visual identity (logo, display image, wide WhatsApp-compatible cover; upload/preview/crop/replace/remove/save; configurable crop ratio)
2. Office data: office name, broker name, license number, city, mobile — **no email field**
3. Unique office name (min 4 visible chars, normalized uniqueness, backend enforcement, stable handle/slug)
4. Office link (copy, share, QR, preview)
5. Notification preferences (match, owner/customer, cooperation, message, appointment/follow-up, system)
6. Opportunity Bank entry: **بنك الفرص** (not a permanent home section)
7. Smart cooperation modes: DISABLED / APPROVAL_REQUIRED (default) / SMART_AUTOMATIC

## Tenant isolation

Every office-scoped record includes `officeId`.  
No office may read, modify, query, or infer another office’s data except through explicit approved cooperation with least privilege.  
Frontend hiding alone is not sufficient — Firestore rules and backend authorization must enforce isolation.

## Opportunity / matching / operations (product rules)

- Unified Opportunity model from all sources.
- Background analysis and automatic rematching.
- Operations Center shows only actionable work items.
- No match ⇒ save in Opportunity Bank; do **not** create an Operations item merely for saving.
- Ownership never transfers via cooperation alone.
- No deals page (`Deals` / `الصفقات`).
- Message drafts reviewed by broker before send by default.
- Mock integrations must be labeled honestly (adapter ready / simulated).

## Implementation phases

| Phase | Focus |
|------:|-------|
| 0 | Foundation and audit (docs + rules; no product UI redesign) |
| 1 | Office Card and Office Settings |
| 2 | Unified opportunity intake |
| 3 | Opportunity Bank |
| 4 | Matching engine |
| 5 | Operations Center and notifications |
| 6 | Cooperation |
| 7 | Smart messages and integration adapters |
| 8 | Hardening |

**Current execution:** Phase 0 + Phase 1 only. Do not start Phase 2 without owner approval.

## Definition of done (per phase)

Required functionality implemented; approved functionality preserved; tests/build/lint pass; security/tenant isolation enforced; no production path requires demo data; documentation updated; acceptance criteria listed PASS/FAIL; limitations reported honestly.

## Related documents

- `docs/SYSTEM_ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/EVENT_WORKFLOW.md`
- `docs/ACCEPTANCE_TESTS.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DECISIONS.md`
- `.cursor/rules/iaqar-project-constitution.mdc`
