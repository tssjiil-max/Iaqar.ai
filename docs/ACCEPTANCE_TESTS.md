# IAQAR.AI — Acceptance Tests

The 15 mandatory scenarios from the Master Engineering Directive (§27). Status is
updated at the end of every phase. Automated coverage lives in `worker/test/` (backend)
and `tests/` (structural frontend checks); scenarios that need a live Firebase/Worker
environment are additionally verified manually before a phase is declared complete.

| # | Scenario | Phase | Status after Phase 1 |
| --- | --- | --- | --- |
| 1 | **Office Settings access** — clicking the office logo opens Office Settings; clicking the office cover opens Office Settings; no separate visible Settings button | 1 | PASS (wired in `whatsapp-office.js`; covered by `tests/phase1.structure.test.mjs`) |
| 2 | **No bottom navigation** on the home page | 1 | PASS (structural test) |
| 3 | **Office name validation** — < 4 chars rejected; normalized duplicate rejected; unique accepted; backend/DB enforcement prevents race duplicates | 1 | PASS (frontend `validateOfficeName` + `officeNameClaims` transaction + Firestore rules `officeNameKey.size() >= 4`) |
| 4 | **Office privacy** — Office A cannot read/query/modify/download Office B data | 1→8 | PASS by rules design (`isOfficeMember` on `offices/{officeId}/**`; Worker `authorizeOfficeRequest`); rules-emulator test suite scheduled for Phase 8 hardening |
| 5 | **Opportunity intake** — URL/text via unified field; attachment via paperclip; one Opportunity created/updated | 2 | PENDING (Phase 2) — text/share intake already creates exactly one opportunity per source id |
| 6 | **No match** — opportunity with no match is stored in the office Opportunity Bank; no Operations item created merely because no match exists | 2–3 | PARTIAL — opportunities are stored regardless of match outcome today; the Bank UI (Phase 1 entry) lists them; formal Operations records arrive in Phase 5 |
| 7 | **Automatic rematch** — stored offer + later compatible request ⇒ matching runs automatically without broker action | 4 | PARTIAL — new counterpart intake automatically scans stored records (`findAndSaveMatches`); update/completion triggers arrive in Phase 4 |
| 8 | **Exactly one match** per compatible pair and matching/data version; repeated processing creates no duplicates | 4 | PARTIAL — deterministic `matchId = hash(officeId\|pair)` prevents duplicates today; explicit matching-version in the identity arrives in Phase 4 |
| 9 | **Operation creation** — one actionable Match ⇒ exactly one Operations item for the correct office/broker | 5 | PENDING (Phase 5) |
| 10 | **Notification** — actionable match notifies according to broker preferences | 1→5 | PARTIAL — pushes now respect the per-office `notificationPreferences` saved in Office Settings (`isNotificationTypeEnabled`, unit-tested); per-broker routing arrives with multi-broker support |
| 11 | **Cooperation ownership** — sharing preserves originating office/broker; cooperating broker gets only approved access | 6 | PENDING (Phase 6) — `cooperationMode` control shipped in Phase 1 (default `approval_required`) |
| 12 | **Cooperation revocation** — revoked party loses future access | 6 | PENDING (Phase 6) |
| 13 | **Message draft** — Arabic WhatsApp/Telegram draft generated; never marked sent without a real send/confirmation | 7 | PARTIAL — Arabic drafts exist and are always broker-initiated (`wa.me`); nothing is ever recorded as "sent"; stored message records with honest send states arrive in Phase 7 |
| 14 | **No deals page / bottom-nav item** | 5 | **FAIL (known, pre-existing)** — the current approved home page still contains the «الصفقات» tab and PWA shortcut; its removal is scheduled with the Operations-Center restructure (Phase 5) so working workflow code is not orphaned mid-phase. Recorded in `docs/DECISIONS.md` (D-004) |
| 15 | **Production honesty** — mocks separated from production adapters; no fake WhatsApp/Telegram delivery success | 1→7 | PASS for current scope — outbound messaging is programmatically blocked; Meta integration reports real connection state; no fake delivery states exist; static demo operations were removed from the home page in Phase 1 |

## Phase 1 specific checks (all automated)

- `worker/test/worker.test.mjs` — 40 pre-existing backend tests (parser, matching,
  workflow, FCM, auth) must stay green.
- `worker/test/phase1.test.mjs` — office logo upload validation and auth, media delete
  auth, public media serving for covers/logos, notification-preference filtering,
  Firestore mapValue decoding.
- `tests/phase1.structure.test.mjs` — structural acceptance checks on `public/`:
  logo + cover both open settings; no visible settings button on the office card; no
  email field in office settings; no bottom navigation; notification-preference
  controls present; cooperation modes present with `approval_required` default;
  «بنك الفرص» entry present; no static demo operations; office link copy/share/QR/
  preview controls present; cover crop ratio is a configurable setting.

## How to run

```bash
node --test tests/            # structural frontend checks
cd worker && npm test         # backend unit tests
node --check public/js/*.js worker/src/index.js   # syntax gate (no build step exists)
```
