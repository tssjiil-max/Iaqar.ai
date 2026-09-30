# Reference layout correction

The office keeps two sections: daily tasks and the offers/requests repository.
This change makes the existing mobile UI closer to the supplied references:
compact task cards, a paired offer/request comparison, grouped property data,
owner and client side by side, and editable proposal shortcuts.

The current action remains visible. Supporting details,
the stage path, notes, history and assistant can be expanded when needed.
Expanded panels survive live document updates. A closed journey shows its stage
path by default. Property covers use actual record images; missing or failed
images show an explicit placeholder.

The handoff endpoint now accepts WHATSAPP or SHARE and records the channel.
Database rules, migrations and deployment configuration are unchanged.
WhatsApp remains a prepared-message handoff: opening it is not recorded as
delivery. Replies through the existing lightweight link return to the same journey.
Party cards open an editable proposal for that recipient instead of manual call
logging. Sharing through another app adds a MESSAGE_SHARED event and switches
the task to waiting automatically. Cancelling native share does not call the API.
Clipboard fallback copies the same message and reply link, without claiming it
was handed to an app.

## Local verification

- Office OS domain, shell and journey tests: 22/22 passed.
- Complete browser journey: 40/40 passed, from public intake through explicit
  deal closure, including WhatsApp, client reply and office isolation.
- 20 screens × 6 phone widths (320, 360, 375, 390, 412, 430): 120/120 passed,
  including the party-specific proposal composer. No horizontal scroll, overlapping
  controls, clipped button text or browser errors were found by the harness.
- Project JavaScript/JSON/inline HTML syntax check passed.
- Before/after test uses the same seeded data and the same 390px viewport.
  It also checks that parties stay side by side at 320px and expanded property
  details survive a live journey update.

| Measurement | Before | After |
| --- | ---: | ---: |
| First task card height | 287px | 199px |
| Negotiation page height | 2256px | 1287px |
| Viewing page height | 2876px | 1599px |

These are local harness measurements, not production performance claims.
The baseline is staging commit `e4ef13f76ce4d1da136f5ec719f94c048e16002c`.

## Screenshots from the real UI with isolated test data

![Daily tasks](after-tasks-mobile.png)
![First proposal](proposal-mobile.png)
![Send via WhatsApp or another app](send-options.png)
![Viewing result](after-viewing-mobile.png)

## Reproduce

Install the locked root and Worker dependencies, and install Playwright Chromium.

```sh
node --test test/office-os-domain.test.mjs test/office-os-shell.test.mjs test/office-os-journey.test.mjs
npm run check
node scripts/qa/office-os/journey.e2e.mjs
node scripts/qa/office-os/mobile-widths.e2e.mjs
node scripts/qa/office-os/reference-ui.e2e.mjs
```

The browser scripts accept `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for environments with
an existing Chromium binary, and `OUT_DIR` for generated evidence.
The reference comparison also accepts `BASE_REF`.
