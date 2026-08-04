# IAQAR.AI — System Architecture

## Current Architecture (As-Built)

### Technology Stack
| Layer | Technology | Status |
|-------|-----------|--------|
| Frontend | Vanilla HTML/CSS/JS SPA | REAL |
| Auth | Firebase Auth (phone via custom token) | REAL AND CONNECTED |
| Database | Firestore | REAL AND CONNECTED |
| Backend | Cloudflare Worker (iaqar-macrodroid-intake.iaqar-ai.workers.dev) | REAL AND CONNECTED |
| Storage | Cloudflare R2 (iaqar-media bucket) | REAL AND CONNECTED |
| Notifications | Firebase Cloud Messaging (FCM) | REAL AND CONNECTED |
| PWA | Service Worker + manifest.webmanifest | REAL AND CONNECTED |
| Hosting | Firebase Hosting | REAL AND CONNECTED |

### Frontend Structure
```
public/
├── index.html            # Main SPA (1600 lines, all UI in one file)
├── manifest.webmanifest  # PWA manifest
├── firebase-messaging-sw.js  # FCM service worker
├── icons/                # PWA icons (192, 512)
└── js/
    ├── firebase-office.js    # Firebase init + office runtime context
    ├── access-gate.js        # Auth gate (login/signup/public forms)
    ├── office-settings.js    # Office settings management
    ├── workflow-office.js    # Operations center + FCM + PWA
    ├── whatsapp-office.js    # WhatsApp business integration UI
    ├── public-intake.js      # Public intake (currently part of access-gate)
    ├── fcm-fid.js            # FCM Firebase Installation ID helper
    └── qrcode.js             # QR code generator (window.qrcode)
```

### Cloudflare Worker Endpoints
| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST | /auth/phone-login | Custom token login via phone | None (public) |
| POST | /auth/forgot-password | Password reset | None (public) |
| POST | /broker/apply | Broker registration application | Firebase JWT |
| GET | /admin/broker-applications | List pending applications | Platform Admin JWT |
| POST | /admin/broker-applications/action | Approve/reject application | Platform Admin JWT |
| POST | /media/office-cover | Upload office cover image | Office Manager JWT |
| GET | /media/public/office-covers/* | Serve office cover from R2 | None (public) |
| GET | /meta/config | WhatsApp Meta config | Firebase JWT |
| GET | /meta/status | WhatsApp connection status | Firebase JWT |
| POST | /meta/signup | WhatsApp embedded signup | Office Manager JWT |
| POST | /whatsapp/webhook | WhatsApp incoming webhook | Meta signature |
| GET | /whatsapp/webhook | Webhook verification | Meta token |
| POST | /pipeline/intake | Process shared text message | Office Member JWT |
| POST | /pipeline/public-intake | Process public form submission | None (public, officeId required) |
| POST | /workflow/action | Execute workflow actions | Office Member JWT |
| GET | /office/analytics | Office analytics summary | Office Member JWT |
| GET | /fcm/config | FCM configuration | None |
| POST | /fcm/register | Register device for push | Office Member JWT |
| POST | /fcm/test | Send test notification | Office Member JWT |
| POST | /fcm/unregister | Unregister device | Office Member JWT |

### Firestore Collections
```
offices/{officeId}
  - officeName, officeNameKey, brokerName, phone, whatsapp
  - licenseNumber, city, specialties, coverUrl, publicSlug
  - ownerUid, officeId, updatedAt
  - cooperationMode (to be added in Phase 1)
  - notificationPrefs (to be added in Phase 1)
  - logoUrl (to be added in Phase 1)
  
  /members/{uid}          # Office team members
  /publicIntake/{docId}   # External form submissions
  /devices/{deviceId}     # FCM tokens (worker-managed, false on client)
  /owners/{ownerId}       # Property owner records
  /clients/{clientId}     # Customer records
  /opportunities/{id}     # Opportunity records (Phase 4)
  /matches/{id}           # Match records
  /deals/{id}             # Deal records
  /alerts/{id}            # Alert records
  /inbox/{id}             # Message inbox
  /contacts/{phone}       # Contact sync cache

officeNameClaims/{nameKey}   # Global name uniqueness claims
publicOffices/{officeId}     # Public-facing office profiles
brokerApplications/{id}      # Pending broker applications
whatsapp_accounts/{phoneId}  # WhatsApp credentials (worker-only)
_system/{doc}                # System health (deny all client access)
```

### Authentication Flow
```
Public intake: anonymous → Firestore publicIntake (no auth required)
Broker login: phone + password → Worker /auth/phone-login → Custom Token → Firebase Auth
Admin login: email + password → Firebase Auth directly
Access gate: validates officeId membership before showing workspace
```

### Event Flow (Current)
```
Public form → Firestore publicIntake → 
  workflow-office.js listener → Worker /pipeline/public-intake →
    localMatchScore() → Match record in Firestore →
      FCM push via Worker → Notification to office
```

---

## Target Architecture (Phase-by-Phase)

### Phase 1 Additions
- logoUrl field in offices document
- cooperationMode field in offices document
- notificationPrefs field in offices document
- Worker endpoint: POST /media/office-logo
- Worker endpoint: GET /media/public/office-logos/*

### Phase 2 Additions
- opportunities/{id} (INGESTED status initially)
- opportunitySources/{id} (raw input storage)
- Worker: POST /pipeline/unified-intake (URL/text/file analysis)

### Phase 3 Additions
- Opportunity Bank UI with filters and sharing controls
- cooperationRequests/{id} collection

### Phase 4 Additions
- Full matching engine in Worker
- Automatic rematching triggers
- Match deduplication via composite keys

### Phase 5 Additions
- operations/{id} collection (formal Operations Center records)
- notifications/{id} collection
- Replace local analytics item with Firestore-backed operations

### Phase 6 Additions
- cooperations/{id} collection
- Cooperation permission model

### Phase 7 Additions
- messages/{id} collection (drafts + send state)
- WhatsApp/Telegram adapter contracts
- Webhook validation structure

---

## Security Architecture
- Firestore rules enforce officeId isolation on ALL sensitive collections
- Backend (Worker) re-validates officeId on every mutating action
- No API keys in client code
- FCM tokens stored only in `offices/{officeId}/devices` — client rules: `allow read, write: if false`
- File uploads require authenticated office manager JWT
- Public intake endpoints protected by Firestore rules (field-level validation)
- Rate limiting: Cloudflare handles basic DDoS at Worker level

## Known Gaps (Phase 0 Audit)
1. Opportunity Bank is missing from UI and data model
2. Formal Operations Center records not in Firestore (display from live listeners only)
3. Unified intake (broker side) missing from home page
4. Cover image not displayed on office card (upload exists but display doesn't)
5. Logo upload missing (only cover upload exists)
6. Per-type notification preferences missing (only device enable/disable)
7. Cooperation settings missing from UI
8. "الصفقات" button on home page violates approved layout (Sections 5 and 21)
9. WhatsApp integration is adapter-ready but not production-connected (META_APP_ID empty)
10. No formal audit log collection
11. No formal operations/notifications collections (derived from listeners only)
