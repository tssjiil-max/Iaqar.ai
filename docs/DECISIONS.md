# IAQAR.AI — Architecture Decision Record

Version 1.0 · Records approved architecture decisions and open questions. Add a
new entry (never rewrite history) for each significant decision.

## D‑001 — Keep the buildless static PWA stack

**Context:** Directive forbids framework/DB/hosting/state migration without
approval. **Decision:** Preserve the vanilla‑JS static PWA + Firebase Hosting +
Firestore + FCM + Cloudflare Worker (R2). **Consequence:** Frontend automated
tests target extracted pure functions (`public/js/office-lib.js`) rather than a
component test runner.

## D‑002 — Office name uniqueness enforced at the database level

**Decision:** Uniqueness uses a Firestore transaction over
`officeNameClaims/{officeNameKey}` plus rule validation, so equivalent names
cannot be double‑claimed under a race. Frontend validation is advisory only.

## D‑003 — Ownership fields are immutable in rules

**Decision:** `firestore.rules` rejects any update that changes `ownerUid` or
`officeId` on `offices/{officeId}` unless the caller is a platform admin. This
closes a mass‑assignment/ownership‑hijack gap (Directive §25) without weakening
tenant isolation.

## D‑004 — Cover crop ratio is a configurable design setting

**Context:** Directive §7.1 forbids hard‑coding an external platform's image
dimensions. **Decision:** `IAQAROfficeLib.COVER_CROP_RATIO` (default 1200×630,
≈1.91:1, WhatsApp/OpenGraph‑friendly) drives the crop workflow, so the ratio can
change without rewriting the upload code.

## D‑005 — Logo + cover images (display image folded into cover for now)

**Context:** Directive §7.1 lists logo, display image, and a wide WhatsApp cover.
**Decision (Phase 1):** Ship two images — **logo** and **cover** — where the
cover serves as both display image and (via the configurable crop ratio) the wide
WhatsApp cover. A distinct third "display image" can be split out later if the
owner requires it; the upload workflow is written generically to allow that.
**Status:** Open for owner confirmation.

## D‑006 — Keep `whatsapp` number and `specialties` fields in Office Settings

**Context:** Directive §7.2 lists only name/broker/license/city/mobile as visible
fields, but the existing approved product also stores a WhatsApp number and
office specialties (services summary), and the directive also says not to remove
working/approved functionality. **Decision:** Retain the WhatsApp number
(required for messaging/office link) and specialties (they power the "approved
services summary" on the Office Card per §6). No email field is shown.
**Status:** Open for owner confirmation.

## D‑007 — Legacy Deals toggle + static demo cards deferred, not silently changed

**Context:** §5/§16/§21 forbid a Deals page, static demo operations, and a
bottom nav. The current home page has an `الفرص/الصفقات` toggle and a static
demo operations array. **Decision:** Because removing them cleanly depends on the
Operations Center (Phase 5) and unified intake (Phase 2), they are **documented
as violations and deferred** to those phases rather than partially removed now
(which would break the workspace). No new deals functionality was added.
**Status:** Tracked; to be resolved in Phase 5.

## D‑008 — Opportunity Bank entry only in Phase 1

**Decision:** Phase 1 adds the `بنك الفرص` entry point in Office Settings but not
the full bank (list/detail/edit/share/scoped sharing), which is Phase 3.

## Open questions for the project owner

1. Confirm D‑005 (two images vs. three distinct images).
2. Confirm D‑006 (retain WhatsApp number + specialties in settings).
3. Approve the Phase 5 plan to remove the legacy Deals toggle and static demo
   cards (D‑007).
