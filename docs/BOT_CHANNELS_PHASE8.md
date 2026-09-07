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
