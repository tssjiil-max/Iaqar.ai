# IAQAR.AI — Data Model

Version 1.0 · Documents Firestore collections/entities, key fields, ownership and
access. Existing stable collections must not be renamed without a migration plan
recorded in [`DECISIONS.md`](./DECISIONS.md). Every office‑scoped document must
carry `officeId` even when the path already contains it.

## 1. Existing collections (audited)

### `offices/{officeId}`
Office profile document. Fields (current + Phase 1 additions marked ✧):

| Field | Type | Notes |
|-------|------|-------|
| `officeId` | string | Tenant id (matches doc id). |
| `officeName` | string | ≤ 80 chars. |
| `officeNameKey` | string | Normalized unique key (see §3). |
| `brokerName` | string | Licensee/broker name. |
| `phone` | string | Contact / **mobile** number. |
| `whatsapp` | string | WhatsApp number (existing approved field). |
| `licenseNumber` | string | Fal license number. |
| `city` | string | |
| `specialties` | list | subset of `sale,purchase,rent,property_management`. |
| `coverUrl` | string | Office cover/display image URL (R2). |
| `logoUrl` ✧ | string | Office logo image URL (R2). |
| `publicSlug` | string | Stable office handle for `/o/{slug}`. |
| `ownerUid` | string | **Ownership field — immutable except by platform admin.** |
| `notificationPrefs` ✧ | map<string,bool> | Per‑office notification toggles (see §4). |
| `cooperationMode` ✧ | string | `disabled` \| `approval_required` (default) \| `smart_automatic`. |
| `updatedAt` | timestamp | Server timestamp. |

Sub‑collections:

- `offices/{officeId}/members/{uid}` — `{ uid, role(owner/admin/manager/...),
  active, createdAt }`. Drives access.
- `offices/{officeId}/publicIntake/{docId}` — external submissions from the
  office public link (`kind: client|owner`, contact + property fields, media
  paths, `source`, `status:new`). Created by the public; read/managed by office.
- `offices/{officeId}/devices/{deviceId}` — **secret FCM tokens; Worker‑only**
  (`allow read,write: if false`).
- `offices/{officeId}/owners`, `/clients`, `/opportunities`, `/deals`,
  `/matches`, `/alerts`, `/inbox` — office‑scoped operational data (generic
  rule requires `officeId == officeId` on create/update).
- `offices/{officeId}/{collection}/{doc}/timeline/{eventId}` — per‑record
  timeline/audit events.

### Top‑level collections

- `publicOffices/{officeId}` — public mirror of office profile for the public
  office page/link (`allow read: if true`). Contains only shareable fields.
- `officeNameClaims/{nameKey}` — uniqueness ledger. Doc id = normalized name key.
  `{ officeId, ownerUid, officeName, updatedAt }`. Enforces unique office names
  at the database level via a transaction (race‑safe).
- `brokerApplications/{id}` — broker onboarding requests (platform‑admin only).
- `whatsapp_accounts/{phoneNumberId}` — Worker‑only WhatsApp linkage.
- `loginDirectory/{phoneHash}` — Worker‑managed phone→office login directory.
- `_system/{doc}` — Worker‑only system docs (health, etc.).

## 2. Ownership metadata

Ownership‑sensitive fields (`ownerUid`, `officeId`) must never be changed by an
ordinary broker/manager. Rules enforce immutability on update (only platform
admin may change them). This prevents mass assignment and ownership hijacking.

## 3. Office name normalization & uniqueness

- `officeNameKey = normalize(officeName)`:
  `NFKC` → lowercase (`en-US`) → strip `\s . _ -` → keep only
  `[A-Za-z0-9\u0600-\u06FF]`.
- Minimum 4 significant characters (`[A-Za-z0-9\u0600-\u06FF]`) for non‑admins;
  1–3 char keys are reserved for platform administration.
- Uniqueness is reserved in a Firestore **transaction** over
  `officeNameClaims/{officeNameKey}`, so two offices cannot claim equivalent
  names even under a race. The old claim is released when a name changes.

## 4. Notification preferences (Phase 1)

`offices/{officeId}.notificationPrefs` is a map of booleans covering the approved
categories (Directive §7.5 / §17):

| Key | Meaning |
|-----|---------|
| `match` | Match notifications |
| `ownerCustomer` | Owner & customer notifications |
| `cooperation` | Cooperation notifications |
| `messages` | Message notifications |
| `appointments` | Appointment & follow‑up notifications |
| `system` | Important system notifications |

Defaults: all `true`. Stored per office (per‑broker overrides may be added when
team members are supported). Routing/enforcement of these preferences happens in
Phase 5 (Operations Center & Notifications); Phase 1 only persists the choices.

## 5. Indexes

`firestore.indexes.json` defines composite indexes for `matches`, `deals`,
`alerts` (status + createdAt/updatedAt/nextFollowUpAt) and a `matches`
collection‑group index. Add indexes only when a real query requires one.

## 6. Planned domains (future phases — not yet created)

`officeSettings`, `officeHandles`, `opportunitySources`/attachments,
`operations`, `cooperationRequests`/`cooperations`, `conversations`, `messages`,
`notifications`, `auditLogs`, `backgroundJobs`/`eventOutbox`. These will reuse
existing naming conventions and each office‑scoped doc will include `officeId`.
