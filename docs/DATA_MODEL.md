# Data Model

## Conventions

- Existing collection names are retained.
- Every office child document includes `officeId`, even when the parent path
  contains it.
- Timestamps are server timestamps where a client transaction is used.
- Protected ownership and tenant fields are immutable to ordinary members.
- Public projections contain only fields intended for anonymous display.
- Large source media is referenced by path and loaded separately.

## Current and Phase 1 collections

### `offices/{officeId}`

| Field | Type | Purpose |
| --- | --- | --- |
| `officeId` | string | Stable tenant identifier; immutable |
| `ownerUid` | string | Office owner; immutable outside approved admin flow |
| `officeName` | string | Trimmed display name, 4–80 visible characters |
| `officeNameKey` | string | NFKC/case/spacing-normalized global uniqueness key |
| `brokerName` | string | Visible licensed broker name |
| `licenseNumber` | string | Visible real-estate license number |
| `city` | string | Office city |
| `phone` | string | Office mobile number |
| `specialties` | string[] | Existing approved service keys, at most four |
| `logoUrl` | string | Public office logo media URL |
| `displayImageUrl` | string | Public office display image URL |
| `coverUrl` | string | Public wide cover media URL |
| `publicSlug` | string | Stable office URL handle |
| `notificationPreferences` | map | Six category booleans |
| `cooperationMode` | enum | Defaults to `APPROVAL_REQUIRED` |
| `createdAt` | timestamp | Original creation time |
| `updatedAt` | timestamp | Last profile update |

### `offices/{officeId}/members/{uid}`

Stores office membership and role. Active owners, admins, and managers may
change Office Settings. Membership does not permit access to another office.

### `officeNameClaims/{officeNameKey}`

| Field | Type | Purpose |
| --- | --- | --- |
| `officeId` | string | Office holding the unique name |
| `ownerUid` | string | User creating/updating the claim |
| `officeName` | string | Human-readable claimed name |
| `createdAt` | timestamp | Claim creation |
| `updatedAt` | timestamp | Last refresh |

The document ID is the normalized name. Firestore transaction and rules prevent
two offices from holding the same key. Renaming deletes the previous claim only
when it still belongs to the same office.

### `publicOffices/{officeId}`

Public-safe projection used by the shared office link. It mirrors visible
identity fields and `publicSlug`; it must not contain membership, preferences,
ownership, internal scores, or private workflow data. It is not trusted for
authorization.

### `offices/{officeId}/devices/{deviceId}`

Worker-managed FCM registration. Client rules deny direct access. Contains
`officeId`, registration identifier/type, installation and user identifiers,
enabled state, and timestamps.

### Existing operational subcollections

- `opportunities`: current private normalized opportunity records.
- `matches`: current matching/workflow records.
- `alerts`: current alert records.
- `inbox`: received integration events.
- `publicIntake`: external owner/customer submissions.
- `deals`: legacy internal completion workflow records; retained for
  compatibility but not exposed as a separate product module.
- `clients`, `owners`, `contacts`, `usage`, `integrations`: current supporting
  records.

The complete Opportunity, Operation, Match, Cooperation, Message, Notification,
and Audit models will be finalized in their approved implementation phases.

## Media objects

Phase 1 identity objects:

```text
office-identity/{officeId}/logo
office-identity/{officeId}/display
office-identity/{officeId}/cover
```

Accepted upload types are JPEG, PNG, and WebP with the configured maximum size.
The Worker authenticates a managing user and verifies the requested `officeId`
before write/delete. Public reads are restricted to these exact key patterns.

Existing intake media remains under private `public-intake/{officeId}/...`
paths.

## Queries and indexes

Phase 1 profile and claim operations use direct document reads/writes and
require no composite index. Public slug lookup currently queries
`publicOffices.publicSlug`; stable uniqueness should be backed by a dedicated
slug claim before editable handles are introduced.

Indexes are added only for an implemented query. Existing match/deal/alert
indexes are retained for backward compatibility.

## Access summary

| Data | Read | Write |
| --- | --- | --- |
| Office profile | Office member | Owner/admin/manager |
| Office-name claim | Authenticated availability check | Claiming office manager in atomic profile transaction |
| Public office projection | Anonymous office-link visitor | Office manager |
| Office child data | Same-office member | Same-office authorized member with matching `officeId` |
| FCM devices | Worker only | Worker only |
| Identity media write/delete | Office manager via Worker | Office manager via Worker |
| Identity media read | Public exact media URL | Not applicable |
