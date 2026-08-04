# IAQAR.AI Data Model

Firestore naming already in production is preserved. All office subcollection documents must contain `officeId`.

## Phase 1 collections

### `offices/{officeId}`

Private office profile, readable only by office members.

| Field | Type | Notes |
|---|---|---|
| `officeId` | string | Must equal the path tenant |
| `ownerUid` | string | Protected ownership field |
| `officeName` | string | Trimmed display value, 4–80 visible characters |
| `officeNameKey` | string | Normalized global uniqueness key |
| `brokerName` | string | Visible broker/licensee name |
| `licenseNumber` | string | FAL license number |
| `city` | string | Office city |
| `phone` | string | Office mobile number |
| `whatsapp` | string | Compatibility field; Phase 1 mirrors `phone` and does not expose a second input |
| `specialties` | array | Existing approved-services data; preserved, not edited by the Phase 1 form |
| `logoUrl` | string | Public office logo URL |
| `displayImageUrl` | string | Public display/cover image URL |
| `coverUrl` | string | Backward-compatible alias of `displayImageUrl` |
| `whatsappCoverUrl` | string | Wide office-material cover URL |
| `publicSlug` | string | Stable public-office handle |
| `updatedAt` | timestamp | Server timestamp |

### `officeNameClaims/{officeNameKey}`

Global unique-name claim. Document ID is the normalized key.

| Field | Type | Notes |
|---|---|---|
| `officeId` | string | Owning office |
| `ownerUid` | string | Claiming owner/manager identity |
| `officeName` | string | Human-readable value |
| `officeNameKey` | string | Must equal the document ID |
| `updatedAt` | timestamp | Server timestamp |

Only authenticated point reads are allowed; list queries are denied. Client profile changes use a Firestore transaction. Broker approval uses the same normalization and a backend create-if-absent write.

Normalization applies NFKC, whitespace collapse, Latin case folding, Arabic/Persian digit conversion, Arabic diacritic/tatweel removal, common Arabic letter normalization, punctuation/spacing removal, and an Arabic/Latin/digit allowlist. Display names are never silently changed.

### `publicOffices/{officeId}`

Public allowlisted office profile used by `/o/{publicSlug}`. It intentionally contains branding, office identity, mobile contact, city, services summary, and stable slug. It must not contain internal settings, member records, opportunities, scores, or private owner/customer contacts.

### `offices/{officeId}/officeSettings/notifications`

| Field | Type |
|---|---|
| `officeId` | string |
| `matches` | boolean |
| `participants` | boolean |
| `cooperation` | boolean |
| `messages` | boolean |
| `appointments` | boolean |
| `system` | boolean |
| `updatedByUid` | string |
| `updatedAt` | timestamp |

All categories default to enabled when no document exists, preserving existing delivery behavior. A false value suppresses that category. Device push enablement remains in the Worker-managed `devices` collection.

### `offices/{officeId}/officeSettings/cooperation`

| Field | Type | Notes |
|---|---|---|
| `officeId` | string | Tenant |
| `mode` | enum | `DISABLED`, `APPROVAL_REQUIRED`, `SMART_AUTOMATIC` |
| `exposeContactsAutomatically` | boolean | Always false in Phase 1 |
| `updatedByUid` | string | Actor |
| `updatedAt` | timestamp | Server timestamp |

Default mode is `APPROVAL_REQUIRED`.

### `offices/{officeId}/auditLogs/{auditId}`

Internal append-only record. Phase 1 writes `OFFICE_SETTINGS_UPDATED` with `officeId`, `actorUid`, and `createdAt`. Managers can read; clients cannot update or delete audit records.

### R2 office identity keys

```text
office-identity/{officeId}/logo
office-identity/{officeId}/display-image
office-identity/{officeId}/whatsapp-cover
```

Accepted content types are JPEG, PNG, and WebP; maximum request size is 10 MiB. Upload/delete requires manager authorization. Public reads serve only the allowlisted key pattern with `nosniff`.

## Existing collections

Existing paths include `members`, `publicIntake`, `clients`, `owners`, `opportunities`, `matches`, `deals`, `alerts`, `inbox`, `contacts`, `integrations`, `usage`, and `devices`. Their existing names are not changed in Phase 1.

`deals` is an internal legacy workflow collection, not approval for a Deals page.

## Approved later-phase entities

### Opportunity

Later phases must include: `id`, `officeId`, optional `brokerId`, timestamps, creator, source type/reference, `opportunityKind`, purpose, property/location/price/area/room attributes, party reference, extraction confidence, completeness, internal lifecycle, cooperation state, ownership metadata, deduplication fingerprint, and version. Raw, extracted, normalized, and broker-confirmed values remain distinguishable.

### Match

Must preserve canonical opportunity pair, matching-rule version, data versions, score, reasons, compatible/mismatch fields, confidence, recommended action, routing, and cooperation recommendation. Its identity must make repeated processing idempotent.

### Operation

Must contain `id`, `officeId`, optional assigned broker, type, source entity/type, priority, Arabic title/summary, recommended action, state, timestamps, optional due date, and deduplication key.

### Cooperation

Must preserve originating/cooperating office and broker IDs, opportunity IDs or approved scope, request/response/accept/end timestamps, status, permissions, and revocation data. Ownership never transfers.

## Indexes

Phase 1 adds no composite index. Office settings and name claims are direct document reads. Existing indexes in `firestore.indexes.json` are retained. New indexes are added only when an implemented query requires them.
