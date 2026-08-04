# IAQAR.AI — Acceptance Tests

Version 1.0 · The acceptance scenarios from the Master Engineering Directive
(§27). Status is tracked per phase. A scenario is PASS only when it is actually
verified (connected code path, persisted data, enforced access control, passing
automated test, and no fake data) — never merely because code exists.

| # | Scenario | Verified by | Status |
|---|----------|-------------|--------|
| 1 | Office Settings opens on logo click **and** on cover click; no separate Settings button | Manual + `tests/office-settings.test.mjs` (open‑target wiring), DOM markup | Phase 1 |
| 2 | Approved home page has **no bottom navigation bar** | Markup review | Partial (no bottom nav exists; home still shows a legacy `الفرص/الصفقات` toggle — see §14) |
| 3 | Office name < 4 chars rejected; normalized duplicate rejected; unique accepted; DB‑level race protection | `tests/office-settings.test.mjs` + `officeNameClaims` transaction + `firestore.rules` | Phase 1 |
| 4 | Office A cannot read/query/modify/download Office B data | `firestore.rules` + Worker `authorizeOfficeRequest` | Ongoing (rules present; formal isolation tests in Phase 8) |
| 5 | URL/text via unified field; attachment via paperclip; one Opportunity created/updated | — | Phase 2 |
| 6 | Valid Opportunity with no match stored in office Opportunity Bank; no Operation created just for saving | — | Phase 2/3 |
| 7 | Stored offer + later compatible request → matching runs automatically | — | Phase 4 |
| 8 | Compatible pair → exactly one current Match per matching/data version; no dup on reprocess | — | Phase 4 |
| 9 | Actionable Match → exactly one Operation for the correct office/broker | — | Phase 5 |
| 10 | Actionable Match → notification per broker preferences | — | Phase 5 |
| 11 | Shared Opportunity keeps originating office/broker as owners; cooperator gets only approved access | — | Phase 6 |
| 12 | Revoked cooperation removes future access per policy | — | Phase 6 |
| 13 | Match/communication Operation can generate an Arabic WhatsApp/Telegram draft; not marked sent until real send/response | — | Phase 7 |
| 14 | No separate Deals page or bottom‑nav item | Markup review | **FAIL (known):** a legacy `الصفقات` toggle + static demo deal cards still exist; scheduled for removal in Phase 5 (Operations Center) |
| 15 | Mock integrations clearly separated from production adapters; no fake WhatsApp/Telegram delivery success | Worker integration state labels | Ongoing |

## Phase 1 acceptance checklist

- [x] Clicking the office **logo** opens Office Settings.
- [x] Clicking the office **cover** opens Office Settings.
- [x] No visible standalone "Office Settings" button (logo/cover are the entry;
      label is screen‑reader‑only).
- [x] Office logo upload/update (preview, replace, remove, validation, loading,
      error states).
- [x] Office cover upload/update with a **configurable** wide/WhatsApp crop ratio.
- [x] Office data fields: office name, broker name, license number, city, mobile.
- [x] **No visible email field** in Office Settings.
- [x] Office name minimum 4 significant characters (validated).
- [x] System‑wide normalized name uniqueness (transaction + rules).
- [x] Office link copy / share / QR / public preview.
- [x] Notification preferences (6 approved categories) persisted per office.
- [x] Opportunity Bank entry card (`بنك الفرص`) inside Office Settings.
- [x] Smart cooperation mode selector (default `approval_required`).
- [x] Arabic RTL, mobile‑first layout preserved; `officeId` isolation preserved.
- [x] Loading / success / empty / error states.
- [x] Automated tests (frontend pure‑logic + worker media/rules helpers).
