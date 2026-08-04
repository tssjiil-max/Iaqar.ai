# IAQAR.AI — Data Model

Firestore project `aqar-b5d76`. Every office-scoped document carries `officeId` even
though the path already contains it (defense in depth; the wildcard security rule
requires `request.resource.data.officeId == officeId` on create/update).

## 1. Top-level collections

| Collection | Purpose | Access |
| --- | --- | --- |
| `offices/{officeId}` | Office profile: `officeId`, `officeName`, `officeNameKey` (normalized, uniqueness), `brokerName`, `phone`, `whatsapp`, `licenseNumber`, `city`, `specialties[]` (sale/purchase/rent/property_management), `coverUrl`, `logoUrl`, `publicSlug`, `ownerUid`, `approvalStatus`, `cooperationMode` (`disabled` \| `approval_required` \| `smart_automatic`, default `approval_required`), `notificationPreferences` (map, §3), timestamps | Read: office members. Create: platform admin. Update: office managers (validated by `validOfficeProfile()`). |
| `publicOffices/{officeId}` | Public projection for the office link: name, broker, license, city, phone/whatsapp, specialties, `coverUrl`, `logoUrl`, `publicSlug` | Read: public. Write: office managers. |
| `officeNameClaims/{nameKey}` | System-wide office-name uniqueness. `nameKey` = NFKC-lowercased name with spaces/punctuation stripped (Arabic + Latin). Claimed inside the same transaction that writes the office doc → race-safe | Read: signed-in. Write: manager of the claiming office; ≥ 4 chars unless platform admin. |
| `brokerApplications/{id}` | Broker registration requests (pending → approved/rejected) | Platform admin only (created by Worker). |
| `loginDirectory/{sha256(phone)}` | Phone → {uid, officeId, email} for phone login | Worker only (no client rules → deny). |
| `loginRateLimits/{hash}`, `passwordResetCooldown/{hash}` | Login abuse protection | Worker only. |
| `whatsapp_accounts/{phoneNumberId}` | Meta phone-number → office mapping | Deny all client access (Worker only). |
| `_system/**` | Health probe target | Deny all. |

## 2. Office subcollections (`offices/{officeId}/…`)

| Subcollection | Purpose / key fields |
| --- | --- |
| `members/{uid}` | Membership: `role` (owner/admin/manager/member), `active`, `canManageIntegrations` |
| `publicIntake/{id}` | Raw public form submissions (client/owner): name, phone, propertyType, district, details, mediaPaths, `status: new→processed`, `source` |
| `inbox/{id}` | Raw inbound messages (WhatsApp webhook, share target). Dedup by hashed message/event id. `processingState`, `extractedJson` |
| `clients/{id}` / `owners/{id}` | Normalized client requests / owner offers produced by the parser (`parsedToFirestoreFields`): propertyType, district, transactionType, price/priceMin/priceMax, area, rooms, contactPhone/Name, completeness, confidence, `missingFieldsJson` |
| `opportunities/{id}` | Unified opportunity record (one per intake) with `sourceCollection`/`sourceRecordId`, workflowStage, priority. **This collection backs بنك الفرص (the Opportunity Bank).** Cooperation fields (`cooperationStatus`, default «لم تُشارك») arrive in the cooperation phase |
| `matches/{matchId}` (+ `timeline/{eventId}`) | Match records. `matchId = mat_ + sha256(officeId|sorted(sourceRef|counterpartRef))` → **idempotent**: the same pair can never create a duplicate. score, opportunityScore, closingReadiness*, reasons/warnings/breakdown JSON, clientRequestId, ownerOfferId, matchGroupId, status (active/waiting_response/viewing/negotiation/completed/closed), nextFollowUpAt |
| `deals/{dealId}` (+ `timeline/{eventId}`) | Internal progression records (contact→viewing→negotiation→agreement→closing→closed \| lost). Internal only — there is **no deals page**; the current «الصفقات» tab is scheduled for removal in the Operations-Center phase |
| `alerts/{id}` | In-app notification records (match, follow_up, broker_application) |
| `devices/{deviceId}` | FCM registrations (FID or token). Client access denied; Worker-only |
| `contacts/{digits}` | Office contact book (owner/client phone book) |
| `integrations/whatsapp` | Meta connection state (inboundOnly: true, outboundEnabled: false) |
| `usage/whatsapp_{yyyymmdd}` | Daily inbound counters for the usage meter |

## 3. `notificationPreferences` map (office doc)

Saved per office from Office Settings; all keys default to `true` when absent.
The Worker checks these before every push (`isNotificationTypeEnabled`):

| Key | Arabic label | Push types gated |
| --- | --- | --- |
| `matches` | إشعارات المطابقات | `match` |
| `ownerCustomer` | إشعارات الملاك والعملاء | `client_request`, `owner_offer` |
| `cooperation` | إشعارات التعاون | `cooperation*` (future phases) |
| `messages` | إشعارات الرسائل | `message` (future phases) |
| `appointments` | إشعارات المواعيد والمتابعات | `follow_up`, `deal`, `appointment` |
| `system` | إشعارات النظام المهمة | `system`, `broker_application` |

`notification_test` (the explicit activation test triggered by the broker) is always
allowed. Per-broker preferences (directive §7.5 "where needed, per broker") are planned
for the phase that introduces multi-broker offices — recorded in `docs/DECISIONS.md`.

## 4. Target unified Opportunity fields (directive §11)

Existing fields already cover: id, officeId, createdAt/updatedAt, sourceType (`source`),
sourceReference (`sourceInboxId`/`sourceIntakeId`), kind (`recordType` =
client_request/owner_offer ⇔ REQUEST/OFFER), purpose (`transactionType`), propertyType,
city, district, price/budget range, area, rooms, contact reference, extraction
confidence, completeness, lifecycle (`status`/`workflowStage`).

To be added in later phases (documented here so names stay stable): `createdBy`,
`brokerId`, `nearbyDistricts[]`, `bathrooms`, explicit `extracted` vs `normalized` vs
`brokerConfirmed` value separation, `dedupFingerprint`, `version`, `cooperationState`,
ownership metadata (originating office/broker + current owning office), and internal
lifecycle statuses (INGESTED/ANALYZING/NEEDS_DATA/READY/MATCHED/CLOSED/ARCHIVED/DELETED)
mapped onto the existing `status` field. These statuses are internal and never surface
as labels like «فرصة مرصودة».

## 5. Media storage (R2 bucket `iaqar-media`)

| Key pattern | Content | Written by | Served |
| --- | --- | --- | --- |
| `public-intake/{officeId}/{intakeId}/image-N.ext` / `video.ext` | Owner submission media (≤ 8 MB/image, ≤ 90 MB/video) | `/media/public-intake` | Private (no public GET route) |
| `office-covers/{officeId}/cover` | Office cover/display image (≤ 10 MB, jpeg/png/webp) | `/media/office-cover` (manager auth) | `GET /media/public/office-covers/{officeId}/cover` |
| `office-logos/{officeId}/logo` | Office logo (≤ 5 MB, jpeg/png/webp) | `/media/office-logo` (manager auth) | `GET /media/public/office-logos/{officeId}/logo` |

## 6. Indexes (`firestore.indexes.json`)

Only indexes required by real queries exist: matches(status, createdAt desc),
deals(status, updatedAt desc), alerts(status, createdAt desc), collection-group
matches/deals(status, nextFollowUpAt asc) for the cron, matches(matchGroupId,
updatedAt desc) for sibling closing. New indexes are added only when a real query
needs them.
