# IAQAR QA Test Matrix

Inventory of screens and actions, mapped to Playwright files.
Status is from the last full suite: **39 passed, 0 failed**.

Feature | Screen | Action | Expected Result | Test File | Status
---|---|---|---|---|---
Access Gate | `/` home | Open without login | Access Gate visible, no party shell | access-gate.spec.mjs | PASS
Access Gate | `/?cv2Party=` | Open valid party token | Party page, no office login, no role picker | access-gate.spec.mjs | PASS
Access Gate | `/?cv2Party=invalid` | Open invalid token | Safe invalid-link copy, no Access Gate | access-gate.spec.mjs | PASS
Navigation | QA harness | Tab المهام اليومية | Daily tasks panel only | navigation.spec.mjs | PASS
Navigation | QA harness | Tab العروض والطلبات | Inbox sections visible | navigation.spec.mjs | PASS
Navigation | QA harness | Tab إعداد المكتب | Cooperation settings only, no old ops page | navigation.spec.mjs | PASS
Navigation | QA harness | Reload / Back / Forward | Saved tab data remains | navigation.spec.mjs | PASS
Offers inbox | العروض والطلبات | Open tab | Incomplete under يحتاج استكمال | opportunity-editor.spec.mjs | PASS
Offers inbox | Incomplete card | Completeness copy | No 6/6 while city/district/price/area missing | opportunity-editor.spec.mjs | PASS
Opportunity editor | Location sheet | Save city+district | Value rendered, survives reload | opportunity-editor.spec.mjs | PASS
Opportunity editor | Price sheet | Save price | Value rendered, survives reload | opportunity-editor.spec.mjs | PASS
Opportunity editor | Area sheet | Save area | Value rendered, survives reload | opportunity-editor.spec.mjs | PASS
Opportunity editor | Advertiser sheet | Save صفة المعلن | Value rendered, survives reload | opportunity-editor.spec.mjs | PASS
Opportunity editor | Location sheet | Empty save | Error, sheet stays, no success toast | opportunity-editor.spec.mjs | PASS
Opportunity editor | Location sheet | Cancel / outside click | Sheet closes, value not saved | opportunity-editor.spec.mjs | PASS
Opportunity editor | Location sheet | Forced 500 | Error, sheet stays, no success toast | opportunity-editor.spec.mjs | PASS
Opportunity editor | Last missing field | Save district | Item moves to قيد المطابقة, toast, reload keeps it | opportunity-editor.spec.mjs | PASS
Opportunity editor | Phone sheet | Invalid number | Sheet stays with error | opportunity-editor.spec.mjs | PASS
Daily Tasks | Collapsed match | View card | Type, district, city, price, #A- reference | daily-tasks.spec.mjs | PASS
Daily Tasks | Match card | عرض البيانات | Comparison stays in Daily Tasks | daily-tasks.spec.mjs | PASS
Daily Tasks | Two cards | Open second | First collapses | daily-tasks.spec.mjs | PASS
Daily Tasks | Match card | Full details + close | Same open task, details hidden | daily-tasks.spec.mjs | PASS
Match group | One request + 3 offers | Open group | Single task, ranked candidates | daily-tasks.spec.mjs | PASS
Match group | No-match request | List | No fake task | daily-tasks.spec.mjs | PASS
Send to client | Match card | إرسال للعميل | wa.me deep-link + token, toast تم فتح واتساب | party.spec.mjs | PASS
Client party | Clean context | Open token | Listing data, no owner phone | party.spec.mjs | PASS
Client party | مهتم | Reply | Persists, broker timeline updates, reload both | party.spec.mjs | PASS
Client party | أحتاج تفاصيل أكثر | Follow-up | Price/location/photos/specs, reveal if known | party.spec.mjs | PASS
Client party | غير مناسب | Reply | Persists after reload | party.spec.mjs | PASS
Owner party | After interest | العقار متاح | No client phone, broker timeline updates | party.spec.mjs | PASS
Owner party | غير متاح حالياً | Reply | Task leaves active list as MATCH_EXHAUSTED | party.spec.mjs | PASS
Cooperation | Collapsed | View | Named office + #C- reference | cooperation.spec.mjs | PASS
Cooperation | Expanded | طلب التعاون | Same task becomes waiting for named office | cooperation.spec.mjs | PASS
Cooperation | Partner office | قبول | Same id, no client phone | cooperation.spec.mjs | PASS
Cooperation | Partner office | رفض | Same id removed after reject, no client phone | cooperation.spec.mjs | PASS
Cooperation | Request button | Double click | No duplicate cooperation id | cooperation.spec.mjs | PASS
Deal | Follow-up task | تأكيد إتمام الصفقة double click | One COMPLETED record, leaves active list | privacy-mobile.spec.mjs | PASS
Appointment | Mock slots | Double book | 409, no second booking | privacy-mobile.spec.mjs | PASS
Mobile | 360/390/430 | Expand match + send | No horizontal overflow, primary not clipped | privacy-mobile.spec.mjs | PASS
Bad data | District field | Very long text | No overflow | privacy-mobile.spec.mjs | PASS
Golden journey | Full path | Match → client → owner | Same task, correct next actor | golden-journey.spec.mjs | PASS

## Screens inventoried (8) / exercised in E2E (7)

- Access Gate (office login / role)
- Daily Tasks (content v2)
- Offers & Requests inbox
- Opportunity field editor (bottom sheet)
- Party client page
- Party owner page
- Office settings → التعاون بين المكاتب
- Import/voice/image intake (out of E2E scope this round)

## Actions inventoried (42 mapped rows)

Accordion reveal, send client, send owner, request/accept/reject cooperation, confirm deal, save/cancel/outside-click field, complete missing, party interested/needs_details/not_suitable, owner available/unavailable, tab switch, reload, back, forward, double-click cooperation/deal, mobile overflow.

## Untestable in this environment (and why)

- Live WhatsApp delivery — deep-link asserted only
- Voice intake / image import / text import — out of scope, require media APIs
- Firebase production persistence — QA uses namespaced in-memory store `qa_*`
- Appointment slot picker UI — no availableSlots UI in current Daily Tasks; double-book is API-level only
- Expired/revoked party TTL beyond explicit revoke — revoke supported in domain, no broker UI to expire by clock
- Matching engine internals — not modified; fixtures supply match rows
- Production worker CORS from a nested `/qa/` path — party listing flows use `/qa/party.html` against the in-memory worker; Access Gate skip is still asserted on production `/`
