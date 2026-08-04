# IAQAR.AI — Data Model

**Rule:** Do not rename stable collections without a migration plan.  
Every office-scoped document should include `officeId` even when the path already contains it.

---

## Top-level collections

| Collection | Purpose | Access notes |
|------------|---------|--------------|
| `offices/{officeId}` | Office profile + settings | Members read; managers update with `validOfficeProfile` |
| `publicOffices/{officeId}` | Public projection for office link | Public read; managers write |
| `officeNameClaims/{officeNameKey}` | Normalized unique office names | Signed-in read; create only if absent; update only same office |
| `brokerApplications/{id}` | Broker onboarding applications | Platform admin |
| `whatsapp_accounts/{phoneNumberId}` | WhatsApp binding secrets | Worker only (rules deny) |
| `loginDirectory/{phoneHash}` | Phone login directory | Worker only (no client rules match ⇒ deny) |
| `loginRateLimits/*`, `passwordResetCooldown/*` | Auth abuse controls | Worker only |
| `_system/**` | Internal | Denied |

## Office subcollections (`offices/{officeId}/…`)

| Subcollection | Purpose | Phase relevance |
|---------------|---------|-----------------|
| `members/{uid}` | Membership/roles | AuthZ |
| `devices/{deviceId}` | FCM tokens | Worker-only writes |
| `publicIntake/{docId}` | Public form submissions | Intake |
| `inbox/*` | Inbound messages | Worker pipeline |
| `clients/*`, `owners/*` | Parties | Pipeline |
| `opportunities/*` | Unified opportunities / bank records | Phases 2–3 |
| `matches/*` | Match engine results | Phase 4 |
| `deals/*` | Internal progression (no deals page) | Legacy workflow; not a home nav target |
| `alerts/*` | Notification/alert records | Phase 5 |
| `contacts/*`, `integrations/*`, `usage/*` | Supporting | Existing |
| `*/timeline/*` | Event timeline | Audit/workflow |

## Office profile fields (Phase 1 focus)

| Field | Notes |
|-------|-------|
| `officeId` | Tenant id |
| `officeName` | Display name (≥4 significant chars unless platform admin) |
| `officeNameKey` | Normalized uniqueness key |
| `brokerName` | Licensed broker display name |
| `licenseNumber` | Fal license |
| `city` | City |
| `phone` | Mobile number (settings UI; no email in settings) |
| `whatsapp` | May mirror phone for share materials |
| `specialties` | Approved services summary (`sale`, `purchase`, `rent`, `property_management`) |
| `logoUrl` | Office logo (R2 public URL) |
| `coverUrl` | Display/cover image |
| `whatsappCoverUrl` | Wide WhatsApp-compatible cover |
| `publicSlug` | Stable handle for `/o/{slug}` |
| `notificationPreferences` | Per-category prefs object |
| `cooperationMode` | `DISABLED` \| `APPROVAL_REQUIRED` \| `SMART_AUTOMATIC` |
| `ownerUid`, `updatedAt` | Ownership / audit |

### `notificationPreferences` shape

```json
{
  "match": true,
  "ownerCustomer": true,
  "cooperation": true,
  "message": true,
  "appointment": true,
  "system": true
}
```

Default: all `true` when absent.

### `officeNameClaims/{officeNameKey}`

```json
{
  "officeId": "...",
  "ownerUid": "...",
  "officeName": "...",
  "updatedAt": "<server timestamp>"
}
```

## Media keys (R2)

| Key pattern | Purpose |
|-------------|---------|
| `office-covers/{officeId}/cover` | Display cover |
| `office-covers/{officeId}/logo` | Logo |
| `office-covers/{officeId}/whatsapp-cover` | Wide WhatsApp cover |
| `public-intake/{officeId}/{intakeId}/...` | Public intake media |

## Indexes

See `firestore.indexes.json`. Add indexes only when required by actual queries.

## Future domains (approved logical names)

`cooperationRequests` / `cooperations`, `operations`, `conversations`, `messages`, `notifications`, `auditLogs`, `backgroundJobs` / `eventOutbox`, `opportunitySources` / attachments — introduce when the owning phase lands; do not invent schemas beyond approved needs.
