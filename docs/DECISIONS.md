# IAQAR.AI — Architecture Decisions

## ADR-001 — Constitution authority

**Decision:** Master Engineering Directive v1.0 is the project constitution.  
**Consequence:** No redesign, stack migration, or invented business rules without owner approval.

## ADR-002 — Preserve existing stack

**Decision:** Keep Firebase Auth/Firestore/FCM, Cloudflare Worker + R2, static PWA frontend.  
**Reason:** Working infrastructure already deployed in this shape.

## ADR-003 — Phase 1 does not restructure home sections

**Decision:** Phase 1 improves Office Card (logo/cover → settings) and Office Settings content without replacing الفرص/الصفقات/مساحة العمل with the constitution’s Add Opportunity + Operations Center layout.  
**Reason:** Constitution forbids uncontrolled redesign; home restructure needs explicit approval after Phase 1 report.  
**Follow-up:** Owner-approved home alignment task (related to TEST 14).

## ADR-004 — Office name uniqueness via claims collection

**Decision:** Continue using `officeNameClaims/{officeNameKey}` with client transaction + Firestore rules.  
**Reason:** Already connected and race-aware.

## ADR-005 — Configurable cover crop presets

**Decision:** Store crop presets in `office-profile-core.js` (`COVER_CROP_PRESETS`) so WhatsApp-wide ratio can change without rewriting upload workflow.  
**Default WhatsApp wide preset:** `1.91:1` (configurable constant, not hard-coded across UI).

## ADR-006 — Mobile field vs WhatsApp field

**Decision:** Settings UI shows one mobile number field per constitution §7.2; persist `whatsapp` mirrored from `phone` for existing card/share paths.  
**Reason:** Avoid breaking share/card flows that already read `whatsapp`.

## ADR-007 — Opportunity Bank entry only in Phase 1

**Decision:** Settings shows “بنك الفرص” opening a private office-scoped list/empty state. Full bank sharing/edit rules are Phase 3.  
**Reason:** Phase boundary in directive §28.

## ADR-008 — Cooperation mode preference in Phase 1

**Decision:** Persist `cooperationMode` with default `APPROVAL_REQUIRED`. Enforcement of requests/revocation is Phase 6.  
**Reason:** Phase 1 deliverable is preference controls only.

## Phase 0 audit classifications (summary)

| Feature | Classification | Evidence |
|---------|----------------|----------|
| Firebase Auth + office gate | REAL AND CONNECTED | `access-gate.js`, Worker auth |
| Firestore tenant paths | REAL AND CONNECTED | `firebase-office.js`, rules |
| Office settings open via logo | PARTIAL | `#officeSettingsBtn`; cover click missing; visible “إعدادات المكتب” text |
| Cover upload R2 | REAL AND CONNECTED | Worker `/media/office-cover` |
| Logo upload | MISSING | Only cover endpoint |
| Cover crop UI + configurable preset | PARTIAL | Canvas cover-fit in card export only |
| Unique office name | REAL AND CONNECTED | `reserveOfficeName` + `officeNameClaims` |
| Email in settings | ABSENT (good) | No email input in settings form |
| Office link copy | REAL AND CONNECTED | `copyOfficeLinkBtn` |
| Link share / QR display / preview | PARTIAL | Share card+QR in PNG; no dedicated QR/preview controls |
| Granular notification prefs | MISSING | Device FCM toggle only |
| Opportunity Bank entry | MISSING | — |
| Cooperation mode | MISSING | — |
| Matching engine | PARTIAL | Worker + UI |
| Operations Center | PARTIAL / DEMO MIX | Live snapshots + local demo seed |
| Deals home card | CONFLICT WITH CONSTITUTION | `data-main="deals"` |
| Bottom nav | ABSENT (good) | No bottom nav bar |
| FCM | PARTIAL | Connected registration/send paths; needs live credentials to call production-complete |
| WhatsApp API | PARTIAL / ADAPTER READY | Meta routes; honesty labels required |
| Automated frontend tests | MISSING | Only `worker/test/worker.test.mjs` |
