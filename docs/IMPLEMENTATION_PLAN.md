# IAQAR.AI — Implementation Plan

## Phases

| Phase | Scope | Dependencies | Status |
|-------|-------|--------------|--------|
| 0 | Repo audit, governance docs, Cursor rule | None | DONE in this run |
| 1 | Office Card + Office Settings | Phase 0 | IN PROGRESS → complete this run |
| 2 | Unified opportunity intake | Phase 1 | Blocked on owner approval |
| 3 | Opportunity Bank | Phase 2 | Pending |
| 4 | Matching engine | Phase 2–3 | Pending |
| 5 | Operations Center + notifications | Phase 4 | Pending |
| 6 | Cooperation | Phase 1 mode + Phase 3–5 | Pending |
| 7 | Smart messages + adapters | Phase 5–6 | Pending |
| 8 | Hardening + full acceptance suite | All prior | Pending |

## Risks

1. **Home UI mismatch:** Current الفرص/الصفقات cards conflict with constitution home. Changing them is a deliberate UX change — defer until owner approval after Phase 1.
2. **Demo operations seed** in `index.html` can look like production work items — must not be claimed as live Operations Center.
3. **WhatsApp production** depends on Meta credentials; keep honesty labels.
4. **Name uniqueness** relies on `officeNameClaims` transactions + rules; keep both.
5. **Large inline assets** in `index.html` (data URIs) make HTML edits fragile — prefer surgical scripts.

## Progress (this run)

- Phase 0 audit documented in `docs/DECISIONS.md`.
- Phase 1 implemented: logo/cover → settings, visual identity (logo/cover/WhatsApp cover + crop presets), office data (no email), name uniqueness, link copy/share/QR/preview, notification preferences, Opportunity Bank entry, cooperation mode, Worker media endpoints, automated tests.
- **Stop gate:** Do not start Phase 2 without owner approval of the Phase 1 report.
- Known limitation: home still has الفرص/الصفقات cards (TEST 14 FAIL / ADR-003).
