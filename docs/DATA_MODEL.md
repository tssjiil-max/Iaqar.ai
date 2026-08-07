# IAQAR.AI — Data Model

Scope of this file: every Firestore collection and R2 key prefix the system uses today,
its ownership, its access rules, the indexes it needs, and the fields Phases 1–6 added.
Target-state entities that do not exist yet are in the final section and are clearly
marked as **not implemented**.

Rule that applies everywhere: **every office-scoped document stores `officeId` as a
field even though the path already contains it**, because the Firestore write rules
compare `request.resource.data.officeId == officeId`. Removing the field breaks writes.

---

## 1. Global collections

### 1.1 `offices/{officeId}`

The office profile and the tenant root. `officeId` is a normalized slug
(`[a-z0-9_-]{1,80}`).

| Field | Type | Notes |
| --- | --- | --- |
| `officeId` | string | Mirrors the document ID. |
| `ownerUid` | string | Firebase UID of the office owner. Pinned on first write and never overwritten by `reserveOfficeName`. |
| `officeName` | string ≤80 | Display name, exactly as the broker typed it. Never silently changed. |
| `officeNameKey` | string ≤100 | **Normalized** uniqueness key. See §4. |
| `brokerName` | string ≤80 | Licensed broker name. |
| `licenseNumber` | string ≤20, digits | FAL licence number. |
| `city` | string ≤60 | |
| `phone` | string ≤20 | Mobile number — the single office contact number. |
| `whatsapp` | string ≤20 | Derived from `phone` unless already set. Kept for the public office page and outbound `wa.me` links. Not a visible settings field (see `DECISIONS.md` D-002). |
| `specialties` | array ≤4 | Subset of `sale`, `purchase`, `rent`, `property_management`. The "approved services summary" on the Office Card. |
| `logoUrl` | string ≤2000 | **Phase 1.** Office logo. Empty means "use the platform placeholder". |
| `displayImageUrl` | string ≤2000 | **Phase 1.** Square-ish display/front image. |
| `coverUrl` | string ≤2000 | Wide cover image used for share previews. Pre-existing field, unchanged. |
| `publicSlug` | string ≤64 | Stable office handle for `/o/{slug}`. Derived once as `slug(name)-shortHash(officeId)` and then kept stable. |
| `updatedAt` | timestamp | Server timestamp. |

Access (`firestore.rules`): read = office member; create = platform admin only;
update = `canManage(officeId)` **and** `validOfficeProfile()`; delete = owner or
platform admin.

### 1.2 `publicOffices/{officeId}`

World-readable projection used by the public office page and share previews. Contains
`officeId`, `officeName`, `brokerName`, `phone`, `whatsapp`, `licenseNumber`, `city`,
`specialties`, `logoUrl`, `displayImageUrl`, `coverUrl`, `publicSlug`, `updatedAt`.

Access: `read: if true`; writes only by `canManage(officeId)`.

Deliberate exposure: this collection publishes the office contact numbers. That is the
point of a public office link. It must never gain customer, owner, opportunity, match
or cooperation data.

Query used: `where("publicSlug", "==", slug).limit(1)` — single-field, served by the
automatic index.

### 1.3 `officeNameClaims/{nameKey}`

The system-wide office-name uniqueness registry. Document ID **is** the normalized name
key, which is what makes uniqueness a database primary-key property rather than a
query.

| Field | Type | Notes |
| --- | --- | --- |
| `officeId` | string | Owner of the claim. |
| `ownerUid` | string | UID that reserved it. |
| `officeName` | string ≤80 | The display name at reservation time, for support/debugging. |
| `updatedAt` | timestamp | |

Access after the Phase 1 fix:

- `read`: any signed-in user (needed for the availability pre-check).
- `create`: signed in, `nameKey.size() >= 4` (platform admins exempt), and the caller
  manages the claimed `officeId`.
- `update`: same, **plus `resource.data.officeId == request.resource.data.officeId`** —
  an office can refresh its own claim but can never repoint another office's claim at
  itself. This closes the name-takeover hole described in `AUDIT_PHASE0.md` §5 risk 1.
- `delete`: platform admin or a manager of the claim's current office.

