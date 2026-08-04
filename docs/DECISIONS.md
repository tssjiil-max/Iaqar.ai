# IAQAR.AI — Architecture Decisions

## ADR-001 — Preserve existing stack

**Status:** Accepted  
**Decision:** Continue with Firebase Auth/Firestore/FCM, Cloudflare Worker + R2, static PWA UI.  
**Rationale:** Directive forbids unapproved migrations; stack already hosts auth, media, matching, and notifications.

## ADR-002 — Office settings entry via logo and cover only

**Status:** Accepted  
**Decision:** Open Office Settings from office logo and office cover/display image clicks. No standalone settings button.  
**Rationale:** Approved home interaction model (Constitution §6).

## ADR-003 — Configurable cover crop ratio

**Status:** Accepted  
**Decision:** Store WhatsApp-compatible cover crop aspect ratio in `shared/office-profile.mjs` as `OFFICE_COVER_DESIGN.whatsappCoverAspectRatio` (initial value `1.91`).  
**Rationale:** Constitution forbids hard-coding unverified platform dimensions into the workflow; ratio must be updatable without rewriting upload flow.

## ADR-004 — Normalized office name claims

**Status:** Accepted  
**Decision:** Uniqueness via `officeNameClaims/{officeNameKey}` written in the same Firestore transaction as office profile updates; Worker broker approval also creates the claim; rules require claim ownership with `getAfter`.  
**Rationale:** Frontend-only checks are insufficient against races.

## ADR-005 — Notification preferences map on office document

**Status:** Accepted  
**Decision:** Persist category toggles on `offices/{officeId}.notificationPreferences` while keeping device FCM enable/disable via existing Worker `/fcm/register|unregister` path.  
**Rationale:** Preserve working FCM; add constitution-required categories without replacing the push stack.

## ADR-006 — Cooperation mode on office document

**Status:** Accepted  
**Decision:** Persist `cooperationMode` ∈ {`DISABLED`,`APPROVAL_REQUIRED`,`SMART_AUTOMATIC`} with default `APPROVAL_REQUIRED`. Phase 1 is settings-only; request/approval flows are Phase 6.  
**Rationale:** Phase boundary in the directive.

## ADR-007 — Opportunity Bank entry only in Phase 1

**Status:** Accepted  
**Decision:** Settings shows “بنك الفرص” opening a private office-scoped panel. Full edit/share/scope model is Phase 3.  
**Rationale:** Phase 1 requires entry; Phase 3 owns bank product depth.

## ADR-008 — Home «الصفقات» card deferred

**Status:** Open / deferred  
**Decision:** Do not remove the existing home `data-main="deals"` card in Phase 1 without owner confirmation, because it is existing UI and Phase 1 scope is Office Card/Settings. Constitution forbids a Deals page long-term.  
**Next:** Owner approval to replace with Add Opportunity + Operations Center-only home (Phase 2/5 alignment).

## ADR-009 — Phone field is the mobile number; WhatsApp field hidden

**Status:** Accepted  
**Decision:** Settings UI shows one mobile field; `whatsapp` is synced from `phone` on save for card/share backward compatibility. No email field in settings.  
**Rationale:** Constitution §7.2.
