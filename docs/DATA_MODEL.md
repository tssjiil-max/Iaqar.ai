# IAQAR.AI Data Model

## Tenant rule

Every office-scoped document must include `officeId`, even when stored under `offices/{officeId}`. Backend authorization and Firestore Security Rules must enforce tenant isolation.

## Current collections

| Path | Purpose | Access model |
| --- | --- | --- |
| `offices/{officeId}` | Office profile, owner, settings, notification preferences, cooperation mode | Office members read; managers/owners update |
| `offices/{officeId}/members/{uid}` | Office membership and role | Office members read; managers write |
| `publicOffices/{officeId}` | Public office profile/slug mirror | Public read; office managers write |
| `officeNameClaims/{nameKey}` | Global normalized office name uniqueness | Signed-in read; create/update only by manager/owner for same office |
| `offices/{officeId}/publicIntake/{docId}` | Owner/customer public submissions | Public create with validation; office members read/update |
| `offices/{officeId}/owners/{id}` | Parsed owner/offer records | Office-scoped wildcard rules |
| `offices/{officeId}/clients/{id}` | Parsed customer/request records | Office-scoped wildcard rules |
| `offices/{officeId}/opportunities/{id}` | Unified opportunities / bank candidates | Office-scoped wildcard rules |
| `offices/{officeId}/matches/{id}` | Match records | Office-scoped wildcard rules and indexes |
| `offices/{officeId}/deals/{id}` | Internal completion/workflow states; not a separate page | Office-scoped wildcard rules and indexes |
| `offices/{officeId}/alerts/{id}` | In-app notification/alert records | Office-scoped wildcard rules |
| `offices/{officeId}/devices/{id}` | FCM registration secrets | Worker-only; client denied |
| `offices/{officeId}/inbox/{id}` | Inbound/share messages | Office-scoped wildcard rules |
| `offices/{officeId}/contacts/{phone}` | Contact rollups | Office-scoped wildcard rules |
| `offices/{officeId}/integrations/whatsapp` | WhatsApp integration state | Office-scoped rules; worker integration routes authorize |
| `whatsapp_accounts/{phoneNumberId}` | Server-only Meta account mapping | Client denied |
| `loginDirectory/{phoneHash}` | Server-only phone login directory | Client denied by default |
| `brokerApplications/{id}` | Broker onboarding applications | Worker creates; platform admin reads/updates |

## Phase 1 office fields

Stored on `offices/{officeId}`:

| Field | Type | Notes |
| --- | --- | --- |
| `officeId` | string | Must match tenant |
| `officeName` | string | Trimmed visible name, at least 4 visible characters |
| `officeNameKey` | string | Normalized global uniqueness key |
| `brokerName` | string | Visible broker name |
| `licenseNumber` | string | FAL/license number |
| `city` | string | City |
| `phone` | string | Mobile number |
| `whatsapp` | string | Currently mirrors mobile number in Phase 1 hidden field |
| `logoUrl` | string | Public media URL for logo |
| `coverUrl` | string | Public media URL for display/cover image |
| `whatsappCoverUrl` | string | Public media URL for wide WhatsApp-style cover |
| `publicSlug` | string | Stable public office URL handle |
| `notificationPreferences` | map | `matches`, `ownerCustomer`, `cooperation`, `messages`, `appointments`, `important` |
| `cooperationMode` | string | `DISABLED`, `APPROVAL_REQUIRED`, or `SMART_AUTOMATIC`; default is `APPROVAL_REQUIRED` |
| `updatedAt` | timestamp | Server timestamp |

Mirrored to `publicOffices/{officeId}`: public identity fields only (`officeName`, `brokerName`, `phone`, `licenseNumber`, `city`, `logoUrl`, `coverUrl`, `whatsappCoverUrl`, `publicSlug`, `specialties`). Notification preferences and cooperation settings are not mirrored publicly.

## Media keys

Office identity media is stored in the existing media bucket through the worker:

- `office-covers/{officeId}/logo`
- `office-covers/{officeId}/cover`
- `office-covers/{officeId}/whatsapp-cover`

The worker validates file type, file size, office ID, authenticated identity, and manager permission before writing.

## Indexes

Existing indexes are documented in `firestore.indexes.json`. Phase 1 does not add a new query requiring a new composite index.
