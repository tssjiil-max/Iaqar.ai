# IAQAR.AI — Data Model

## Core Entities

### offices/{officeId}
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| officeId | string | ✅ | Matches document ID |
| officeName | string | ✅ | Max 80 chars, ≥4 significant chars |
| officeNameKey | string | ✅ | Normalized key for uniqueness (max 100) |
| brokerName | string | ✅ | Licensed broker name |
| phone | string | ✅ | Saudi mobile (05xxxxxxxx format) |
| whatsapp | string | — | WhatsApp number |
| licenseNumber | string | ✅ | FAL license digits only |
| city | string | ✅ | Max 60 chars |
| specialties | array | — | ['sale','purchase','rent','property_management'] |
| coverUrl | string | — | Office display image URL |
| logoUrl | string | — | Office logo URL (Phase 1) |
| publicSlug | string | — | URL slug for public link |
| ownerUid | string | ✅ | Firebase Auth UID of account owner |
| cooperationMode | string | — | 'approval_required' / 'disabled' / 'smart_automatic' (Phase 1) |
| notificationPrefs | map | — | Per-type notification preferences (Phase 1) |
| createdAt | timestamp | ✅ | |
| updatedAt | timestamp | ✅ | serverTimestamp() |

**notificationPrefs sub-fields:**
- matches: boolean (default: true)
- ownerCustomer: boolean (default: true)
- cooperation: boolean (default: true)
- messages: boolean (default: true)
- appointments: boolean (default: true)
- system: boolean (default: true)

**cooperationMode values:**
- `approval_required` — default, requires broker to manually approve each request
- `disabled` — no cooperation allowed
- `smart_automatic` — automatic cooperation per configured rules

### offices/{officeId}/members/{uid}
| Field | Type | Notes |
|-------|------|-------|
| officeId | string | Parent office |
| role | string | 'owner' / 'admin' / 'manager' / 'member' |
| active | boolean | false = suspended |
| displayName | string | |
| email | string | |
| createdAt | timestamp | |

### officeNameClaims/{nameKey}
| Field | Type | Notes |
|-------|------|-------|
| officeId | string | Owner office ID |
| officeName | string | Original name |
| ownerUid | string | Firebase Auth UID |
| updatedAt | timestamp | |

The `nameKey` is the normalized form: lowercase, stripped of spaces/punctuation.  
Used in a Firestore transaction with the offices document to prevent race-condition duplicates.

### publicOffices/{officeId}
Public-facing read-only office profile (readable by all).
| Field | Type | Notes |
|-------|------|-------|
| officeId | string | |
| officeName | string | |
| brokerName | string | |
| phone | string | |
| whatsapp | string | |
| licenseNumber | string | |
| city | string | |
| specialties | array | |
| coverUrl | string | |
| publicSlug | string | |
| updatedAt | timestamp | |

### offices/{officeId}/publicIntake/{docId}
External submissions from public intake forms.
| Field | Type | Notes |
|-------|------|-------|
| officeId | string | ✅ Required for isolation |
| kind | string | 'owner' / 'client' |
| name | string | ≥2 words, ≤80 chars |
| phone | string | Saudi format |
| city | string | |
| propertyType | string | |
| district | string | |
| details | string | ≤1000 chars |
| mediaPaths | array | R2 storage paths |
| imageCount | int | 0–5 |
| hasVideo | boolean | |
| mediaMissing | boolean | owner with no images |
| completeness | int | 0–100 scoring |
| source | string | 'office_public_link' / 'platform_public' |
| status | string | 'new' / 'processed' / 'matched' |
| createdAt | timestamp | |

### offices/{officeId}/matches/{matchId}
Match records between offers and requests.
| Field | Type | Notes |
|-------|------|-------|
| officeId | string | ✅ |
| clientRequestId | string | Reference to client record |
| ownerOfferId | string | Reference to owner record |
| score | number | Match percentage 0-100 |
| status | string | See match statuses |
| reasonsJson | string | JSON array of match reasons |
| warningsJson | string | JSON array of warnings |
| propertyType | string | |
| district | string | |
| closingReadinessScore | number | 0-100 |
| closingReadinessKey | string | |
| closingReadinessLabel | string | |
| workflowStage | string | |
| nextAction | string | |
| nextFollowUpAt | timestamp | |
| viewingAt | timestamp | |
| lastNote | string | |
| attentionRequired | boolean | |
| dealId | string | Linked deal ID |
| createdAt | timestamp | |
| updatedAt | timestamp | |

**Match statuses:** active / waiting_response / viewing / negotiation / completed / closed

### offices/{officeId}/deals/{dealId}
Deal records.
| Field | Type | Notes |
|-------|------|-------|
| officeId | string | ✅ |
| matchId | string | |
| clientRequestId | string | |
| ownerOfferId | string | |
| status | string | 'open' / 'closed' / 'lost' |
| workflowStage | string | See deal stages |
| propertyType | string | |
| district | string | |
| healthScore | number | |
| healthKey | string | |
| nextFollowUpAt | timestamp | |
| commissionExpected | number | |
| commissionActual | number | |
| finalPrice | number | |
| lastNote | string | |
| lostReason | string | |
| attentionRequired | boolean | |
| createdAt | timestamp | |
| updatedAt | timestamp | |

**Deal stages:** contact / viewing / negotiation / agreement / closing / closed

### offices/{officeId}/devices/{deviceId}
FCM registration tokens. **Accessible only by backend worker (false on all client rules).**
| Field | Notes |
|-------|-------|
| fcmRegistrationId | |
| registrationType | 'fid' / 'token' |
| fcmToken | |
| installationId | |
| officeId | |
| userAgent | |
| deviceName | |
| notificationPermission | |
| appVersion | |
| registeredAt | |
| updatedAt | |

---

## Planned Collections (Future Phases)

### opportunities/{id} — Phase 2
Full unified opportunity model per Section 11 of directive.

### cooperationRequests/{id} — Phase 6
Per Section 19-20 of directive.

### operations/{id} — Phase 5
Formal Operations Center records per Section 16 of directive.

### notifications/{id} — Phase 5
Notification records per Section 17 of directive.

### messages/{id} — Phase 7
Message drafts and send state per Section 18 of directive.

### auditLogs/{id} — Phase 8
Audit trail per Section 26 of directive.

---

## Indexes (firestore.indexes.json)
Current indexes should be extended as collections grow. Key planned indexes:
- opportunities: officeId + createdAt
- matches: officeId + status + updatedAt
- deals: officeId + status + workflowStage
- operations: officeId + status + priority + createdAt
