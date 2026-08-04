# IAQAR.AI — Architecture Decisions

Records approved decisions and future changes. Do not invent missing business decisions.

---

## ADR-001 — Keep Firebase + Cloudflare Worker stack

**Status:** Approved  
**Decision:** Preserve Firebase Auth/Firestore/FCM and Cloudflare Worker + R2.  
**Reason:** Existing working infrastructure; constitution forbids unapproved migrations.

## ADR-002 — R2 for office media (not Firebase Storage)

**Status:** Approved (existing)  
**Decision:** Office logo/cover/WhatsApp cover are stored in R2 via Worker `/media/*`.  
**Reason:** Already implemented for covers; extend same path for logo and WhatsApp cover.

## ADR-003 — Configurable WhatsApp cover crop ratio

**Status:** Approved (Phase 1)  
**Decision:** Cover crop aspect ratio lives in `shared/office-design.js` as `whatsappCoverCropRatio` (default `1.91`).  
**Reason:** Constitution forbids hard-coding unverified external dimensions into the upload workflow.

## ADR-004 — Office name uniqueness via claims + rules

**Status:** Approved (Phase 1 hardening)  
**Decision:** Normalized key in `officeNameClaims/{officeNameKey}`; client transaction + Firestore rules that allow create only when missing and update only for the same `officeId`.  
**Reason:** Prevent race-condition duplicates; do not rely on frontend alone.

## ADR-005 — Cooperation mode stored on office profile

**Status:** Approved (Phase 1 setting only)  
**Decision:** `cooperationMode` ∈ `DISABLED` | `APPROVAL_REQUIRED` | `SMART_AUTOMATIC`; default `APPROVAL_REQUIRED`.  
**Reason:** Phase 1 delivers preference control; full cooperation workflow is Phase 6.

## ADR-006 — Notification preferences on office profile

**Status:** Approved (Phase 1)  
**Decision:** Persist `notificationPreferences` on `offices/{officeId}`; keep existing FCM device enable/disable.  
**Reason:** Constitution requires category prefs; device transport remains FCM.

## ADR-007 — Opportunity Bank entry without home section

**Status:** Approved (Phase 1)  
**Decision:** Settings card **بنك الفرص** opens a private bank sheet; not a fourth home section.  
**Reason:** Constitution Sections 5 and 7.6.

## ADR-008 — Deals main card deferred

**Status:** Open / tracked  
**Decision:** Phase 1 does not remove the historical `data-main="deals"` card to avoid uncontrolled UI redesign mid-phase. Constitution forbids a deals page; remediation planned with Operations Center work (Phase 5) under owner approval.  
**Reason:** “Do not remove working code merely for preference” vs “no deals page” — needs owner-confirmed migration of workflow labels.

## ADR-009 — WhatsApp outbound remains disabled

**Status:** Approved (existing)  
**Decision:** Worker blocks send routes; broker-initiated `wa.me`/share only.  
**Reason:** Production honesty; no fake delivery success.

## Future decisions needed (do not guess)

- Commission/financial entitlement features (explicitly out of scope until approved).
- Exact public bank-sharing permission matrix beyond read-only defaults.
- Whether historical `deals` collection is renamed or only hidden from UI.
