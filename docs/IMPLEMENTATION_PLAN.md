# IAQAR.AI Implementation Plan

## Phase 0 - Foundation and audit

Status: completed for this run.

Completed:

- Inspected repository structure.
- Identified Firebase Hosting, Firestore rules, PWA/FCM, and worker architecture.
- Identified existing tests.
- Created required governance documentation.
- Created persistent Cursor project rule.

Findings:

- Office profile/settings existed partially before this run.
- Office name uniqueness existed through `officeNameClaims`, but rules allowed an update path that could transfer a claim; this was tightened.
- The UI included a visible `الصفقات` card and static demo operations; these conflicted with the constitution and were removed from the home page.
- Internal legacy `deals` collection/code remains and requires a future approved migration or containment plan.

## Phase 1 - Office Card and Office Settings

Status: implemented with documented limitations.

Completed:

- Logo click opens Office Settings.
- Cover/display image click opens Office Settings.
- Visible standalone settings label removed.
- Logo upload, preview, crop-to-square, and save.
- Cover upload, preview, configurable crop preset, and save.
- Wide sharing/WhatsApp-style cover upload, preview, configurable crop preset, and save.
- Office data fields: office name, broker name, license number, city, mobile number.
- No visible email field.
- Office name minimum length validation.
- System-wide normalized name claim transaction retained.
- Firestore rules tightened for office-name claim update.
- Office link copy/share/preview and QR.
- Notification preferences saved on the office document.
- Opportunity Bank entry added with private read-only preview.
- Smart cooperation mode saved on the office document.
- Arabic RTL layout preserved.
- Static Phase 1 tests added.

Limitations:

- Emulator-based Firestore security tests are not configured.
- Opportunity Bank full management is Phase 3.
- Notification routing according to new preferences remains Phase 5.
- Cooperation workflows remain Phase 6.
- Unified opportunity intake remains Phase 2.

## Later phases

### Phase 2 - Unified Opportunity Intake

Implement unified text/link/file intake, source persistence, extraction adapter boundaries, missing-data flow, deduplication, and tests.

### Phase 3 - Opportunity Bank

Implement private bank list/details, edit/archive/delete rules, sharing, scoped bank-sharing model, and tenant-isolation tests.

### Phase 4 - Matching Engine

Implement/verify eligibility, scoring, idempotency, automatic rematching, and exact-one-match tests.

### Phase 5 - Operations Center and Notifications

Replace legacy alert/workflow surfaces with approved Operation records and notification routing that respects preferences.

### Phase 6 - Cooperation

Implement cooperation requests, approvals, revocation, permissions, and ownership preservation.

### Phase 7 - Smart Messages and Integration Adapters

Implement Arabic message drafts, WhatsApp/Telegram adapter contracts, webhook validation, local fixtures, and honest integration states.

### Phase 8 - Hardening

Run full security review, tenant isolation tests, performance checks, retry/error handling review, accessibility, mobile, PWA, and end-to-end acceptance suite.
