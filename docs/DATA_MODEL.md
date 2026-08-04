# IAQAR.AI — Data Model

## Root collections

| Collection | Purpose | Access |
|---|---|---|
| `offices/{officeId}` | Office profile + settings | Members read; manage update |
| `publicOffices/{officeId}` | Public projection for `/o/{slug}` | Public read; manage write |
| `officeNameClaims/{officeNameKey}` | Global unique normalized office names | Signed-in read; manage create/update |
| `brokerApplications/{applicationId}` | Broker onboarding | Platform admin |
| `loginDirectory/{phoneHash}` | Phone → uid/office mapping | Worker only (rules deny client) |
| `whatsapp_accounts/{phoneNumberId}` | WA account → office map | Worker only |
| `_system/**` | Internal | Denied |

## `offices/{officeId}` fields (Phase 1 relevant)

| Field | Type | Notes |
|---|---|---|
| `officeId` | string | Tenant id (also path id) |
| `officeName` | string | Display name (trimmed) |
| `officeNameKey` | string | Normalized uniqueness key |
| `brokerName` | string | Licensed broker display name |
| `phone` | string | Mobile number (settings UI) |
| `whatsapp` | string | Kept in sync with phone for sharing/card compat |
| `licenseNumber` | string | Fal license |
| `city` | string | |
| `specialties` | string[] | `sale\|purchase\|rent\|property_management` (≤4) |
| `logoUrl` | string | R2 public URL |
| `coverUrl` | string | Display image URL |
| `whatsappCoverUrl` | string | Wide cover URL (configurable crop ratio) |
| `publicSlug` | string | URL handle for `/o/{slug}` |
| `notificationPreferences` | map | Per-office category toggles |
| `cooperationMode` | string | `DISABLED\|APPROVAL_REQUIRED\|SMART_AUTOMATIC` |
| `ownerUid` | string | Owning auth uid |
| `updatedAt` | timestamp | |

### Normalization

- `officeNameKey = NFKC → lower → strip spaces/._- → keep Arabic/Latin/digits`
- Significant character count for min length uses `[A-Za-z0-9\u0600-\u06FF]`
- Default `cooperationMode = APPROVAL_REQUIRED`

## Subcollections under `offices/{officeId}`

| Path | Purpose | Phase relevance |
|---|---|---|
| `members/{uid}` | Roles (`owner/admin/manager/...`) | AuthZ |
| `devices/{deviceId}` | FCM registrations | Notifications (Worker-only rules) |
| `opportunities/{id}` | Unified opportunities | Bank / matching |
| `matches/{id}` (+ `timeline`) | Match records | Matching / ops |
| `deals/{id}` | Legacy internal progression store | Do not expose as Deals page |
| `alerts/{id}` | Alert/notification records | Notifications |
| `publicIntake/{id}` | Public form submissions | Intake |
| `clients/{id}`, `owners/{id}`, `contacts/{id}` | Parties | Ops |
| `inbox/{id}` | Inbound messages | WhatsApp |
| `integrations/whatsapp` | WA binding | Integration |
| `usage/whatsapp_{day}` | Usage meters | Integration |

## `officeNameClaims/{officeNameKey}`

| Field | Type |
|---|---|
| `officeId` | string |
| `officeName` | string |
| `ownerUid` | string |
| `updatedAt` | timestamp |

Race safety: client uses a Firestore transaction over claim + office + publicOffices. Rules require claim ownership via `getAfter` on office create/update. Worker approval must also write the claim.

## `publicOffices/{officeId}`

Public-safe projection: name, broker, phone, license, city, specialties, cover/logo URLs, slug. No internal scoring, bank, or cooperation internals.

## Indexes

Existing indexes cover `matches`, `deals`, `alerts` status/time and follow-up queries (`firestore.indexes.json`). Add indexes only when a real query requires them.

## Ownership / cooperation (target fields)

Future cooperation records must preserve originating and cooperating office/broker ids, scope, timestamps, status, permissions, and revocation metadata. Opportunity ownership fields must not be mass-assigned by brokers.
