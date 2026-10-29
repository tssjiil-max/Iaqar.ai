# IAQAR WA-AUTONOMOUS-BROKER — Implementation Contract (2026-10-29)

Status: DESIGN / NOT DEPLOYED. Branch is isolated from staging and production.

## Purpose
Official WhatsApp Business Cloud API channel for a tenant-aware real estate agent capable of inbound intake, structured extraction, deduplication, offer/request matching, permitted outbound follow-ups, bounded negotiation, viewing coordination and human approval of every binding agreement.

## Nonnegotiable protections
- **No production send or account migration in this phase.** Existing Business Suite inbox linkage is not proof of Cloud API coexistence. Verify eligibility only via official Embedded Signup flow supporting WhatsApp Business app coexistence. Never deregister or migrate a live number automatically.
- Existing WhatsApp Business mobile app, chat history and Business Suite link must remain unchanged until the account owner reviews a verified eligibility result and explicitly authorizes activation.
- Group messages are not available through ordinary Cloud API inbound. Broker Radar notifications may form a separately consented intake source, never a bypass of official WhatsApp restrictions.
- Tenant separation: officeId must be derived from a verified phone_number_id <-> tenant mapping maintained server side, never trusted from webhook payload fields supplied by a browser.
- Do not disclose another owner's contact number to a buyer without permission. Avoid storing unrelated private chats.
- AI does not sign, promise binding sale/lease terms, accept deposits, promise commissions, or close a transaction. All binding commitments require authenticated office owner approval.
- Outbound messages must meet Meta opt-in, template, 24-hour customer service window, quality and rate-limit requirements. No spam, group scraping or arbitrary cold outreach.
- Protect webhook verification challenge, Meta signature (X-Hub-Signature-256), app secrets, access tokens, phone identifiers and customer data. Credentials stay in a secret manager, not source control/client.
- Default flag: WHATSAPP_OUTBOUND_ENABLED=false, NEGOTIATION_AUTO_SEND_ENABLED=false. Admin kill switch always available. Existing outbound guards remain enforced unless integration tests and explicit authorization pass.

## Target architecture
Official Meta webhook (verify signature) -> durable idempotent inbox/queue -> tenant+phone resolver -> consent/opt-out check -> Arabic listing/request extractor with explicit unknown states -> entity normalization -> deduplication -> office-scoped matching engine -> lead/opportunity record -> policy-controlled agent planner -> per-tenant outbound queue -> Cloud API sender -> delivery/read status tracker.
A separate Deal Room records each negotiation event and evidence, escalations, approvals, and audit activity.

## Agent responsibilities
1. IntakeAgent: identify intent (sell/buy/rent/other), property type, city/neighborhood, area, price, communication number, source, confidence; request missing details.
2. MatchAgent: apply hard constraints first (transaction type, region, price bounds), then preferred criteria; explain scores without fabricating listings.
3. ConversationAgent: draft truthful replies and send only if channel is authorized, opt-in documented, within allowed session/template rules, and office auto-send flag enabled.
4. NegotiationAgent: propose counteroffers only within a **per-deal explicitly approved** bounded policy; enforce min/max, max increments, max rounds, expiry, sender/recipient identity, and no conflicting concurrent negotiations. On ambiguity, pressure, requests for confidential data, or final binding term, escalate to human.
5. ViewingAgent: coordinate suggested times after checking availability and consent; confirmations only with evidence of participant acceptance.
6. HumanApprovalAgent: immutable approval request with exact terms and version; explicit owner decision; replay/idempotency protection; no action when expired.

## Domain model (proposed)
WhatsAppChannel { officeId, wabaId, phoneNumberId, appCoexistenceState, lastVerifiedAt, outboundEnabled, consentMode }
InboundMessage { officeId, providerMessageId, conversationId, timestamp, senderHash, encryptedPayload, parsedType, intakeStatus }
CustomerConsent { officeId, contactId, source, timestamp, scope, withdrawnAt }
PropertyLead { officeId, origin, propertyType, operation, city, neighborhood, areaM2, priceSar, currency, ownerContactRestricted }
Match { officeId, listingId, requestId, score, reasons, verificationState }
NegotiationPolicy { officeId, dealId, minSar, maxSar, approvedBy, expiry, maxRounds, maxStepSar, enabled }
NegotiationEvent { officeId, dealId, proposalVersion, proposalSar, proposedBy, evidenceId, state, createdAt }
Approval { officeId, dealId, termsHash, requestVersion, approvedBy, approvedAt, state }
OutboundMessage { officeId, recipient, channelId, messageType, templateId, consentProof, idempotencyKey, deliveryState }
AuditEvent { officeId, actor, action, targetId, decision, timestamp }

## Work packages, in dependency order
P0-A Inspect actual deployed Firebase staging versus GitHub main and current open PRs. Preserve working design and existing functions.
P0-B Write failing tests for signature verification, duplicate event delivery, tenant isolation and missing consent; implement ingestion as receive-only and verify.
P0-C Test eligible Coexistence onboarding in official Embedded Signup without committing account changes. If ineligible, propose a new isolated test number; do not risk personal known number.
P0-D Implement normalized intake + deduplication + match pipelines; run replay tests with synthetic Saudi Arabic offers/requests.
P1-E Draft-only conversations, human approvals and consent enforcement; verify no outbound sends.
P1-F Add template/session-bound sender in isolated staging test number, delivery callbacks, budget and rate guards; enable only after owner activation.
P1-G Implement bounded negotiation agent with policy evaluator and immutable audit; test proposals outside range and binding terms must never auto-send.
P1-H Pilot one office on approved number before enabling per-office multi-tenant onboarding.

## Acceptance gates
- No production impact before separate signed release.
- WhatsApp app stays operational and messages retain expected behavior throughout account eligibility assessment.
- Replay identical webhook 100 times -> exactly one business event and no duplicate send.
- Spoofed signature -> rejected; unknown phoneNumberId -> quarantined.
- Cross-office message/customer/match exposure -> zero; enforce server authorization tests.
- Reply after 24h without approved template -> blocked; opt-out -> immediate stop.
- Out-of-range offer, unapproved binding agreement, expired approval -> blocked.
- Synthetic tests: missing price/area, Arabic digits, 966 and 05 numbers, duplicate listing, conflicting offers, stale inventory.
- Full Worker regression suite + Firestore emulator integration + Playwright critical flows + operator acceptance before merge.
- Secrets redacted from logs; monitoring, alerting, rollback and kill switch tested.

## Status and next action
This document authorizes **engineering preparation only**. It does not authorize production messaging or modifying the known WhatsApp number. Next action: establish deployed staging commit and baseline tests, then implement P0-B with tests-first in this branch or a rebased child branch.
