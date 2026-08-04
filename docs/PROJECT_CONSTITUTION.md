# IAQAR.AI — Project Constitution

**Version:** 1.0  
**Authority:** PROJECT CONSTITUTION — highest authority for product and engineering decisions  
**Status:** APPROVED AND MANDATORY

This document restates the non-negotiable product rules from the Master Engineering Directive. When unclear, implement only unambiguous work, document the open point, and stop.

## Supreme product rule

> THE SYSTEM WORKS IN THE BACKGROUND. THE BROKER SEES ONLY THE NEXT REQUIRED ACTION.

IAQAR.AI is an intelligent operating system for real-estate offices and licensed brokers — not a public listings website.

## Execution contract

1. Work only inside this repository.
2. Inspect before modifying.
3. Preserve the current stack: Firebase Auth, Firestore, FCM, Cloudflare Worker/R2, PWA, security rules, tests, Arabic RTL UI.
4. Do not remove working code for preference.
5. Do not visually redesign the approved interface.
6. Do not add: bottom navigation, deals page, separate settings button, unapproved widgets, static demo operations, unrequested menu items, or unrequested opportunity status labels.
7. A feature is working only when connected, persisted, access-controlled, tested, acceptance-passing, and free of fake production data.
8. Do not push/deploy to production unless explicitly requested by the project owner.
9. Respect uncommitted user work; report conflicts before proceeding.
10. Implement in controlled phases; stop for approval between phases.

## Home page (approved)

Contains only:

1. Office Card
2. Add Opportunity
3. Operations Center

No bottom navigation. No separate deals page. No standalone settings button.

Visual language: Arabic, RTL, mobile-first, clean white background, light green accents, dark green headings, rounded cards, soft shadows, spacious, simple.

## Office Card

Shows: logo, cover/display image, office name, broker name, license number, city, approved services summary.

Office Settings opens when the broker clicks the **office logo** or **office cover/display image**. No visible standalone “Office Settings” button.

## Office Settings (approved sections)

1. Visual identity — logo, display image, wide WhatsApp-compatible cover (upload, preview, crop, replace, remove when allowed, save, validation, loading/error). Cover crop ratio is a configurable design setting.
2. Office data — office name, broker name, license number, city, mobile number. **No email field.**
3. Unique office name — ≥4 visible characters, system-wide uniqueness via normalized key, Arabic/Latin, race-safe backend enforcement, clear Arabic validation. Stable handle/slug for URL when needed.
4. Office link — copy, share, QR, preview.
5. Notifications — match, owner/customer, cooperation, message, appointment/follow-up, important system. Per office (and broker when needed). Preserve FCM.
6. Opportunity Bank entry — “بنك الفرص” opens private bank; not a permanent home section.
7. Smart cooperation — DISABLED / APPROVAL_REQUIRED (default) / SMART_AUTOMATIC. Automatic mode must not expose private contacts automatically.

## Tenant isolation

Every office-scoped record includes `officeId`. No cross-office read/modify/query/infer except via explicit approved cooperation, with minimum necessary exposure. Firestore rules and backend authorization enforce isolation; UI hiding is insufficient.

## Opportunity model (summary)

Unified Opportunity from all sources. Internal lifecycle statuses are implementation details. Do not show labels like «فرصة مرصودة / قيد المتابعة / غير مطابقة». No-match opportunities are saved silently in the Opportunity Bank without creating an Operations item solely for storage.

## Operations Center

Actionable work only. No static decorative tasks, fake demo cards in production, every saved opportunity, queue events, or technical logs.

## Cooperation and ownership

Modes: DISABLED, APPROVAL_REQUIRED, SMART_AUTOMATIC. Ownership never transfers by cooperation alone. Visible statuses: لم تُشارك، بانتظار الموافقة، تعاون نشط، رُفض الطلب، انتهى التعاون. No automatic commission/financial decisions.

## Integrations honesty

WhatsApp/Telegram are not “production connected” without credentials, webhooks, validation, delivery handling, and real tests. Default outbound: draft → broker review → broker send.

## Security

No client API keys/secrets in repo. Validate types/sizes. Check `officeId` on sensitive actions. Least privilege. Do not weaken Firestore rules for convenience.

## Phased delivery

Phases 0–8 are defined in `docs/IMPLEMENTATION_PLAN.md`. Complete Definition of Done per phase before claiming completion.
