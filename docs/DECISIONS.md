# Architecture Decisions

## ADR-001 — Preserve the existing platform

Status: Approved

Keep the static Firebase-hosted PWA, Firebase Authentication, Firestore,
Firestore Rules, FCM, Cloudflare Worker, and R2. No frontend framework,
database, hosting, or state-management migration is authorized.

## ADR-002 — Office-scoped hierarchy plus explicit `officeId`

Status: Approved

Office data remains under `offices/{officeId}` and each scoped child record also
stores `officeId`. Firestore rules and Worker authorization independently
enforce the boundary.

## ADR-003 — Atomic normalized office-name claims

Status: Approved for Phase 1

Use `officeNameClaims/{normalizedName}` as the system-wide uniqueness lock.
Profile save reserves the new claim, updates the office/public projection, and
releases the old claim in one Firestore transaction. Rules prohibit another
office from overwriting an existing claim.

Normalization uses NFKC, case folding for Latin text, removal of Arabic
tatweel/combining marks, and removal of separator/punctuation characters. The
display name is never silently changed.

## ADR-004 — Stable generated public handle

Status: Approved for Phase 1

Keep the existing generated `publicSlug` after first save, including after an
office rename. A hash of `officeId` avoids collisions for generated handles.
Editable vanity handles require a dedicated atomic claim and are deferred.

## ADR-005 — Browser crop, Worker validation, R2 identity objects

Status: Approved for Phase 1

The browser creates a cropped JPEG/WebP-compatible upload according to
centralized ratios. The Worker remains authoritative for authentication,
tenant, kind, type, and size validation. Existing cover URLs remain supported
as migration fallback.

## ADR-006 — Preferences on the office profile

Status: Approved for Phase 1

Store six boolean notification categories and cooperation mode on the office
profile. Push transport remains FCM. Cooperation mode alone never grants
cross-office access; explicit records and permissions belong to Phase 6.

## ADR-007 — No separate Deals product surface

Status: Approved

Legacy internal `deals` data and workflow code may remain for compatibility,
but the home page and PWA expose no Deals page or navigation item. Completion
is represented in the relevant operation/record.

## ADR-008 — Opportunity Bank entry precedes bank implementation

Status: Approved phase boundary

Phase 1 provides the private “بنك الفرص” entry inside Office Settings. Complete
bank list/detail/share/archive behavior remains Phase 3 and must not be
implemented early. Until then, the entry exposes an honest empty/not-yet-ready
state rather than fake records.

## Future decisions requiring approval

- Public slug lookup hardening and vanity-handle lifecycle.
- Public intake abuse limits and signed media-upload policy.
- Full Opportunity/Operation migration from legacy workflow collections.
- Cooperation permission vocabulary and revocation history retention.
- Provider-specific WhatsApp/Telegram outbound sending policy.
- Archive versus permanent deletion retention requirements.