### 1.4 `brokerApplications/{applicationId}`

Broker sign-up requests. `create: if false` from clients — only the Worker's service
account writes them; only platform admins read/update/delete.

### 1.5 `whatsapp_accounts/{phoneNumberId}` and `_system/{**}`

Server-only (`read, write: if false`). WhatsApp Business account bindings and platform
health documents.

## 2. Office subcollections (`offices/{officeId}/…`)

| Collection | Written by | Contents |
| --- | --- | --- |
| `members/{uid}` | Office manager / platform admin | `role` (`owner`/`admin`/`manager`/…), `active`, optional `canManageIntegrations`. Drives `isOfficeMember`, `canManage`. |
| `publicIntake/{id}` | **Unauthenticated create** + **Worker process** | Owner offer / customer request submitted through the office link. Rules validate every field shape and size on create; members may **read**; update/delete are Worker-only (Phase 8). Processed by `POST /pipeline/public-intake`. |
| `clients/{id}` | **Worker only** (Phase 8) | Customer request records (`cli_intake_*` or parsed message records). Members read; client write denied. |
| `owners/{id}` | **Worker only** (Phase 8) | Owner offer records (`own_intake_*`). Members read; client write denied. |
| `opportunities/{id}` | Phase 2 intake + Phase 3 bank | Unified Opportunity entity (`opp_*`). Phase 3 adds lifecycle/archive/soft-delete and cooperation status fields. Hard client delete denied. |
| `opportunitySources/{id}` | Phase 2 intake | Source payload; loaded lazily from bank detail. Binary sources keep their office-scoped R2 `mediaPath` plus the actual `extractedText`; no fabricated attachment fixture values are persisted. |
| `sharedOpportunities/{id}` | Phase 3 + Phase 6 (target office) | Minimum read-only projection for an accepted cooperation. Contacts forced empty. Phase 6 revoke deletes or sets `revokedAt` so future reads fail. |
| `matches/{matchId}` | Worker (Phase 4) | `matchId = mat_{sha256(officeId\|canonicalPair\|matchingRuleVersion\|dataVersion)[0..36]}`. Fields include `isCurrent`, `matchingRuleVersion`, `dataVersion`, `canonicalPairKey`, `pairRuleKey`, scores/reasons JSON, opportunity ids, `status` (`active` / `superseded` / …). Client read-only; Worker writes. |
| `matches/{id}/timeline/{eventId}` | Worker + client | Append-only per-record activity. Read/create = member, update/delete = manager. |
| **`operations/{operationId}`** | **Worker (Phase 5)** | Persisted actionable Operations Center items. See §8. Clients cannot write. |
| **`notifications/{notificationId}`** | **Worker (Phase 5)** | Auditable in-app / push notification records. See §8. Clients cannot write. |
| **`auditLogs/{auditId}`** | **Worker (Phase 6)** | Sensitive cooperation-action audit trail. See §9. Clients cannot write. |
| **`messages/{messageId}`** | **Worker (Phase 7)** | Persisted smart message drafts + honest send/delivery state. See §10. Clients cannot write. |
| `deals/{dealId}` | **Worker only** (Phase 8) | Progression record created from a match. `workflowStage` ∈ `contact`…`closed`/`lost`. Internal only — there is no deals page. Broker price/note updates via `POST /workflow/action` `update_deal_fields`. |
| `deals/{id}/timeline/{eventId}` | Worker + client append | Member create/read; update/delete managers. |
| `alerts/{alertId}` | **Worker only** (Phase 8) | Legacy `alt_{matchId}` alert records. Phase 5 primary path is `notifications`. |
| `inbox/{id}` | **Worker only** (Phase 8) | Raw inbound WhatsApp messages. |
| `contacts/{digits}` | Worker + **member** (Phase 8 shaped) | Contact directory keyed by 8–15 digit phone ids; requires `officeId`/`phone`/`fullName`. |
| `usage/whatsapp_{yyyymmdd}` | **Worker only** (Phase 8 deny-all clients) | Daily counters via Firestore field transforms. |
| `devices/{deviceId}` | Worker only | FCM registrations. `allow read, write: if false` for clients. |
| **`officeSettings/{settingId}`** | **Phase 1** | Office-level settings documents. See §3.1. |
| **`brokerSettings/{uid}`** | **Phase 1** | Per-broker overrides. See §3.2. |

