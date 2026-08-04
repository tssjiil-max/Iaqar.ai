# IAQAR.AI — Data Model

Database: Cloud Firestore, project `aqar-b5d76`. Object storage: Cloudflare R2 bucket
`IAQAR_MEDIA`. Collections marked **(existing)** predate Phase 1 and must not be renamed without a
migration plan. Collections marked **(Phase 1)** are introduced by this phase. Collections marked
**(planned)** are documented for later phases and are not implemented yet.

Every office-scoped document stores `officeId` explicitly, even when the path already contains it,
because `firestore.rules` validates the field on write.

---

## 1. `offices/{officeId}` — office profile (existing)

| Field | Type | Notes |
| --- | --- | --- |
| `officeId` | string | equals the document id |
| `ownerUid` | string | Firebase uid of the office owner; never rewritten once set |
| `officeName` | string | ≤ 80 chars, ≥ 4 significant characters (platform admins exempt) |
| `officeNameKey` | string | normalized uniqueness key, see §3 |
| `brokerName` | string | licensed broker name |
| `licenseNumber` | string | FAL licence, digits only |
| `city` | string | |
| `phone` | string | office mobile number |
| `whatsapp` | string | WhatsApp number; defaults to `phone` (see DECISIONS D-003) |
| `specialties` | array | subset of `sale`, `purchase`, `rent`, `property_management`; drives the Office Card services summary |
| `logoUrl` | string | **(Phase 1)** R2 URL of the office logo |
| `coverUrl` | string | display image shown on the Office Card and the public office page |
| `shareCoverUrl` | string | **(Phase 1)** wide share cover (default 1.91:1) for WhatsApp/link previews |
| `publicSlug` | string | stable handle used by `iaqar.ai/o/{slug}` |
| `updatedAt` | timestamp | server timestamp |

Access: read by office members; update by office managers (`canManage`); create/delete by platform
admins or the office owner. Writes must satisfy `validOfficeProfile()`.

### Subcollections

| Path | Status | Purpose |
| --- | --- | --- |
| `members/{uid}` | existing | `role`, `active`; drives `isOfficeMember` / `canManage` |
| `devices/{deviceId}` | existing | FCM registrations. Client access is denied entirely; only the Worker writes them |
| `publicIntake/{id}` | existing | anonymous owner/customer submissions |
| `clients/{id}`, `owners/{id}` | existing | parsed counterparties |
| `opportunities/{id}` | existing (partial) | opportunity records written by the Worker; the unified schema of §6 lands in Phase 2 |
| `matches/{id}` | existing | match records with score, reasons, warnings |
| `deals/{id}` | existing | deal workflow records (see DECISIONS D-002) |
| `alerts/{id}` | existing | notification records |
| `inbox/{id}` | existing | raw WhatsApp inbound messages |
| `officeSettings/{docId}` | **Phase 1** | notification preferences and cooperation mode, see §2 |
| `{any}/timeline/{eventId}` | existing | per-record workflow timeline |

## 2. `offices/{officeId}/officeSettings/{docId}` — office settings (Phase 1)

Three document ids are defined. No other id is writable.

### `officeSettings/notifications` (office scope)

| Field | Type | Default |
| --- | --- | --- |
| `officeId` | string | required, equals path office |
| `scope` | string | `"office"` |
| `matches` | bool | `true` |
| `ownerCustomer` | bool | `true` |
| `cooperation` | bool | `true` |
| `messages` | bool | `true` |
| `appointments` | bool | `true` |
| `system` | bool | `true` |
| `updatedAt` | timestamp | server timestamp |
| `updatedBy` | string | uid |

Written only by `canManage` members.

### `officeSettings/broker-{uid}` (broker scope)

Same notification booleans plus `scope: "broker"` and `brokerId: uid`. A broker-scope document
overrides the office document **for that broker only**. Writable only by the broker whose uid is
in the document id (rule: `docId == 'broker-' + request.auth.uid`).

### `officeSettings/cooperation`

| Field | Type | Notes |
| --- | --- | --- |
| `officeId` | string | required |
| `mode` | string | one of `disabled`, `approval_required`, `smart_automatic`; default `approval_required` |
| `updatedAt` / `updatedBy` | timestamp / string | |

