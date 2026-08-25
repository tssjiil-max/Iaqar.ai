# IAQAR QA Test Matrix

Inventory of screens and actions, mapped to Playwright files.
Status is filled after the suite run.

Feature | Screen | Action | Expected Result | Test File | Status
---|---|---|---|---|---
Access Gate | `/` home | Open without login | Access Gate visible, no party shell | access-gate.spec.mjs | TBD
Access Gate | `/?cv2Party=` | Open valid party token | Party page, no office login, no role picker | access-gate.spec.mjs | TBD
Access Gate | `/?cv2Party=invalid` | Open invalid token | Safe invalid-link copy, no Access Gate | access-gate.spec.mjs | TBD
Navigation | QA harness | Tab المهام اليومية | Daily tasks panel only | navigation.spec.mjs | TBD
Navigation | QA harness | Tab العروض والطلبات | Inbox sections visible | navigation.spec.mjs | TBD
Navigation | QA harness | Tab إعداد المكتب | Cooperation settings only, no old ops page | navigation.spec.mjs | TBD
Navigation | QA harness | Reload / Back | Saved tab data remains | navigation.spec.mjs | TBD
Offers inbox | العروض والطلبات | Open tab | Incomplete under يحتاج استكمال | opportunity-editor.spec.mjs | TBD
Offers inbox | Incomplete card | Completeness copy | No 6/6 while fields missing | opportunity-editor.spec.mjs | TBD
Opportunity editor | Location sheet | Save city+district | Value rendered, survives reload | opportunity-editor.spec.mjs | TBD
Opportunity editor | Price sheet | Save price | Value rendered, survives reload | opportunity-editor.spec.mjs | TBD
Opportunity editor | Location sheet | Empty save | Error, sheet stays, no success toast | opportunity-editor.spec.mjs | TBD
Opportunity editor | Location sheet | Cancel | Sheet closes, value not saved | opportunity-editor.spec.mjs | TBD
Opportunity editor | Location sheet | Forced 500 | Error, sheet stays, no success toast | opportunity-editor.spec.mjs | TBD
Opportunity editor | Last missing field | Save district | Item moves to قيد المطابقة, toast, reload keeps it | opportunity-editor.spec.mjs | TBD
Opportunity editor | Phone sheet | Invalid number | Sheet stays | opportunity-editor.spec.mjs | TBD
Daily Tasks | Collapsed match | View card | Type, district, city, price, #A- reference | daily-tasks.spec.mjs | TBD
Daily Tasks | Match card | عرض البيانات | Comparison stays in Daily Tasks | daily-tasks.spec.mjs | TBD
Daily Tasks | Two cards | Open second | First collapses | daily-tasks.spec.mjs | TBD
Daily Tasks | Match card | Full details + close | Same open task, details hidden | daily-tasks.spec.mjs | TBD
Match group | One request + 3 offers | Open group | Single task, ranked candidates | daily-tasks.spec.mjs | TBD
Match group | No-match request | List | No fake task | daily-tasks.spec.mjs | TBD
Send to client | Match card | إرسال للعميل | wa.me deep-link + token, toast تم فتح واتساب | party.spec.mjs | TBD
Client party | Clean context | Open token | Listing data, no owner phone | party.spec.mjs | TBD
Client party | مهتم | Reply | Persists, broker timeline updates, reload both | party.spec.mjs | TBD
Client party | أحتاج تفاصيل أكثر | Follow-up | Price/location/photos/specs, reveal if known | party.spec.mjs | TBD
Owner party | After interest | العقار متاح | No client phone, broker timeline updates | party.spec.mjs | TBD
Cooperation | Collapsed | View | Named office + #C- reference | cooperation.spec.mjs | TBD
Cooperation | Expanded | طلب التعاون | Same task becomes waiting for named office | cooperation.spec.mjs | TBD
Cooperation | Partner office | قبول | Same id, no client phone | cooperation.spec.mjs | TBD
Cooperation | Request button | Double click | No duplicate cooperation id | cooperation.spec.mjs | TBD
Deal | Follow-up task | تأكيد إتمام الصفقة double click | One COMPLETED record, leaves active list | privacy-mobile.spec.mjs | TBD
Appointment | Mock slots | Double book | 409, no second booking | privacy-mobile.spec.mjs | TBD
Mobile | 360/390/430 | Expand match + send | No horizontal overflow, primary not clipped | privacy-mobile.spec.mjs | TBD
Bad data | District field | Very long text | No overflow | privacy-mobile.spec.mjs | TBD
Golden journey | Full path | Match → client → owner | Same task, correct next actor | golden-journey.spec.mjs | TBD

## Screens inventoried

- Access Gate (office login / role)
- Daily Tasks (content v2)
- Offers & Requests inbox
- Opportunity field editor (bottom sheet)
- Party client page
- Party owner page
- Office settings → التعاون بين المكاتب
- Import/voice/image intake (out of E2E scope this round)

## Actions inventoried (with expected results)

Accordion reveal, send client, send owner, request/accept/reject cooperation, confirm deal, share details, save/cancel field, complete missing, party interested/needs_details/not_suitable, owner available/unavailable, tab switch, reload, back.

## Untestable in this environment (and why)

- Live WhatsApp delivery — deep-link asserted only
- Voice intake / image import / text import — out of scope, require media APIs
- Firebase production persistence — QA uses namespaced in-memory store `qa_*`
- Appointment slot picker UI — no availableSlots UI in current Daily Tasks; double-book is API-level only
- Expired/revoked party TTL beyond explicit revoke — revoke supported in domain, no broker UI to expire by clock
- Matching engine internals — not modified; fixtures supply match rows