### 2.1 Access rules for office subcollections

A single catch-all rule covers most subcollections:

```
match /{collectionName}/{docId} {
  allow read:           if !restricted(collectionName) && isOfficeMember(officeId);
  allow create, update: if !restricted(collectionName) && isOfficeMember(officeId)
                           && request.resource.data.officeId == officeId;
  allow delete:         if !restricted(collectionName) && canManage(officeId);
}
```

`restricted()` / `isRestrictedOfficeCollection()` returns true for `devices`,
`officeSettings`, `brokerSettings`, `opportunitySources`, `opportunities`,
`sharedOpportunities`, `matches`, `operations`, `notifications`, `auditLogs`,
`messages`, `clients`, `owners`, `deals`, `alerts`, `inbox`, `usage`, `contacts`,
and `publicIntake`.
Before Phase 1 it only excluded `devices`; later phases exclude collections that need
explicit least-privilege rules. In Firestore, rules are additive — a permissive
catch-all cannot be narrowed by adding a specific rule, so exclusion is the only
correct mechanism.

## 3. Phase 1 settings documents

### 3.1 `offices/{officeId}/officeSettings/{settingId}`

Two documents today: `notifications` and `cooperation`.

`officeSettings/notifications`:

| Field | Type | Default | Directive |
| --- | --- | --- | --- |
| `officeId` | string | — | required by write rule |
| `matchNotifications` | bool | `true` | §7.5 match notifications |
| `ownerCustomerNotifications` | bool | `true` | §7.5 owner and customer notifications |
| `cooperationNotifications` | bool | `true` | §7.5 cooperation notifications |
| `messageNotifications` | bool | `true` | §7.5 message notifications |
| `appointmentNotifications` | bool | `true` | §7.5 appointment and follow-up notifications |
| `systemNotifications` | bool | `true` | §7.5 important system notifications |
| `updatedAt` | timestamp | server | |
| `updatedBy` | string | uid | audit trail |

`officeSettings/cooperation`:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `officeId` | string | — | required by write rule |
| `mode` | string | **`APPROVAL_REQUIRED`** | one of `DISABLED`, `APPROVAL_REQUIRED`, `SMART_AUTOMATIC` (§19) |
| `exposeContactAutomatically` | bool | **`false`** | hard-wired false; §7.7 forbids automatic contact exposure |
| `updatedAt` | timestamp | server | |
| `updatedBy` | string | uid | |

Access: read = office member; create/update = `canManage(officeId)` with
`officeId` matching the path; delete = never.

### 3.2 `offices/{officeId}/brokerSettings/{uid}`

Per-broker notification overrides, because §7.5 says preferences are saved per office
"and, where needed, per broker". Fields: `officeId`, `brokerId` (= document ID = the
authenticated UID), the same six booleans as above but each optional, `updatedAt`.

Resolution order used by both the UI and the Worker: broker override → office default →
built-in default (`true`).

Access: read = the broker themself or an office manager; create/update = only when
`uid == request.auth.uid` **and** `request.resource.data.brokerId == request.auth.uid`
**and** `officeId` matches the path; delete = never. This is why `brokerSettings` had
to be pulled out of the catch-all: otherwise any office member could rewrite another
member's preferences.

## 4. Office-name normalization

Two distinct values, never conflated:

- `officeName` — exactly what the broker typed, trimmed of leading/trailing whitespace
  and internal runs collapsed. This is what is displayed. It is never silently altered.
- `officeNameKey` — the normalized uniqueness key and the `officeNameClaims` document ID.

Normalization pipeline (`normalizeOfficeNameKey` in `public/js/office-domain.js`):

1. Trim, collapse whitespace.
2. Unicode `NFKC`.
3. Lowercase with the invariant `en-US` locale.
4. Strip Arabic diacritics `U+064B–U+065F`, superscript alef `U+0670`, and tatweel
   `U+0640`.
