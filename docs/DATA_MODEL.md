# IAQAR.AI Data Model

This document records observed and approved data domains. Existing names are preserved unless a future approved migration changes them.

## Observed collections and documents

### `offices/{officeId}`

Private office profile and settings.

Important fields:

- `officeId`
- `ownerUid`
- `officeName`
- `officeNameKey`
- `brokerName`
- `licenseNumber`
- `city`
- `phone`
- `whatsapp`
- `specialties`
- `logoUrl`
- `coverUrl`
- `whatsappCoverUrl`
- `publicSlug`
- `notificationPreferences`
- `cooperationMode`
- `visualIdentity`
- `updatedAt`

Access:

- Read: office member/admin only.
- Update: office manager/owner/platform admin only.
- Phase 1 rules restrict mutable profile/settings keys and preserve `officeId`.

### `offices/{officeId}/members/{uid}`

Office membership and roles.

### `publicOffices/{officeId}`

Public-safe office link metadata.

Important fields:

- `officeId`
- `officeName`
- `brokerName`
- `phone`
- `whatsapp`
- `licenseNumber`
- `city`
- `specialties`
- `logoUrl`
- `coverUrl`
- `whatsappCoverUrl`
- `publicSlug`
- `updatedAt`

Access:

- Read: public.
- Write: manager/owner/platform admin for the same office.

### `officeNameClaims/{officeNameKey}`

System-wide normalized office-name uniqueness claim.

Important fields:

- `officeId`
- `ownerUid`
- `officeName`
- `updatedAt`

Access:

- Read: signed-in users.
- Create: signed-in user who can manage or is creating the resulting office.
- Update: only when the existing claim remains assigned to the same `officeId`.

### Existing office subcollections

Observed in code:

- `owners`
- `clients`
- `opportunities`
- `matches`
- `alerts`
- `devices`
- `inbox`
- `publicIntake`
- `deals` (legacy/internal observed name; do not expose as a separate broker-facing page)

All office-scoped records must include `officeId` when written unless a future audited tenant mechanism explicitly replaces that invariant.

## Indexes

Observed indexes are defined in `firestore.indexes.json` for:

- `matches` by `status`, `createdAt`.
- `matches` by `status`, `nextFollowUpAt`.
- `matches` by `matchGroupId`, `updatedAt`.
- `alerts` by `status`, `createdAt`.
- `deals` legacy/internal indexes.

No new Phase 1 indexes were added.

## Phase 1 schema changes

Added/standardized office fields:

- `logoUrl`
- `whatsappCoverUrl`
- `notificationPreferences`
- `cooperationMode`
- `visualIdentity.coverCropY`
- `visualIdentity.whatsappCoverCropY`

No collection rename or migration was performed.
