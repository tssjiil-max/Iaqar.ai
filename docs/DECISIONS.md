# IAQAR.AI — Architecture & Product Decisions (ADR log)

Records approved decisions and open points. Newest first.

## D‑0007 — Pre‑existing "الصفقات" (Deals) home card left in place for Phase 1
- **Phase:** 1 (finding), resolution deferred to Phase 2/5
- **Finding:** `public/index.html` has a `main-sections` toggle with an
  `data-main="deals"` card labelled "الصفقات", and the home page does not yet
  match the approved Section 5 layout (Office Card + Add Opportunity + Operations
  Center). This predates the directive.
- **Decision:** Not changed in Phase 1. Removing the Deals card and restructuring
  the home sections is coupled to Add Opportunity (Phase 2) and the Operations
  Center (Phase 5) and to `workflow-office.js` deals logic; doing it now would be
  an uncontrolled, out‑of‑scope change (Section 28/31). There is **no** bottom
  navigation bar (Test 2 passes).
- **Requested:** Address the Deals card + home‑section layout during the Add
  Opportunity / Operations Center phases per Section 5 and Section 21.

## D‑0006 — Cover crop implemented as configurable, deterministic center‑crop
- **Phase:** 1
- **Decision:** The cover image is cropped to a configurable aspect ratio
  (`COVER_ASPECT`, default WhatsApp‑style wide `1.91:1`) via a deterministic
  center‑crop on canvas, then uploaded. The ratio is a single design constant in
  `public/js/office-core.js`, so it can change without rewriting the upload flow.
- **Why:** Section 7.1 forbids hard‑coding an external platform's dimensions and
  requires the crop ratio to be a configurable design setting. A full interactive
  drag/zoom cropper is deferred as it is not required to satisfy the directive.

## D‑0005 — Notification preferences & cooperation mode stored on the office doc
- **Phase:** 1
- **Decision:** `notificationPreferences` (6 booleans) and `cooperationMode`
  (`disabled|approval_required|smart_automatic`, default `approval_required`) are
  stored on `offices/{officeId}` (private), **not** on public `publicOffices`.
- **Why:** Keeps private settings behind office‑member rules; avoids a new
  collection/index in Phase 1. May migrate to a dedicated `officeSettings/{id}`
  collection later per Section 23 with a migration plan.

## D‑0004 — Office logo stored in R2 like the cover
- **Phase:** 1
- **Decision:** Add Worker endpoint `POST /media/office-logo` and public read
  `GET /media/public/office-logos/{officeId}/logo`, mirroring the cover flow.
  `logoUrl` is stored on `offices/{officeId}` and mirrored to `publicOffices`.
- **Why:** Section 6/7.1 require an office‑specific logo with upload/replace/
  remove. Reuses the audited, authorized cover upload pattern.

## D‑0003 — Visible "إعدادات المكتب" label removed from the office‑logo button
- **Phase:** 1
- **Decision:** The logo button keeps its accessible name via an `aria-label`
  and a visually‑hidden span, but the visible "إعدادات المكتب" text label is
  removed. The office **cover** is also made a click/keyboard target that opens
  settings.
- **Why:** Section 6 forbids a visible standalone Office Settings button and
  requires both logo and cover to open settings with subtle, uncluttered
  feedback. Accessibility is preserved.

## D‑0002 — OPEN: dual phone + WhatsApp fields vs. single "Mobile number" (7.2)
- **Phase:** 1
- **Status:** OPEN — needs owner confirmation.
- **Context:** Section 7.2 lists visible office fields as name, broker, license,
  city, **mobile number** only. The existing UI has both a contact phone and a
  WhatsApp number; office card sharing and WhatsApp materials depend on the
  WhatsApp value.
- **Interim decision:** Retain both fields (removing WhatsApp would delete working
  functionality, also forbidden). No email field is present or added.
- **Requested:** Owner to confirm whether WhatsApp should remain a separate field,
  be merged with mobile, or be moved out of the visible settings.

## D‑0001 — Preserve the static‑PWA + Firebase + Cloudflare Worker stack
- **Phase:** 0
- **Decision:** No framework/DB/hosting/state‑management migration. Extend the
  existing vanilla‑JS front‑end, Firestore rules, and single Worker.
- **Why:** Section 1 forbids migrations without explicit owner approval and
  requires preserving working infrastructure.