5. Fold Arabic orthographic variants: `أ إ آ ٱ → ا`, `ة → ه`, `ى → ي`, `ؤ → و`,
   `ئ → ي`, `ﻻ`-style ligatures via NFKC in step 2.
6. Remove every character that is not `[a-z0-9]` or Arabic `U+0621–U+064A`.

Result: `مكتب الأمل`, `مكتب الامل` and `  مكتب   الأمل  ` all normalize to the same key,
so the second registration is rejected — which is what §7.3 ("prevent equivalent
duplicate names after normalization") requires.

**Migration note.** Before Phase 1 the key was only lowercased/NFKC-folded with
separators stripped; it did not fold Arabic variants. Existing `officeNameKey` values
and `officeNameClaims` documents therefore use the old scheme. Migration is lazy and
already handled by the existing save transaction: when an office saves and its stored
`officeNameKey` differs from the newly computed key, the transaction deletes the old
claim (only if that claim belongs to this office) and writes the new one. No batch
migration script is needed and no office loses its name. Two offices whose *old* keys
differed but whose *new* keys collide will find that whoever saves second is asked to
choose another name; that is the intended behaviour and it is surfaced with a clear
Arabic message rather than a silent rename.

**Visible-character rule.** "At least 4 visible characters" is counted as the number of
`[A-Za-z0-9]` or Arabic-letter characters, i.e. spaces, dots, dashes and underscores do
not count. `م ك ت` is rejected; `مكتب` is accepted; `ABCD` is accepted. Platform admins
are exempt so that short reserved names stay available to the platform.

## 5. R2 media keys

| Key | Visibility | Written by |
| --- | --- | --- |
| `public-intake/{officeId}/{intakeId}/image-{1..5}.{ext}` | Private (no public route) | `POST /media/public-intake` |
| `public-intake/{officeId}/{intakeId}/video.{ext}` | Private | `POST /media/public-intake` |
| `office-covers/{officeId}/cover` | Public via `GET /media/public/office-covers/{officeId}/cover` | `POST /media/office-cover` |
| `office-covers/{officeId}/logo` | Public, same route | **Phase 1** |
| `office-covers/{officeId}/display` | Public, same route | **Phase 1** |

The public serving route validates the key against
`^office-covers\/[a-z0-9_-]{1,80}\/(cover|logo|display)$` before touching the bucket, so
the route cannot be used to read private intake media. Uploads require
`authorizeOfficeRequest(..., "manage")` and re-validate content type and size
server-side; the client-side check is convenience only.

Accepted image types: `image/jpeg`, `image/png`, `image/webp`. Maximum 10 MB per image
(enforced in the Worker, mirrored in the browser).

## 6. Indexes

Composite indexes in `firestore.indexes.json`:

| Collection group | Scope | Fields |
| --- | --- | --- |
| `matches` | COLLECTION | `status` ASC, `createdAt` DESC |
| `deals` | COLLECTION | `status` ASC, `updatedAt` DESC |
| `alerts` | COLLECTION | `status` ASC, `createdAt` DESC |
| `matches` | COLLECTION_GROUP | `status` ASC, `nextFollowUpAt` ASC |
| `deals` | COLLECTION_GROUP | `status` ASC, `nextFollowUpAt` ASC |
| `matches` | COLLECTION | `matchGroupId` ASC, `updatedAt` DESC |
| `cooperationRequests` | COLLECTION | `targetOfficeId` ASC, `status` ASC |
| `operations` | COLLECTION | `status` ASC, `createdAt` DESC |
| `operations` | COLLECTION | `status` ASC, `priority` ASC, `createdAt` DESC |
| `notifications` | COLLECTION | `status` ASC, `createdAt` DESC |

Phase 3 bank list query: `offices/{id}/opportunities` ordered by `createdAt` DESC with
`limit` + `startAfter` cursor pagination — single-field order (automatic index).

Phase 5 Operations Center query: `offices/{id}/operations` where `status in`
(`OPEN`, `IN_PROGRESS`, `WAITING_EXTERNAL_RESPONSE`) ordered by `createdAt` DESC —
requires the `status` + `createdAt` composite index.

Per the constitution, indexes are created only when a real query needs them.

## 7. Phase 3 collections (global)

### 7.1 `cooperationRequests/{requestId}`

Explicit single/selected opportunity cooperation request. Not automatic broker matching.

| Field | Type | Notes |
| --- | --- | --- |
| `originatingOfficeId` / `originatingBrokerId` | string | Owner; immutable on update. |
| `targetOfficeId` / `targetBrokerId` | string | Target; broker optional. |
| `opportunityId` / `opportunityIds` | string / array | Single or selected scope. |
| `scopeType` | `single` \| `selected` | |
| `status` | enum | `PENDING` (default), `ACCEPTED`, `REJECTED`, `REVOKED`, `ENDED`. |
| `permissions` | map | Default: read-only, minimum data, contact hidden, no ownership/delete/archive/reshare. |
| `requestedAt`, `respondedAt`, `acceptedAt`, `revokedAt`, `endedAt` | string ISO | |
| `createdBy` | string | |

Document IDs are content-hashed for active-request deduplication.

### 7.2 `bankSharingScopes/{sharingScopeId}`

Scoped, revocable Opportunity Bank share. Disabled by default (`status: DISABLED`,
`enabled: false`). Target may read only when `status == ACTIVE && enabled == true &&
revokedAt` is absent.

Filters may include kind/purpose/propertyType/city/district/activeOnly and/or explicit
`opportunityIds`. Never grants raw database access.

### 7.3 Opportunity Phase 3 fields (on `offices/{officeId}/opportunities/{id}`)

| Field | Type | Notes |
| --- | --- | --- |
| `originatingOfficeId` / `originatingBrokerId` | string | Set at create; immutable in rules. |
| `currentOwningOfficeId` | string | **Phase 6.** Defaults to `officeId` / originating office; preserved across cooperate / accept / revoke. Never transfers because of cooperation. |
| `lifecycleStatus` | `ACTIVE` \| `ARCHIVED` \| `DELETED` | Soft delete by default. |
| `archivedAt` / `archivedBy` / `restoredAt` / `restoredBy` | string | Audit. |
| `deletedAt` / `deletedBy` / `deletionReason` | string | Soft-delete audit. |
| `cooperationStatus` / `cooperationState` | enum | Visible Arabic labels: `لم تُشارك`, `بانتظار الموافقة`, `تعاون نشط`, `رُفض الطلب`, `انتهى التعاون`. Internal: NOT_SHARED … ENDED. Default NOT_SHARED. |
| `activeCooperationId` | string \| null | Points at `cooperationRequests/{id}`. |
| `version` | number | Incremented on edit/archive/restore/delete. |
| `brokerConfirmed` | boolean | Set on authorized edit — extraction must not overwrite. |

### 7.4 `sharedOpportunities` Phase 6 fields

| Field | Type | Notes |
| --- | --- | --- |
| `originatingOfficeId` / `currentOwningOfficeId` | string | Always the owner office; never the cooperating target. |
| `revokedAt` | timestamp \| null | Set on revoke (or document deleted). Rules deny reads when `revokedAt` is present. |
| `cooperationStatus` | string | `ACTIVE` while shared; `ENDED` after revoke invalidation. |
| `contactName` / `contactPhone` / `phone` | string | Always empty on write. |
| `permissions` | map | Hard floor: `contactVisible: false`, `ownershipModifiable: false`, `canDelete: false`. |

## 8. Phase 5 — Operations and Notifications

Source of truth for field builders: `worker/src/operations-domain.js` (mirrored client
contracts in `public/js/operations-domain.js`). Document IDs are content-hashed from
`deduplicationKey` so upserts are idempotent.

**Clients cannot write these collections.** Rules allow office-member `read` only;
`create` / `update` / `delete` are `if false`. The Worker service account writes via
Admin/REST outside client rules.

### 8.1 `offices/{officeId}/operations/{operationId}`

`operationId` = `op_{sha256(deduplicationKey)[0..40]}`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Same as document ID. |
| `officeId` | string | Tenant; required. |
| `assignedBrokerId` | string | Optional broker uid for routing. |
| `type` | enum | `MATCH_REVIEW`, `MISSING_DATA`, `COOPERATION_REQUEST`, `COOPERATION_RESPONSE`, `EXTERNAL_RESPONSE`, `SYSTEM_ACTION`. |
| `sourceEntityType` / `sourceEntityId` | string | e.g. `match` / `mat_…`, `opportunity` / `opp_…`, `cooperationRequest` / id. |
| `opportunityId` / `matchId` / `cooperationId` | string | Related ids (empty when N/A). |
| `titleCode` / `summaryCode` | string | Stable codes for copy. |
| `titleText` / `summaryText` | string | Arabic display copy. |
| `recommendedActionCode` / `recommendedActionText` | string | Primary CTA. |
| `priority` | enum | `URGENT`, `HIGH`, `NORMAL`, `LOW`. |
| `status` | enum | `OPEN`, `IN_PROGRESS`, `WAITING_EXTERNAL_RESPONSE`, `COMPLETED`, `DISMISSED`, `EXPIRED`. |
| `deduplicationKey` | string | Idempotency key — see below. |
| `createdAt` / `updatedAt` | timestamp | |
| `openedAt` / `completedAt` / `dismissedAt` / `dueAt` | timestamp \| null | Lifecycle stamps. |
| `dismissalReason` | string | Optional. |
| `createdBySystem` | bool | Always `true` for Phase 5 system upserts. |
| `operationVersion` / `schemaVersion` | int | Currently `1`. |
| `metadataJson` / `missingFieldsJson` | string (JSON) | Firestore storage form of `metadata` / missing-field list. |

Active statuses shown in the Operations Center:
`OPEN`, `IN_PROGRESS`, `WAITING_EXTERNAL_RESPONSE`.

`deduplicationKey` builders:

| Type | Key shape |
| --- | --- |
| `MATCH_REVIEW` | `MATCH_REVIEW\|{officeId}\|{matchId}\|{dataVersion}` |
| `MISSING_DATA` | `MISSING_DATA\|{officeId}\|{opportunityId}\|{dataVersion}\|{sortedMissingFields}` |
| `COOPERATION_*` | `{type}\|{officeId}\|{cooperationId}\|{status}` |

Replaying the same key upserts the same document; terminal statuses
(`COMPLETED` / `DISMISSED` / `EXPIRED`) are not reopened for the same key.

### 8.2 `offices/{officeId}/notifications/{notificationId}`

`notificationId` = `nt_{sha256("notif\|" + deduplicationKey)[0..40]}`.
Notification `deduplicationKey` = `NOTIF|{operation.deduplicationKey}`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Same as document ID. |
| `officeId` | string | Tenant. |
| `brokerId` | string | Target broker (from operation `assignedBrokerId`). |
| `operationId` | string | Linked Operation. |
| `type` | enum | `NEW_MATCH`, `MISSING_DATA`, `COOPERATION_REQUEST`, `COOPERATION_RESPONSE`, `SYSTEM_ACTION`. |
| `title` / `body` | string | Lock-screen-safe Arabic copy (no sensitive customer/owner fields). |
| `status` | enum | `CREATED`, `QUEUED`, `SENT`, `DELIVERED`, `FAILED`, `READ`, `DISMISSED`. |
| `readAt` | timestamp \| string | |
| `createdAt` / `updatedAt` | timestamp | |
| `deduplicationKey` | string | Idempotency. |
| `deliveryChannelsJson` | string (JSON) | Default `["in_app","push"]`. |
| `providerStateJson` | string (JSON) | Push queue/send/fail timestamps and errors. Initial push state is `QUEUED`; `DELIVERED` is not claimed without provider confirmation. |
| `sensitivePreview` | bool | Always `false` for Phase 5 system notifications. |
| `createdBySystem` / `schemaVersion` | bool / int | System-authored; schema `1`. |

## 9. Phase 6 — Cooperation audit logs and lifecycle notes

### 9.1 `offices/{officeId}/auditLogs/{auditId}`

Worker-trusted writes for sensitive cooperation actions. Document ID =
`aud_{sha256(action|officeId|cooperationId|createdAt)[0..40]}`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Same as document ID. |
| `officeId` | string | Tenant; required. |
| `action` | string | e.g. `COOPERATION_REQUEST_CREATED`, `COOPERATION_REQUEST_ACCEPTED`, `COOPERATION_REQUEST_REJECTED`, `COOPERATION_REQUEST_REVOKED`, `BANK_SHARING_SCOPE_CREATED`, `BANK_SHARING_SCOPE_REVOKED`, `SHARED_OPPORTUNITY_WRITTEN`, `SHARED_OPPORTUNITY_REMOVED`. |
| `actorUid` | string | Broker who triggered the action. |
| `cooperationId` | string | Related request or scope id. |
| `originatingOfficeId` / `targetOfficeId` | string | Parties. |
| `opportunityIdsJson` | string (JSON) | Related opportunity ids. |
| `detailsJson` | string (JSON) | Sanitized details — phones / contact names / tokens never stored. |
| `createdAt` | timestamp | |
| `createdBySystem` / `schemaVersion` | bool / int | System-authored; schema `1`. |

Access: office-member `read` only; client `create` / `update` / `delete` are `if false`.

### 9.2 Phase 6 lifecycle notes

- Accept / reject / revoke for `cooperationRequests` go through Worker
  `POST /cooperation/lifecycle`. Scoped bank sharing revoke goes through
  `POST /cooperation/scope-revoke`.
- Accept writes real minimum `sharedOpportunities` projections under the target office.
- Revoke deletes or stamps `revokedAt` on those projections and clears
  `activeCooperationId` on the origin opportunity.
- `DISABLED` cooperation mode blocks new explicit requests and accepts.
- `SMART_AUTOMATIC` may be stored in `officeSettings/cooperation.mode` but does **not**
  auto-accept or recommend brokers (Q-4 unresolved). Smart automatic cooperating-broker
  selection is still not implemented; `createsAutomaticCooperation` remains false.

## 10. Message drafts (`offices/{officeId}/messages/{messageId}`) — Phase 7

Worker-trusted documents (`msg_{sha256…}`). Members may read; clients cannot create,
update, or delete (no forging `SENT` / `DELIVERED`).

| Field | Notes |
| --- | --- |
| `id`, `officeId`, `brokerId` | Draft identity + creating broker. |
| `channel` | `whatsapp` \| `telegram`. |
| `templateCode` | e.g. `MATCH_OWNER`, `VIEWING_CLIENT`, `MEDIA_REQUEST`, … |
| `body` | Arabic draft text (≤ 4000). |
| `recipientRole`, `recipientName`, `recipientPhone` | Recipient; phone digits for WhatsApp handoff only. |
| `operationId`, `matchId`, `opportunityId` | Related records when known. |
| `sendState` | `DRAFT` → `READY` → `OPENED_EXTERNAL` (handoff). `SENT`/`FAILED` reserved for real provider paths (none enabled in Phase 7). |
| `deliveryState` | `NOT_APPLICABLE` for external handoff. `DELIVERED`/`READ` require provider confirmation — never set by handoff. |
| `failureReason` | Populated only on real provider failure paths. |
| `handoffUrl`, `adapterStatus` | `wa.me` / `t.me/share`; `adapter_ready` or `simulated`. |
| `openedExternalAt`, `sentAt`, `deliveredAt` | Timestamps; `sentAt`/`deliveredAt` unused without provider confirmation. |
| `autoSend`, `providerConfirmedSend`, `providerConfirmedDelivery` | Honesty flags; handoff keeps send/delivery confirmation false. |
| `createdAt`, `updatedAt`, `schemaVersion` | Audit. |

## 11. Target-state entities — NOT IMPLEMENTED

Listed so nobody mistakes the current model for the target model.

| Entity | Phase | Purpose |
| --- | --- | --- |
| Smart automatic cooperating-broker selection | 6 (deferred — Q-4) | Mode may be stored; Phase 6 does not auto-accept or invent recommendations. Explicit approval only. |
| Automatic Cloud API / Bot API outbound send | 7+ (Q-3) | Phase 7 ships drafts + external handoff only. |
| `conversations` threading beyond drafts | future | Optional conversation grouping around drafts. |
| `eventOutbox` / `backgroundJobs` | 2+ | Database-backed job pattern for the event workflow. |
| `officeHandles` | deferred | See `DECISIONS.md` D-004. |
