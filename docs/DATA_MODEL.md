# IAQAR.AI Data Model

This document distinguishes collections already used by the repository from approved future domains. Existing stable collections are not renamed without a migration plan.

## Current Phase 1 collections

### `offices/{officeId}`

Private tenant profile. Readable only by office members.

| Field | Type | Notes |
|---|---|---|
| `officeId` | string | Required and immutable for client writes |
| `ownerUid` | string | Protected ownership field |
| `officeName` | string | 4–80 visible characters |
| `officeNameKey` | string | Backend-normalized global uniqueness key |
| `brokerName` | string | Visible office profile data |
| `licenseNumber` | string | FAL license number |
| `city` | string | Office city |
| `phone` | string | Office mobile number |
| `whatsapp` | string | Compatibility projection of `phone`; not a separate settings field |
| `specialties` | string[] | Existing approved-services values retained for Office Card display |
| `logoUrl` | string | Public R2 URL or empty |
| `displayImageUrl` | string | Public office display image URL or empty |
| `coverUrl` | string | Compatibility alias of `displayImageUrl` |
| `whatsappCoverUrl` | string | Wide sharing-material image URL or empty |
| `publicSlug` | string | Stable office URL handle |
| `notificationPreferences` | map | Six approved boolean categories |
| `cooperationMode` | enum | `DISABLED`, `APPROVAL_REQUIRED`, `SMART_AUTOMATIC` |
| `updatedAt` | timestamp | Last settings update |

`notificationPreferences` keys:

- `matches`
- `participants`
- `cooperation`
- `messages`
- `appointmentsFollowUps`
- `systemImportant`

### `publicOffices/{officeId}`

Public minimum office projection: identity images, office name, broker name, phone, license, city, approved services, and public slug. It excludes notification preferences, internal permissions, ownership, and cooperation controls. Clients can read it but cannot write it.

### `officeNameClaims/{normalizedName}`

Global atomic office-name reservation.

| Field | Type |
|---|---|
| `officeId` | string |
| `ownerUid` | string |
| `officeName` | string |
| `updatedAt` | timestamp |

Writes occur only through privileged backend transactions. The document ID is produced by NFKC normalization, case folding, Arabic character/diacritic normalization, and separator removal.

### `officeHandles/{publicSlug}`

Public handle lookup with `officeId`, `publicSlug`, and `updatedAt`. Backend-only writes prevent handle races.

### `offices/{officeId}/members/{uid}`

Membership and role (`owner`, `admin`, `manager`, or member-compatible existing role). Used by rules and Worker authorization.

### `offices/{officeId}/devices/{deviceId}`

FCM registration, installation, user, enabled state, last seen, and failure metadata. Client reads/writes are denied; the Worker manages devices.

### Existing tenant subcollections

The repository currently uses `publicIntake`, `clients`, `owners`, `opportunities`, `matches`, `deals`, `alerts`, `inbox`, `contacts`, `integrations`, `usage`, and timeline subcollections. Every tenant record must include `officeId`. Their historical presence does not approve a separate Deals UI.

### Media objects

R2 keys:

- `office-images/{officeId}/logo`
- `office-images/{officeId}/display`
- `office-images/{officeId}/whatsapp-cover`
- legacy `office-covers/{officeId}/cover`
- existing public-intake media under `public-intake/{officeId}/{intakeId}/...`

Large source files remain outside ordinary Firestore list documents and are loaded lazily.

## Approved unified Opportunity model (Phase 2+)

`offices/{officeId}/opportunities/{opportunityId}` must ultimately contain:

- identity and tenant: `id`, `officeId`, optional `brokerId`, `createdBy`
- timestamps/version: `createdAt`, `updatedAt`, `version`
- source linkage: `sourceType`, `sourceReference` or `sourceAttachmentId`
- classification: `opportunityKind`, `purpose`, `propertyType`
- location: `city`, `district`, optional `nearbyDistricts`
- financial/property data: price or budget range, area, rooms, optional bathrooms and relevant attributes
- participant reference when available
- extraction confidence and data completeness
- internal lifecycle and cooperation state
- originating/current ownership metadata
- deduplication fingerprint

Raw, extracted, normalized, and broker-confirmed values remain separate. Broker-confirmed values have precedence.

## Approved future domains

- `opportunitySources` or attachments
- `operations`
- `cooperationRequests` / `cooperations`
- `messages` and conversations
- `notifications`
- `auditLogs`
- `backgroundJobs` or `eventOutbox`

All office-scoped documents include `officeId`, even beneath an office path. Cross-office reads require an explicit active cooperation record and a minimum-data projection.

## Indexes

`firestore.indexes.json` currently contains composites for historical match/deal/alert workflow queries. Phase 1 adds no composite query. The direct `officeHandles/{slug}` lookup and single-field Opportunity Bank ordering use standard indexes. New indexes are added only with an implemented query.

## Ownership and protected fields

Client updates cannot alter `officeId`, `ownerUid`, `officeName`, or `officeNameKey`. Future Opportunity clients cannot directly alter originating/current ownership fields. Cooperation grants access; it never transfers ownership.
