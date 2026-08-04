# IAQAR.AI — Architecture Decisions

## ADR-001: Frontend Technology (Vanilla JS SPA)
**Status:** Accepted (existing)  
**Decision:** Maintain vanilla HTML/CSS/JS without a framework.  
**Rationale:** Existing working system. Migration would require full rebuild. No approval for migration.  
**Consequence:** No component-based state management; all state via DOM and module-level variables.

## ADR-002: Backend on Cloudflare Worker
**Status:** Accepted (existing)  
**Decision:** Single Cloudflare Worker handles all server-side logic.  
**Rationale:** Existing working system with real endpoints.  
**Consequence:** No separate microservices. All backend logic in one Worker file.

## ADR-003: Firestore for Data
**Status:** Accepted (existing)  
**Decision:** Firestore as primary data store.  
**Rationale:** Existing working system. Firebase suite provides Auth + Firestore + FCM integration.  
**Consequence:** NoSQL document model; denormalization required for performance.

## ADR-004: R2 for Media Storage
**Status:** Accepted (existing)  
**Decision:** Cloudflare R2 for all file storage (office images, intake media).  
**Rationale:** Cost-effective, co-located with Worker for fast access. Existing infrastructure.  
**Consequence:** Media served through Worker endpoint (no direct R2 public URL used).

## ADR-005: Cover Aspect Ratio as Configurable Constant
**Status:** Decided in Phase 1  
**Decision:** Store `COVER_ASPECT_RATIO = 1.91` as a named constant in office-settings.js.  
**Rationale:** WhatsApp link preview standard is 1.91:1. This may change. Directive requires configurability without rewriting upload flow.  
**Consequence:** Changing the ratio requires only updating the constant value. No hard-coded dimensions in upload logic.

## ADR-006: Logo vs Cover — Separate Storage Paths
**Status:** Decided in Phase 1  
**Decision:** Logo stored at `logos/{officeId}/logo`, cover at `office-covers/{officeId}/cover`.  
**Rationale:** Different use cases (logo: square identity, cover: landscape display). Should be independently replaceable.  
**Consequence:** New Worker endpoint `/media/office-logo` added. Serves via `/media/public/office-logos/*`.

## ADR-007: Cooperation Mode Default
**Status:** Decided in Phase 1  
**Decision:** Default cooperation mode is `approval_required`.  
**Rationale:** Directive Section 7.7 explicitly specifies this default.  
**Consequence:** New offices have cooperation enabled but require manual approval of each request.

## ADR-008: Notification Preferences Default
**Status:** Decided in Phase 1  
**Decision:** All notification types default to `true` (enabled).  
**Rationale:** Brokers should receive all notifications by default; they opt out per type.  
**Consequence:** First-time offices receive all notification types until preferences explicitly changed.

## ADR-009: No Deals Page
**Status:** Decided  
**Decision:** Remove "الصفقات" permanent button from home page in Phase 1.  
**Rationale:** Directive Sections 5 and 21 explicitly prohibit a Deals page or bottom navigation.  
**Consequence:** Deal-related operations will appear in the unified Operations Center (mركز العمليات). No separate deals view.

## ADR-010: officeId in Every Document
**Status:** Accepted (existing pattern)  
**Decision:** Every office-scoped Firestore document must include `officeId` field even when the collection path already implies it.  
**Rationale:** Firestore rules use `request.resource.data.officeId == officeId` for create/update verification. Defensive programming against path-mismatch bugs.  
**Consequence:** Slightly redundant field, but essential for security enforcement.

## ADR-011: Opportunity Bank as Settings Entry Point
**Status:** Decided  
**Decision:** Opportunity Bank is accessed from a card within Office Settings, not as a permanent home page section.  
**Rationale:** Directive Section 7.6 explicitly requires this. Home page approved sections are Office Card + Add Opportunity + Operations Center only.  
**Consequence:** Bank implementation (Phase 3) opens as an overlay/page from within the settings.

## ADR-012: WhatsApp Integration Labeled "Adapter Ready"
**Status:** Accepted (existing + formalized)  
**Decision:** WhatsApp integration is labeled as "adapter ready" until real production credentials are configured.  
**Rationale:** Directive Section 10 prohibits claiming integration is complete without verified credentials.  
**Consequence:** UI shows accurate connection status. No fake delivery confirmations.

## PENDING DECISIONS

### PD-001: "الصفقات" Main Section Button
**Question:** Remove the "الصفقات" button in Phase 1 or wait for Phase 5 restructure?  
**Recommendation:** Remove in Phase 1. Violates Sections 5 and 21. Deal operations still appear in Operations Center.  
**Status:** PENDING OWNER APPROVAL
