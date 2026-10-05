# غرفة التفاوض — one room per deal

Each approved deal (journey) has its own room: `office_id + journey (deal) + offer (property) + owner + client + assigned broker`.
The sides open it with their private links (`/s#<token>`, no account); the broker opens `#/session/<journeyId>`.

## The three parts

1. **بيانات العقار** — main photo and the facts that fit this kind of property (`propertyFacts`): a land shows its area and the price per metre and never rooms; a flat shows rooms; unknown values are not shown.
2. **ما تم الاتفاق عليه** — the live summary (`roomAgreedItems`): only what both sides agreed, each with who accepted and when. A proposal is never listed. A proposed change to an agreed term is shown as «لم يُقبل بعد» while the agreed value stays in force.
3. **المالك مقابل العميل** — the two sides facing each other with what is expected from each (`partyStatus`), then the terms, then: طلب معلومات · جاهز للاتفاق · طلب تدخل الوسيط.

## Rules, not one form (`public/os/domain/negotiation-room-domain.js`)

- `propertyFamily(type)` → `UNIT · VILLA · LAND · BUILDING · COMMERCIAL · OTHER` (keyword table; a new type needs one keyword).
- `TERM_SETS[family][sale|rent]` lists the negotiable terms in order; `TERM_CATALOG` holds each term's fixed options. Rent terms never appear in a sale and vice versa.
- `INFO_TOPICS[family]` are the fixed topics of «طلب معلومات».
- Adding a term or a family is one entry in these tables; the pages and the Worker read the same rules.

## Moves (all validated and applied by the Worker — `POST /os/session/act`)

| Move | Who | Effect |
| --- | --- | --- |
| price moves, `accept`, `reject`, fixed-price answers, viewing slot moves | the side whose turn it is | unchanged from the session rules (`session-domain.js`) |
| `term_propose {termId, optionId}` | either side | the term waits for the other side; clears «جاهز للاتفاق» |
| `term_accept {termId, optionId}` / `term_reject {termId, optionId}` | the side that did not propose | the answer names the option the side saw — if the proposal changed meanwhile the server answers 409 and nothing is agreed. accept → agreed (time, proposer, accepter saved); reject → proposal removed, agreed value (if any) stays |
| `info_request {topicId}` | either side | a request to the broker (never shown to the other side) + a HIGH task |
| `intervention {message?}` | either side | the only free text a side can write; goes to the broker alone + a HIGH task |
| `ready` | either side, once the price is agreed and nothing is waiting | when both are ready the broker gets a task to complete the deal |

A side holds at most 3 unanswered requests, and may change its own unanswered proposal on a term twice before it must wait for the answer (later changes do not notify the broker again).
«قبول» on the price answers a price the other side actually proposed: the owner's asking price is his standing offer, but the client's budget is only a starting point until the client proposes a price.
«جاهز للاتفاق» counts only for the price agreed now; any new price or proposal resets it and withdraws the «both ready» task.

The main photo reaches a side through its own link (`POST /os/session/image {token}`), so no storage path, record id or office id appears in the side's page. Every move is one journey event (`SESSION_MOVE`) with `role`, `move`, the proposal, `prev` / `next` deal phase and, for terms, `termPrev` / `termNext`.

## The broker steps in when needed (`POST /os/session/request`)

For each request: **تمرير** (passed on as «نقل الوسيط عن …», phone numbers and links removed) · **إعادة صياغتها** (the broker's own wording, in his name) · **الرد على المرسل** · **عدم التمرير** · **عالجتها داخل الصفقة**.
Nothing reaches the other side unless the broker chooses so. Each decision is a `SESSION_REQUEST_HANDLED` event visible to the broker and the sender only; the room shows them under «سجل تدخلات الوسيط».

## WhatsApp

Not required for the room to work. `awaitingParties(journey)` says whose answer the deal is waiting for and `reminderText(journey, role, url)` builds the message with that side's room link. Today the broker sends it with one tap («تذكير», opens WhatsApp with the text); when the Cloud API is linked for the office the same two functions feed the automatic notification, under the office's automation level.