Written only by `canManage` members.

Rules: the generic `offices/{officeId}/{collectionName}/{docId}` wildcard explicitly **excludes**
`officeSettings`, so only the dedicated rule block applies (least privilege).

## 3. `officeNameClaims/{nameKey}` — global name uniqueness (existing, hardened in Phase 1)

`nameKey` is the document id and equals the normalized office name
(`normalizeOfficeNameKey` in `public/js/office-identity.js`):

```
trim
→ NFKC
→ lowercase(en-US)
→ strip Arabic diacritics and tatweel (U+064B–U+0652, U+0670, U+0640)
→ fold أ إ آ ٱ → ا, ة → ه, ى → ي, ؤ → و, ئ → ي
→ remove spaces and [._-]
→ keep only [A-Za-z0-9\u0600-\u06FF]
```

The folding step is what makes "مكتب الأمانة" and "مكتب الامانه" the same office name, which
directive §7.3 requires ("prevent equivalent duplicate names after normalization"). Offices
created before this folding existed keep working: the next profile save re-reserves the new key
inside the same transaction and releases the old one.

| Field | Type |
| --- | --- |
| `officeId` | string |
| `ownerUid` | string |
| `officeName` | string (display form) |
| `updatedAt` | timestamp |

Uniqueness is enforced three ways:

1. Document id = normalized key, so two offices cannot hold the same key.
2. A Firestore **transaction** (`reserveOfficeName`) reads the claim, rejects it when it belongs to
   another office, releases the office's previous key and writes claim + office + public mirror
   atomically. This removes the read-then-write race.
3. Rules (Phase 1 hardening): an **update** now requires
   `resource.data.officeId == request.resource.data.officeId`, so one office can never overwrite
   another office's claim; and `getAfter(offices/{officeId}).data.officeNameKey == nameKey`, so a
   claim can only be written together with the matching office document.

## 4. `publicOffices/{officeId}` — public mirror (existing)

World-readable projection used by the public office page and by `/o/{slug}` resolution:
`officeId`, `officeName`, `brokerName`, `phone`, `whatsapp`, `licenseNumber`, `city`,
`specialties`, `logoUrl` (Phase 1), `coverUrl`, `shareCoverUrl` (Phase 1), `publicSlug`,
`updatedAt`. Written only by office managers. It intentionally contains no internal data.

## 5. Other root collections (existing)

| Collection | Access |
| --- | --- |
| `brokerApplications/{id}` | client create denied; the Worker writes with a service account; platform admins read/decide |
| `whatsapp_accounts/{phoneNumberId}` | client access denied entirely |
| `_system/{doc}` | client access denied entirely |

## 6. Planned domains (Phases 2–7, not implemented)

`opportunities` (unified schema from directive §11), `opportunitySources`, `operations`,
`cooperations` / `cooperationRequests`, `conversations`, `messages`, `notifications`, `auditLogs`,
`eventOutbox`. Their fields are specified in `docs/EVENT_WORKFLOW.md` and the directive; they will
be documented here as each phase lands.

## 7. Object storage keys (R2)

| Key | Written by | Read by |
| --- | --- | --- |
| `public-intake/{officeId}/{intakeId}/image-{n}.{ext}` | `POST /media/public-intake` | office members via the Worker |
| `public-intake/{officeId}/{intakeId}/video.{ext}` | same | same |
| `office-logos/{officeId}/logo` | **(Phase 1)** `POST /media/office-cover` with `X-Media-Kind: logo` | `GET /media/public/office-logos/{officeId}/logo` (public) |
| `office-covers/{officeId}/cover` | `POST /media/office-cover` (default kind `display`) | `GET /media/public/office-covers/{officeId}/cover` (public) |
| `office-share-covers/{officeId}/cover` | **(Phase 1)** `X-Media-Kind: share` | `GET /media/public/office-share-covers/{officeId}/cover` (public) |

Uploads require a valid Firebase ID token and `manage` permission on the office; the public read
route matches keys against a strict allow-list regular expression.

## 8. Indexes

`firestore.indexes.json` is unchanged by Phase 1: every new read is a direct document get
(`officeSettings/{docId}`), which needs no composite index. Indexes are added only when a real
query requires one.
