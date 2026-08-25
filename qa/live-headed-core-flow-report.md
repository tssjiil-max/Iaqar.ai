# Live Staging Core Flow (headed)

Hosting: https://iaqar-ai-staging--staging-9c4b0k7h.web.app
Deployed: `b8f91d8` / cursor/office-collaboration-workflow-c864 @ 2026-08-25T04:45:23.993Z
Run: `livee2e_mt8fu4dr`

**CORE FLOW NOT YET VERIFIED**

| Test | Unit | Live E2E | Persistence after reload | Evidence |
|---|---|---|---|---|
| District save | PASS — UNIT ONLY | FAIL — LIVE E2E | FAIL — LIVE E2E | live-A-district-error.png |
| Last field → قيد المطابقة | PASS — UNIT ONLY | FAIL — LIVE E2E | NOT RUN | blocked on district editor |
| Client interested | PASS — UNIT ONLY | FAIL — LIVE E2E | PASS — LIVE E2E | live-C-client-interested.png + party/sessions/reply |
| Broker receives client update | PASS — UNIT ONLY | FAIL — LIVE E2E | firestore livingStage=MATCH_FOUND | live-D-broker-client.png |
| Owner available | PASS — UNIT ONLY | PASS — LIVE E2E | PASS — LIVE E2E | live-E-owner-available.png + party/sessions/reply |
| Broker receives owner update | PASS — UNIT ONLY | FAIL — LIVE E2E | firestore livingStage=MATCH_FOUND | live-F-broker-owner.png |
| Same taskId | PASS — UNIT ONLY | PASS — LIVE E2E | PASS — LIVE E2E | taskId before/after in report JSON |
| Cooperation data | PASS — UNIT ONLY | FAIL — LIVE E2E | NOT RUN | live-G-cooperation-missing.png |
| Live console / network | PASS — UNIT ONLY | PASS — LIVE E2E | NOT RUN | no unexpected pageerror/console.error |

## taskId

- before client: `match_livee2e_mt8fu4dr`
- after client: `match_livee2e_mt8fu4dr`
- after owner: `match_livee2e_mt8fu4dr`

## Notes

- District save: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('#cv2EditorSave')

- Last field → قيد المطابقة: blocked on district editor
- Client interested: HTTP 200 replyAction=interested followUp=false loginChrome=0
- Broker receives client update: taskId match_livee2e_mt8fu4dr → match_livee2e_mt8fu4dr timelineVisible=false
- Owner available: HTTP 200 persisted=true
- Broker receives owner update: taskId match_livee2e_mt8fu4dr → match_livee2e_mt8fu4dr
- Same taskId: before=match_livee2e_mt8fu4dr afterClient=match_livee2e_mt8fu4dr afterOwner=match_livee2e_mt8fu4dr
- Cooperation data: seeded COOPERATION_MATCH not visible
- Live console / network: no unexpected pageerror/console.error