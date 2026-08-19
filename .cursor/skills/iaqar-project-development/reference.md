# IAQAR.AI — Reference

## Key front-end files

| File | Role |
|------|------|
| `public/index.html` | App shell, inline CSS, script order |
| `public/js/firebase-office.js` | `window.IAQAR.office`, officeId resolution |
| `public/js/access-gate.js` | Public vs authenticated routing |
| `public/js/workflow-office.js` | Operations live data, workflow overlay, إدارة الفرصة |
| `public/js/opportunity-bank.js` | Opportunity Bank controller |
| `public/js/opportunity-domain-bridge.js` | ES module → `window.IAQAR` bridges |
| `public/js/office-domain.js` | Shared office pure helpers (importable in tests) |

## Key Worker areas (`worker/src/index.js`)

| Route / handler | Purpose |
|-----------------|--------|
| `POST /opportunity/lifecycle` | Lifecycle actions + brokerActionProgress |
| `POST /pipeline/intake` | Intake pipeline |
| `POST /cooperation/*` | Phase 6 cooperation |
| `POST /operations/*` | Phase 5 operations |
| `scheduled` | Cron (reminders, etc.) |

Import shared domain from `public/js/*-domain.js` or `worker/src/*-domain.mjs` — Worker already imports some public domain modules.

## Broker action key examples

| UI | `data-broker-action` |
|----|----------------------|
| Contact WhatsApp | `contact:whatsapp` |
| Contact call | `contact:call` |
| Contact outcome INTERESTED | `contact:outcome:INTERESTED` |
| Follow-up WhatsApp owner | `followup:whatsapp:owner` |
| Follow-up confirmed | `followup:outcome:confirmed` |
| Bank search matches | `workspace:search_matches` |
| Share listing WhatsApp | `hub:share_whatsapp_listing` |
| Party WhatsApp | `party:whatsapp` |

Record shape:

```json
{
  "brokerActionProgress": {
    "followup:outcome:confirmed": "2026-08-18T12:00:00.000Z"
  },
  "followUp": {
    "confirmationOutcome": "confirmed",
    "whatsappRolesOpened": ["owner"]
  },
  "lastContactOutcome": "INTERESTED"
}
```

`resolveCompletedBrokerActionKeys()` merges explicit map + derived fields (`lastWhatsAppOpenedAt`, `followUp.confirmationOutcome`, etc.).

## Custom events

- `iaqar:operations-data` — operations list
- `iaqar:workflow-action` — broker pressed workflow button
- `iaqar:nav-open` — navigation / back stack

## Docs index

- `docs/DATA_MODEL.md` — Firestore shapes
- `docs/EVENT_WORKFLOW.md` — event flows
- `docs/ACCEPTANCE_TESTS.md` — acceptance criteria
- `docs/DECISIONS.md` — open decisions log
