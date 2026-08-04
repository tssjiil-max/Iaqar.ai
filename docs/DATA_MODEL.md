# IAQAR.AI — Data Model

Documents collections/entities, key fields, ownership, access control, and
indexes. Naming follows existing conventions (Section 23). Office‑scoped data
lives under `offices/{officeId}/...`; every office‑scoped document also carries
an explicit `officeId` field enforced by Firestore rules.

Legend: **[now]** exists today · **[phase1]** added/confirmed in Phase 1 ·
**[future]** approved target for a later phase.

## offices/{officeId} — office profile & settings [now / phase1]

| Field | Type | Notes |
|---|---|---|
| officeId | string | tenant id (matches doc id) |
| ownerUid | string | Firebase uid of the office owner; never client‑reassignable |
| officeName | string | ≤ 80 chars, ≥ 4 visible chars (non‑admin) |
| officeNameKey | string | normalized name for uniqueness (≤ 100) |
| brokerName | string | licensed broker (المرخص له) |
| phone | string | mobile/contact number |
| whatsapp | string | WhatsApp number (used for office materials) |
| licenseNumber | string | Fal license (digits) |
| city | string | |
| specialties | list | subset of `sale,purchase,rent,property_management` (≤ 4) |
| logoUrl | string | **[phase1]** office logo (R2 public URL) |
| coverUrl | string | office cover/display image (R2 public URL) |
| publicSlug | string | stable handle for `/o/{slug}` links |
| notificationPreferences | map | **[phase1]** booleans: `match`, `ownerCustomer`, `cooperation`, `message`, `appointment`, `system` |
| cooperationMode | string | **[phase1]** `disabled` \| `approval_required` (default) \| `smart_automatic` |
| updatedAt | timestamp | server timestamp |

Access: read = office member; create = platform admin; update = office manager
(owner/admin/manager) **and** `validOfficeProfile()`; delete = owner/platform
admin. `ownerUid` is preserved server‑side and cannot be reassigned by a client
write (mass‑assignment protection).

## officeNameClaims/{officeNameKey} — global name uniqueness [now]

| Field | Type | Notes |
|---|---|---|
| officeId | string | owning office |
| ownerUid | string | claimant uid |
| officeName | string | display name |
| updatedAt | timestamp | |

Doc id is the normalized name key ⇒ uniqueness is enforced at the **database**
level; the client reserves it inside a Firestore transaction (race‑safe). Access:
read = signed in; create/update = manager of the target office (or matching
ownerUid via `getAfter`); delete = manager/platform admin.

## publicOffices/{officeId} — public projection [now / phase1]

Publicly readable projection for the office public page / link preview. Contains
**only non‑sensitive** fields: `officeId`, `officeName`, `brokerName`, `phone`,
`whatsapp`, `licenseNumber`, `city`, `specialties`, `coverUrl`,
`logoUrl` **[phase1]**, `publicSlug`, `updatedAt`. **Never** contains
`notificationPreferences`, `cooperationMode`, internal ids, or owner/customer
contact records. Access: read = public; write = office manager.

## offices/{officeId}/members/{uid} — team membership [now]

`role` ∈ `owner|admin|manager|...`, `active` bool. Drives `isOfficeMember` /
`canManage`. Access: read = member; write = manager.

## offices/{officeId}/publicIntake/{docId} — external submissions [now]

Owner/customer submissions via the public office link. Strict create validation
(kind `client|owner`, name/phone/propertyType/district/details bounds, media
limits, `source ∈ {office_public_link, platform_public}`, `status == 'new'`).
Read/update/delete = office member only.

## offices/{officeId}/devices/{deviceId} — FCM tokens [now]

Secret. `allow read, write: if false` — managed exclusively by the Worker with a
service account. Never client‑readable.

## Office‑scoped operational collections [now / future]

Under `offices/{officeId}/...`, generic rule: read/create/update = office member
with `request.resource.data.officeId == officeId`; delete = manager; `devices`
excluded. Present/planned: `opportunities`, `matches`, `deals`, `alerts`,
`inbox`, `owners`, `clients`, plus per‑doc `timeline/{eventId}`.

Target logical domains (Section 23, **[future]** unless noted): `opportunities`,
`opportunitySources`/attachments, `matches`, `operations`, `cooperationRequests`
/`cooperations`, `conversations`, `messages`, `notifications`, `auditLogs`,
`backgroundJobs`/`eventOutbox`. These are introduced in their respective phases
with a documented schema and only the indexes their queries require.

## Indexes (`firestore.indexes.json`) [now]

- `matches` (COLLECTION): `status ASC, createdAt DESC`
- `deals` (COLLECTION): `status ASC, updatedAt DESC`
- `alerts` (COLLECTION): `status ASC, createdAt DESC`
- `matches` (COLLECTION_GROUP): `status ASC, nextFollowUpAt ASC`
- `deals` (COLLECTION_GROUP): `status ASC, nextFollowUpAt ASC`
- `matches` (COLLECTION): `matchGroupId ASC, updatedAt DESC`

Phase 1 introduces no new query that requires a new index (all new fields are
read on the single office document already fetched by id).

## R2 object storage (`IAQAR_MEDIA`) [now / phase1]

| Key | Purpose |
|---|---|
| `office-covers/{officeId}/cover` | office cover image [now] |
| `office-logos/{officeId}/logo` | office logo image **[phase1]** |
| `public-intake/{officeId}/{intakeId}/...` | intake attachments [now] |

Served read‑only via `GET /media/public/{key}` with a validated key pattern.
Uploads require a Firebase ID token with office‑manage authorization.
