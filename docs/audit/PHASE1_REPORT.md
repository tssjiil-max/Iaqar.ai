# Phase 1 Report — Office Card & Office Settings

**Status:** Complete for authorized Phase 0 + Phase 1 scope  
**Stop point:** Do not start Phase 2 until owner approval.

## Acceptance criteria (Phase 1)

| Criterion | Result | Notes |
|-----------|--------|-------|
| Logo opens Office Settings | PASS | `#officeSettingsBtn` → `IAQAR.openOfficeSettings` |
| Cover opens Office Settings | PASS | `#officeCoverSettingsBtn` |
| No visible standalone Settings button | PASS | Logo/cover affordances only |
| Logo upload/update | PASS | `/media/office-logo` + crop |
| Cover upload/update | PASS | `/media/office-cover` + crop |
| Wide WhatsApp cover crop preset | PASS | Configurable `whatsappCoverCropRatio` (1.91) in `shared/office-design.js` |
| Office name/broker/license/city/mobile | PASS | Email not shown in settings |
| Min 4-character name validation | PASS | Shared policy + form |
| System-wide normalized uniqueness | PASS | Client transaction + hardened `officeNameClaims` rules |
| Office link copy/share/QR/preview | PASS | Settings link tools |
| Notification preferences | PASS | Persisted on office profile; device FCM toggle preserved |
| Opportunity Bank entry | PASS | **بنك الفرص** opens private sheet (full bank = Phase 3) |
| Smart cooperation mode | PASS | Setting only; workflow = Phase 6 |
| Arabic RTL / mobile-first | PASS | Preserved |
| officeId isolation | PASS | Profile/bank scoped; rules claim fix |
| Loading/success/error states | PASS | `#officeSettingsStatus`, bank status |
| Automated tests | PASS | 53/53 Worker+Phase1 tests |

## Limitations (honest)

1. Live R2/FCM/Meta delivery not proven in this environment (secrets not available).
2. Opportunity Bank entry lists essential fields only; share/edit/scoped-bank-sharing remain Phase 3.
3. Cooperation mode is stored; request/approve/revoke workflow is Phase 6.
4. Historical `data-main="deals"` card remains (ADR-008); not removed in Phase 1.
5. HTML demo operation seed remains until Phase 5.
6. No Firestore rules emulator suite yet (static rule assertions only).
