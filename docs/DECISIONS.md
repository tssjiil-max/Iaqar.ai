# IAQAR.AI — Decision Log

Approved architecture decisions and open points awaiting the project owner. Newest last.
Format: ID, status (DECIDED / OPEN), context, decision/question.

## D-001 — Keep the existing stack and Worker name — DECIDED
The directive mandates preserving Firebase (Auth/Firestore/FCM), the Cloudflare Worker,
R2 media storage, and the PWA frontend. The Worker keeps its legacy name
`iaqar-macrodroid-intake` because the production Meta webhook URL points at it; the
legacy `/ingest` route stays disabled (HTTP 410).

## D-002 — Office name uniqueness mechanism — DECIDED (pre-existing, verified)
Uniqueness is enforced by `officeNameClaims/{nameKey}` claimed inside the same Firestore
transaction that writes the office document, with `nameKey` = NFKC-lowercased name
stripped of spaces/punctuation (Arabic + Latin). Rules require the claimer to manage the
office and `nameKey.size() >= 4` (platform admin exempt). This satisfies directive §7.3
including race-condition safety; no rework needed.

## D-003 — Cover crop ratio as configuration — DECIDED (Phase 1)
The wide "WhatsApp-style" cover crop is implemented as a configurable design setting
(`COVER_CROP_PRESET` in `public/js/office-settings.js`: ratio 1.91:1, adjustable without
touching the upload workflow). No external platform's dimensions are hard-coded as
requirements (directive §7.1).

## D-004 — «الصفقات» tab and PWA deals shortcuts removal timing — DECIDED (sequencing), scope pre-approved by directive
Directive §21 forbids a deals page and §5 defines the 3-part home page. The existing
home page still has the «الفرص/الصفقات» tabs and manifest shortcuts wired into the
working workflow code (deal records stream into the workspace list). Removing them in
Phase 1 would orphan working functionality mid-phase (violating §1.4) without providing
the approved replacement (Add Opportunity — Phase 2; Operations Center — Phase 5).
Decision: keep them temporarily, report acceptance TEST 14 as FAIL honestly, and remove
them within the Phase 5 restructure. The owner may order earlier removal.

## D-005 — Dead file `public/js/public-intake.js` — OPEN
This older public-intake page is no longer referenced by `index.html` (superseded by
`access-gate.js`). Proposal: delete in Phase 2 when the intake surface is reworked.
Not deleted yet per §1.4 (do not remove code without need) — awaiting owner
confirmation.

## D-006 — WhatsApp number field in Office Settings — OPEN
Directive §7.2 lists the visible office-data fields as: office name, broker name,
license number, city, mobile number (and explicitly bans only the email field). The
existing approved interface also contains «رقم واتساب», which feeds the office share
card and the broker-initiated wa.me drafts. Removing it would degrade approved working
functionality (§1.4). Decision taken for Phase 1: keep the field unchanged and flag the
conflict here. Owner ruling requested: keep, or fold into the mobile number.

## D-007 — Static demo operations removed — DECIDED (Phase 1)
The home-page inline script seeded six hard-coded demo operations (A1/M1/F1/M2/D1/D2)
that rendered until live data replaced them. Directive §1.6 and §16 forbid static demo
operations and fake cards in production. They were removed; the list now starts empty
with an honest Arabic empty state and fills only from live Firestore data.

## D-008 — Notification preferences scope — DECIDED (Phase 1) / per-broker OPEN
Preferences are stored per office in `offices/{officeId}.notificationPreferences`
(six categories per directive §7.5) and enforced in the Worker before any push
(`isNotificationTypeEnabled`). The explicit user-triggered activation test
(`notification_test`) is always delivered. Per-broker preferences become meaningful when
multi-broker offices ship (members already exist, but all current pushes are
office-wide); the storage key (`brokers/{uid}.notificationPreferences`) is reserved —
implementation deferred until that phase.

## D-009 — Phase 1 Opportunity Bank entry shows a real minimal list — DECIDED (Phase 1)
Directive Phase 1 requires only the «بنك الفرص» entry inside Office Settings. To avoid
a fake destination (§1.7), the entry opens a real read-only list backed by the existing
`offices/{officeId}/opportunities` collection, showing essential identification fields
plus only the approved activity summary (date added + cooperation status, default
«لم تُشارك»). Editing, sharing, archiving, and scoped bank sharing remain Phase 3.

## D-010 — Office logo upload endpoint mirrors the cover endpoint — DECIDED (Phase 1)
`POST /media/office-logo` (manager auth, jpeg/png/webp, ≤ 5 MB) stores
`office-logos/{officeId}/logo` in R2, served via `GET /media/public/office-logos/…`.
Cover/logo removal uses `POST /media/office-cover/delete` / `/media/office-logo/delete`
(manager auth) so the CORS method list stays GET/POST/OPTIONS.
