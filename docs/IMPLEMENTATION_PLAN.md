# IAQAR.AI — Implementation Plan

## Current Status: Phase 0 + Phase 1 IN PROGRESS

---

## Phase 0 — Foundation and Audit ✅

### Completed
- [x] Repository inspection and architecture mapping
- [x] Feature classification (REAL / PARTIAL / MOCK / MISSING / BROKEN)
- [x] Security risk identification
- [x] Existing test inventory
- [x] docs/PROJECT_CONSTITUTION.md
- [x] docs/SYSTEM_ARCHITECTURE.md
- [x] docs/DATA_MODEL.md
- [x] docs/EVENT_WORKFLOW.md
- [x] docs/ACCEPTANCE_TESTS.md
- [x] docs/IMPLEMENTATION_PLAN.md (this file)
- [x] docs/DECISIONS.md
- [x] .cursor/rules/iaqar-project-constitution.mdc

---

## Phase 1 — Office Card and Office Settings

### Deliverables Checklist

#### Office Card
- [ ] Logo click opens Office Settings (was present, confirmed)
- [ ] Cover image displayed on office card (NEW)
- [ ] Cover image click opens Office Settings (NEW)
- [ ] Remove visible "إعدادات المكتب" text from logo button (FIX)

#### Visual Identity (in Settings)
- [ ] Logo upload with preview
- [ ] Logo replace/remove
- [ ] Cover upload with preview (existing, enhanced)
- [ ] WhatsApp-compatible wide cover crop ratio hint (1.91:1)
- [ ] Cover crop ratio stored as configurable constant (COVER_ASPECT_RATIO)
- [ ] File type validation (JPG/PNG/WebP)
- [ ] File size validation (≤10MB)
- [ ] Loading state during upload
- [ ] Error state on upload failure

#### Office Data (in Settings)
- [ ] Office name (existing)
- [ ] Broker name (existing)
- [ ] License number (existing)
- [ ] City (existing)
- [ ] Mobile number (existing)
- [ ] No email field (COMPLIANT — no changes needed)
- [ ] Min 4-char validation (frontend + Firestore rules — EXISTING)
- [ ] Normalized unique name (existing via transaction)

#### Office Link (in Settings)
- [ ] Copy link (existing)
- [ ] Native share button (NEW)
- [ ] QR code display (NEW)

#### Notification Preferences (in Settings)
- [ ] Match notifications toggle
- [ ] Owner/customer notifications toggle
- [ ] Cooperation notifications toggle
- [ ] Message notifications toggle
- [ ] Appointment notifications toggle
- [ ] System notifications toggle
- [ ] Save preferences to Firestore (notificationPrefs field)
- [ ] Load preferences from Firestore on settings open

#### Opportunity Bank Entry (in Settings)
- [ ] "بنك الفرص" card/button visible in settings

#### Cooperation Settings (in Settings)
- [ ] Mode selector: disabled / approval_required / smart_automatic
- [ ] Save mode to Firestore (cooperationMode field)
- [ ] Load mode from Firestore on settings open

#### Quality
- [ ] Correct Arabic RTL behavior throughout
- [ ] Mobile-first layout
- [ ] officeId isolation enforced
- [ ] Loading, success, empty, and error states
- [ ] Automated tests for Phase 1

### Files to Create/Modify
| File | Change Type | Description |
|------|-------------|-------------|
| public/index.html | MODIFY | Office card + settings HTML restructure |
| public/js/office-settings.js | MODIFY | Logo upload, QR, share, prefs, cooperation |
| worker/src/index.js | MODIFY | Add /media/office-logo endpoint |
| tests/phase1.test.mjs | CREATE | Phase 1 acceptance tests |
| docs/ (all) | CREATE | Governance documents |
| .cursor/rules/ | CREATE | Project constitution rule |

### Database Changes
- offices/{officeId}: Add `logoUrl`, `cooperationMode`, `notificationPrefs` fields
- New Firestore index: not required for Phase 1

### Security Rule Changes
- No changes required for Phase 1 (existing rules cover new fields via merge pattern)
- New fields added via authorized manager writes, covered by existing `canManage()` check

---

## Phase 2 — Unified Opportunity Intake (PENDING APPROVAL)

### Scope
- Unified input field (text/URL)
- Attachment chooser (paperclip icon)
- Source persistence to Firestore
- Opportunity normalization and deduplication
- Missing-data collection flow
- Worker-side analysis pipeline

**Dependencies:** Phase 1 complete and approved.

---

## Phase 3 — Opportunity Bank (PENDING APPROVAL)

### Scope
- Private office bank UI
- Essential opportunity list/details
- Date added + cooperation status visible
- Edit/archive/delete per rules
- Single and selected sharing model

**Dependencies:** Phase 2 complete.

---

## Phase 4 — Matching Engine (PENDING APPROVAL)

### Scope
- Full eligibility + scoring engine in Worker
- Idempotent match creation
- Automatic rematching on relevant events
- Match reasons and confidence scores

**Dependencies:** Phase 3 data model established.

---

## Phase 5 — Operations Center and Notifications (PENDING APPROVAL)

### Scope
- Formal operations/{id} collection
- Formal notifications/{id} collection
- Replace client-derived items with Firestore-backed operations
- FCM routing with preference checks

**Dependencies:** Phase 4 matching engine.

---

## Phase 6 — Cooperation (PENDING APPROVAL)

### Scope
- cooperations/{id} collection
- Request/accept/reject/revoke flows
- Ownership preservation
- Contact information hiding

**Dependencies:** Phase 5.

---

## Phase 7 — Smart Messages and Integration Adapters (PENDING APPROVAL)

### Scope
- Arabic message templates
- WhatsApp adapter contract (production-ready when credentials provided)
- Telegram adapter contract
- Webhook validation
- Honest integration state labeling

**Dependencies:** Phase 6 (for cooperation context in messages).

---

## Phase 8 — Hardening (PENDING APPROVAL)

### Scope
- Full security audit
- Tenant isolation tests
- Performance and indexes review
- Accessibility audit
- Mobile testing
- PWA validation
- End-to-end acceptance test suite

**Dependencies:** All previous phases approved.

---

## Known Risks

### Technical
1. Cloudflare Worker deployment requires separate `wrangler deploy` step
2. Firebase hosting deployment requires separate `firebase deploy` step
3. WhatsApp production credentials not configured (META_APP_ID empty) — no production messaging
4. FCM vapid key not configured in wrangler.toml (FCM_WEB_PUSH_VAPID_KEY empty)

### Data Model
1. Current matching is purely from publicIntake documents; Phase 4 needs migration to opportunities collection
2. Deal records currently bypass the approved event flow (created directly by Worker actions)

### UI
1. "الصفقات" section on home page needs to be addressed (violates Sections 5 and 21)
   — This is a design decision: the Operations Center can show deal-related operations without a separate "deals" button
   — Recommended: remove the "الصفقات" button from main-sections; all deal operations appear in the unified Operations Center
   — DECISION PENDING: whether to remove in Phase 1 or Phase 5 restructure
