# Acceptance Tests

These scenarios are mandatory. `PENDING` means the owning phase has not yet
been approved or implemented; it is not a pass.

| ID | Scenario | Owning phase | Current result |
| --- | --- | --- | --- |
| 1 | Logo and cover open Office Settings; no separate settings button | 1 | PASS (automated wiring; authenticated browser blocked locally) |
| 2 | Home has no bottom navigation | 1 | PASS |
| 3 | Short and normalized-duplicate names fail; unique name succeeds atomically | 1 | PASS (unit/rules); live Firebase endpoint not exercised |
| 4 | Office A cannot read, query, modify, or download Office B data | 1/8 | PASS (Firestore emulator) |
| 5 | Unified URL/text field and paperclip create/update one Opportunity | 2 | PENDING |
| 6 | No-match Opportunity is banked without an operation | 3/5 | PENDING |
| 7 | Compatible later request triggers automatic rematch | 4 | PENDING |
| 8 | Repeated processing creates exactly one current Match | 4 | PENDING |
| 9 | Actionable Match creates exactly one routed operation | 5 | PENDING |
| 10 | Notification follows broker preferences | 5 | PARTIAL: Phase 1 category gating passes unit tests; end-to-end Match notification remains Phase 5 |
| 11 | Cooperation preserves originating ownership and scoped access | 6 | PENDING |
| 12 | Revocation removes future cooperating access | 6 | PENDING |
| 13 | Arabic channel draft remains unsent until a real send/result | 7 | PENDING |
| 14 | No separate Deals page or bottom-navigation item | 1 | PASS |
| 15 | Mock adapters are separated and cannot report fake delivery success | 7/8 | PENDING |

## Phase 1 automated checks

### Office Settings access

Given the authenticated home page, activating either the office logo button or
the office cover button opens the same modal. Both controls are keyboard
buttons with accessible names. No visible standalone settings button exists.

### Name validation and claim ownership

- Empty, whitespace-only, and fewer than four visible-character names fail.
- Arabic and Latin names normalize consistently after NFKC normalization,
  lowercasing, spacing/punctuation collapse, and Arabic mark/tatweel removal.
- An existing claim owned by a different office cannot be overwritten.
- A claim owned by the same office may be refreshed.
- Profile, public projection, new claim, and old-claim release occur atomically.

### Office isolation

- Office child creates/updates require `request.resource.data.officeId` to equal
  the parent office.
- Office and claim tenant/ownership fields cannot be reassigned by a manager.
- Identity upload/delete requires an authenticated manager for the requested
  office.
- Identity object keys cannot select another office or an unsupported media
  kind.

### Phase 1 profile

- Only office name, broker name, license number, city, and mobile are visible
  in the office-data section; no email field exists.
- Logo, display image, and wide cover support validated upload, preview/crop,
  replacement, and removal.
- Link copy, native share fallback, QR display, and public preview are wired.
- Six notification categories and one cooperation mode persist.
- Opportunity Bank entry exists only in Office Settings.
- Loading, saved, error, and empty states have Arabic text.

### Home constraints

- The permanent home surface contains Office Card, Add Opportunity, and
  Operations Center.
- It contains no Deals page/tab, bottom navigation, or hardcoded demo
  operations.
- The Operations Center displays the approved empty state when authoritative
  data is empty.

## Verification commands

```bash
node --test test/*.test.mjs
npm test --prefix worker
node --check public/js/*.js
node --check public/firebase-messaging-sw.js
node --check admin/*.mjs
```

The repository has no compile/bundle step. Firebase emulator rule tests require
the configured emulator dependency and project credentials; absence of that
environment must be reported rather than treated as a pass.
