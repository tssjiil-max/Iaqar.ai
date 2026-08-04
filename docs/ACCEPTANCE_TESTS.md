# IAQAR.AI — Acceptance Tests

## Phase 1 Acceptance Tests

### TEST 1 — OFFICE SETTINGS ACCESS (via Logo)
**Given** the home page is loaded and the broker is authenticated,  
**When** the broker clicks the office logo button,  
**Then** the Office Settings panel opens.

**Pass Criteria:**
- `officeSettingsBtn` click triggers `openSettings()`
- `#officeSettings` overlay becomes visible (hidden=false)
- No separate visible "Settings" text/button exists on the home page

### TEST 1b — OFFICE SETTINGS ACCESS (via Cover)
**Given** the office has a cover image set,  
**When** the broker clicks the office cover image area,  
**Then** the Office Settings panel opens.

**Pass Criteria:**
- `#officeCoverCardBtn` click triggers `openSettings()`
- Same settings panel opens as when clicking the logo

### TEST 2 — NO BOTTOM NAVIGATION
**Given** the home page,  
**Then** there is no bottom navigation bar element.

**Pass Criteria:**
- No element with class containing 'bottom-nav', 'tab-bar', or equivalent
- Only three approved sections: Office Card, Add Opportunity, Operations Center

### TEST 3a — OFFICE NAME: TOO SHORT
**Given** an office name shorter than 4 significant characters,  
**When** the broker attempts to save,  
**Then** the form is rejected with a clear Arabic validation message.

**Pass Criteria:**
- `validateOfficeName("مك")` returns a non-empty error string
- The error message is in Arabic
- Firestore rule: `officeNameKey.size() >= 4` enforced server-side

### TEST 3b — OFFICE NAME: NORMALIZED DUPLICATE
**Given** office A has name "المسار العقاري",  
**When** another office tries to register "مسار العقاري" (differs only in Al prefix style),  
**Then** the system rejects it as a duplicate.

**Pass Criteria:**
- `normalizeOfficeNameKey("المسار العقاري")` === `normalizeOfficeNameKey("مسار العقاري")` produces same key
- Firestore transaction throws OFFICE_NAME_TAKEN
- UI shows Arabic error message

### TEST 3c — OFFICE NAME: UNIQUE NAME ACCEPTED
**Given** no office with normalized name "المكتب الجديد" exists,  
**When** the broker saves with name "المكتب الجديد",  
**Then** it is saved successfully.

**Pass Criteria:**
- `validateOfficeName("المكتب الجديد")` returns empty string
- Firestore transaction succeeds
- officeNameClaims document created

### TEST 4 — OFFICE PRIVACY
**Given** Office A's authenticated user,  
**When** they attempt to read Office B's Firestore data,  
**Then** the request is denied with permission-denied error.

**Pass Criteria:**
- Firestore rule `isOfficeMember(officeId)` returns false for other-office requests
- Direct Firestore read of another office's data throws permission-denied

### TEST 5 — NOTIFICATION PREFERENCES SAVED
**Given** the broker opens notification preferences,  
**When** the broker toggles a preference and saves,  
**Then** the preference is persisted to Firestore under `notificationPrefs`.

### TEST 6 — COOPERATION MODE SAVED
**Given** the broker opens cooperation settings,  
**When** the broker selects "معطل" and saves,  
**Then** `cooperationMode: "disabled"` is stored in the office document.

### TEST 7 — BANK ENTRY VISIBLE IN SETTINGS
**Given** the settings panel is open,  
**Then** a "بنك الفرص" button/card is visible.

### TEST 8 — QR CODE RENDERS
**Given** the settings panel is open and the office has a publicSlug,  
**When** the office link section is visible,  
**Then** a QR code canvas is rendered with the correct office link URL.

### TEST 9 — LOGO UPLOAD VALIDATION
**Given** the broker selects a file > 10MB for logo upload,  
**Then** the upload is rejected with an Arabic error message.

**Given** the broker selects a non-image file,  
**Then** the upload is rejected.

### TEST 10 — COVER UPLOAD WITH ASPECT RATIO HINT
**Given** the settings panel shows the cover upload,  
**Then** the WhatsApp-compatible ratio hint (1.91:1) is visible.

---

## Phase 2 Acceptance Tests (Planned)

### TEST 11 — OPPORTUNITY INTAKE
A URL or text can be submitted through the unified field.  
A supported attachment can be selected through the paperclip.  
One Opportunity record is created or updated.

### TEST 12 — NO MATCH
Given a valid Opportunity with no match,  
the Opportunity is stored in the Opportunity Bank.  
No Operations Center item is created merely because no match exists.

---

## Phase 4 Acceptance Tests (Planned)

### TEST 13 — AUTOMATIC REMATCH
Given a stored offer, when a compatible request is later created,  
matching runs automatically without a manual broker action.

### TEST 14 — EXACTLY ONE MATCH
A compatible offer/request pair creates exactly one current Match.  
Repeated event processing does not create duplicates.

---

## Phase 5 Acceptance Tests (Planned)

### TEST 15 — OPERATION CREATION
A valid actionable Match creates exactly one Operations Center item for the correct office.

### TEST 16 — NOTIFICATION
The actionable Match creates a notification according to the broker's preferences.

---

## Phase 6 Acceptance Tests (Planned)

### TEST 17 — COOPERATION OWNERSHIP
When an Opportunity is shared, the originating office and broker remain the owners.

### TEST 18 — COOPERATION REVOCATION
When cooperation is revoked, the cooperating party loses future access.

---

## Phase 7 Acceptance Tests (Planned)

### TEST 19 — MESSAGE DRAFT
A Match can generate an Arabic WhatsApp message draft.  
It is not marked sent until a real send action occurs.

### TEST 20 — PRODUCTION HONESTY
Mock integrations are clearly separated from production adapters.  
No fake success is shown as a real WhatsApp/Telegram delivery.

---

## System-Wide Tests (All Phases)

### TEST NO-DEALS-PAGE
There is no separate Deals page or bottom navigation item.

### TEST NO-VISIBLE-SETTINGS-BUTTON
The home page has no standalone labeled "Settings" button.

### TEST OFFICE-ISOLATION
No API call or Firestore query allows cross-office data access.
