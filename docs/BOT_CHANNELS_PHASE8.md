# Bot & Channels — Phase 8 cleanup

## Canonical boundary

WhatsApp and Telegram are transport adapters. They may accept inbound data, create drafts, alert, or hand off to an external app. They do not own Matching, Negotiation, Viewing, Deal, or Cooperation state.

Inbound text is routed through Canonical Intake. Channel adapters must not create legacy client/owner records and then run Matching directly.

## Telegram

- Runtime route: `POST /telegram/webhook/:officeId`
- Requires `X-Telegram-Bot-Api-Secret-Token` matching `TELEGRAM_WEBHOOK_SECRET`.
- `TELEGRAM_OFFICE_ID` may lock the runtime to one office scope.
- Text and supported downloaded media feed Canonical Intake with an idempotency key based on Telegram update ID.
- Media requires `TELEGRAM_BOT_TOKEN` and the private media bucket.
- Outbound Bot API sending is disabled in this phase.

## WhatsApp

- Official Meta webhook remains inbound-only.
- Text goes through Canonical Intake.
- Inbound media without a wired media adapter is retained as `pending_review / needs_media_adapter`; it is not falsely marked processed or failed as a business transaction.
- Existing external WhatsApp handoff does not mean provider send or delivery.

## Provider evidence

A transport adapter may not claim `SENT`, `DELIVERED`, or `READ` without explicit provider evidence. Opening an external handoff URL is not a provider-confirmed send.

## Runtime configuration

No production credentials or secrets are stored in this repository. Live Telegram use still requires configuring the webhook secret, bot token, office scope, and webhook registration outside the codebase.


## Office-linked channels (Office OS — «قنوات المكتب»)

Each office links its own channels from `#/settings/channels`; the server stores the link against the office id and uses it to route inbound messages. Nothing here sends a message.

### Telegram — one platform bot, many offices

- Runtime route: `POST /telegram/webhook` (no office in the address). The per-office route above keeps working unchanged.
- Needs `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (secrets) and `TELEGRAM_BOT_USERNAME` (plain var, the bot's public username). Until all three exist the screen says «بوت المنصة غير مفعّل» and offers no button.
- Point the bot at the central route once: `setWebhook(url = <worker>/telegram/webhook, secret_token = TELEGRAM_WEBHOOK_SECRET)`.
- Linking: the manager presses «ربط تيليجرام» → `POST /os/channels/telegram/link` returns `https://t.me/<bot>?start=<code>` (one use, 15 minutes; only the SHA-256 of the code is stored). The manager opens it and presses Start; the update `/start <code>` links that chat to the office.
- Routing truth: `telegramChats/{chatId}` → `officeId` (top level, closed to every client by the rules; also `telegramLinkCodes`, `telegramOfficeLinks`). A chat serves one office; an unlinked chat is ignored; a chat linked elsewhere is refused and shown as «خطأ في الربط».
- States on screen: غير مرتبط · بانتظار إتمام الربط · مرتبط · خطأ في الربط; actions: ربط · إعادة الربط · فصل (`POST /os/channels/telegram/unlink`).

### WhatsApp — per-office number, Cloud API with coexistence

- Linking uses Meta Embedded Signup with the existing `POST /meta/signup/complete` (token exchange + `subscribed_apps` only; the number is never registered or migrated by this Worker).
- `META_ONBOARDING_MODE` (plain var): `coexistence` (default) adds `featureType: "whatsapp_business_app_onboarding"` so the number stays on the WhatsApp Business app; `standard` is the classic flow. `/meta/config` returns the mode.
- Needs `META_APP_ID`, `META_CONFIG_ID` (public identifiers) and `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` (secrets). Until then the screen says the official link is not enabled and offers no button.
- Routing truth stays `whatsapp_accounts/{phoneNumberId}` (`status == "connected"`). «فصل» (`POST /os/channels/whatsapp/disconnect`, manager) sets it to `disconnected`; nothing is deleted and the business keeps its WhatsApp account.
- Status for the screen: `POST /os/channels/status` (member) — state, masked number, webhook readiness, today's inbound count. No token, WABA id or phone-number id is returned.

### Message classes («مركز التواصل», `#/inbox`)

- Inbound text is classified by `public/os/domain/message-class-domain.js`: اجتماعية · استفسار · متعلقة بصفقة · عرض · طلب · غير مصنّفة.
- Only a clearly non-property message (greeting, short question, deal follow-up) is kept out of Canonical Intake: its inbox document gets `messageClass`, `messageClassReason`, `processingState: "kept"`. Everything else is processed as before. Nothing is dropped.
- A broker can turn a kept message into a record: `POST /os/inbox/convert` (member) runs the same inbound pipeline and writes an audit entry.
