# IAQAR.AI — Data Model

## Collections (current + Phase 1 additions)

### `offices/{officeId}`

Office profile and settings. Always include `officeId` on writes.

| Field | Notes |
|-------|-------|
| `officeId` | Tenant key |
| `officeName` | Display name |
| `officeNameKey` | Normalized uniqueness key |
| `brokerName` | Licensed broker display name |
| `phone` | Mobile number (settings UI primary contact) |
| `whatsapp` | Kept for sharing/card; synced from phone when UI hides separate WhatsApp field |
| `licenseNumber` / legacy `falLicense` | FAL license |
| `city` | City |
| `specialties` | `sale` \| `purchase` \| `rent` \| `property_management` |
| `logoUrl` | Phase 1 — office logo media URL |
| `coverUrl` | Display/cover image URL (R2) |
| `whatsappCoverUrl` | Phase 1 — wide WhatsApp-compatible cover |
| `publicSlug` | Stable public handle segment for `/o/{slug}` |
| `cooperationMode` | Phase 1 — `DISABLED` \| `APPROVAL_REQUIRED` \| `SMART_AUTOMATIC` |
| `notificationPreferences` | Phase 1 — map of boolean prefs |
| `ownerUid` | Office owner |
| `createdAt` / `updatedAt` | Timestamps |

### `officeNameClaims/{officeNameKey}`

Global unique name reservation. Document id = normalized name key. Fields: `officeId`, `officeName`, `ownerUid`, `updatedAt`.

### `publicOffices/{officeId}`

Public-safe mirror for office link / public intake: name, broker, phone, whatsapp, license, city, specialties, cover, slug.

### `offices/{officeId}/members/{uid}`

Membership and role (`owner`/`admin`/`manager`/…).

### Opportunity domain (existing; Phase 2+ ownership)

`offices/{officeId}/opportunities/{id}`, `owners`, `clients`, `matches`, `deals`, `alerts`, `inbox`, `publicIntake`, `contacts`, `devices`.

Phase 1 Opportunity Bank entry reads `opportunities` for the current office only (list essentials). Full bank UX is Phase 3.

### Planned / recommended (not required for Phase 1 schema migration)

- `officeHandles/{slug}` — stronger slug uniqueness if collisions appear.
- `operations`, `cooperationRequests`, `messages`, `auditLogs`, `backgroundJobs` / outbox — later phases.
- Unified Opportunity fields per constitution §11 when Phase 2 normalizes intake.

## Indexes

Existing composite indexes in `firestore.indexes.json` cover `matches`, `deals`, `alerts` status/time queries. Create new indexes only when a real query requires them.

## Access

- Office members read office-scoped data.
- Manage role required for profile updates and name claims.
- `devices`, `whatsapp_accounts`, `_system`: client denied.
- `publicOffices`: public read; manage write.
- Cross-office access only via future explicit cooperation records.
