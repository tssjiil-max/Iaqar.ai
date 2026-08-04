# IAQAR.AI — Implementation Plan

**Current authorized work:** Phase 0 + Phase 1  
**Do not start Phase 2 until the owner approves the Phase 1 report.**

---

## Phase status

| Phase | Name | Status |
|------:|------|--------|
| 0 | Foundation and audit | IN PROGRESS → complete in this run |
| 1 | Office Card and Office Settings | IN PROGRESS → complete in this run |
| 2 | Unified opportunity intake | NOT STARTED |
| 3 | Opportunity Bank | NOT STARTED (Phase 1 adds entry only) |
| 4 | Matching engine | NOT STARTED (existing Worker matching remains as-is) |
| 5 | Operations Center and notifications | NOT STARTED (prefs UI in Phase 1) |
| 6 | Cooperation | NOT STARTED (mode setting in Phase 1) |
| 7 | Smart messages and adapters | NOT STARTED |
| 8 | Hardening | NOT STARTED |

## Dependencies

- Phase 1 depends on existing Firebase Auth membership + R2 media Worker + Firestore office profile.
- Phase 2 depends on Phase 1 office identity/`officeId` stability.
- Phase 3 bank UX depends on Phase 2 unified Opportunity writes.
- Phase 5 operations should replace HTML demo seed operations.
- Phase 6 depends on cooperation mode from Phase 1 + ownership fields.

## Risks

1. **Demo operations seed** in `public/index.html` can appear as fake work until Phase 5 removes/gates it.
2. **`deals` main card** exists historically; constitution forbids a deals page — tracked for later compliance without Phase 1 redesign of Operations.
3. **`officeNameClaims` rules** were previously race-unsafe; Phase 1 hardens rules.
4. **Live FCM/Meta/R2** require cloud secrets; automated tests cannot prove production delivery.
5. **Broad Firestore catch-all** under offices remains a hardening item (Phase 8).

## Phase 1 deliverables checklist

- [x] Governance docs + Cursor rule
- [x] Logo/cover open settings (no standalone settings button)
- [x] Logo / display cover / WhatsApp cover upload workflow + configurable crop ratio
- [x] Office data fields without email
- [x] Unique normalized office name + rules enforcement
- [x] Office link copy / share / QR / preview
- [x] Notification preference categories
- [x] Opportunity Bank entry card
- [x] Smart cooperation mode control
- [x] Automated tests + Worker test suite

## Next recommended phase

**Phase 2 — Unified Opportunity Intake** after owner approval of this Phase 1 report.
