# Live Staging Core Flow (headless)

Hosting: https://iaqar-ai-staging--staging-9c4b0k7h.web.app
Deployed: `ab0cdb5` / cursor/production-pilot-c203 @ 2026-08-26T08:28:10.073Z
Run: `livee2e_mt9u5kln`

**CORE FLOW VERIFIED — LIVE E2E**

| Test | Unit | Live E2E | Persistence after reload | Evidence |
|---|---|---|---|---|
| District save | PASS — UNIT ONLY | PASS — LIVE E2E | PASS — LIVE E2E | live-A-district-saved.png + live-A-district-reload.png + /opportunity/patch |
| Last field → قيد المطابقة | PASS — UNIT ONLY | PASS — LIVE E2E | PASS — LIVE E2E | live-A-district-saved.png + live-A-district-reload.png |
| Client interested | PASS — UNIT ONLY | PASS — LIVE E2E | PASS — LIVE E2E | live-C-client-interested.png + party/sessions/reply |
| Broker receives client update | PASS — UNIT ONLY | PASS — LIVE E2E | firestore livingStage=WAITING_PROPERTY_CONFIRMATION | live-D-broker-client.png |
| Owner available | PASS — UNIT ONLY | PASS — LIVE E2E | PASS — LIVE E2E | live-E-owner-available.png + party/sessions/reply |
| Broker receives owner update | PASS — UNIT ONLY | PASS — LIVE E2E | firestore livingStage=PROPERTY_AVAILABLE | live-F-broker-owner.png |
| Same taskId | PASS — UNIT ONLY | PASS — LIVE E2E | PASS — LIVE E2E | taskId before/after in report JSON |
| Cooperation data | PASS — UNIT ONLY | PASS — LIVE E2E | NOT RUN | live-G-cooperation.png |
| Live console / network | PASS — UNIT ONLY | PASS — LIVE E2E | NOT RUN | no unexpected pageerror/console.error |

## taskId

- before client: `mg_opp_livee2e_mt9u5kln_req`
- after client: `mg_opp_livee2e_mt9u5kln_req`
- after owner: `mg_opp_livee2e_mt9u5kln_req`

## Notes

- District save: HTTP 200 firestore=العزيزية_livee2e_mt9u5kln sheetGone=true
- Last field → قيد المطابقة: before=يحتاج استكمال afterSave=قيد المطابقة afterReload=قيد المطابقة
- Client interested: HTTP 200 replyAction=interested followUp=true loginChrome=0
- Broker receives client update: taskId mg_opp_livee2e_mt9u5kln_req → mg_opp_livee2e_mt9u5kln_req timelineVisible=true
- Owner available: HTTP 200 persisted=true
- Broker receives owner update: taskId mg_opp_livee2e_mt9u5kln_req → mg_opp_livee2e_mt9u5kln_req
- Same taskId: before=mg_opp_livee2e_mt9u5kln_req afterClient=mg_opp_livee2e_mt9u5kln_req afterOwner=mg_opp_livee2e_mt9u5kln_req
- Cooperation data: placeholder=false realNames=true listings=true
- Live console / network: no unexpected pageerror/console.error