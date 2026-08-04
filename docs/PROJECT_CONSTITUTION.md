# IAQAR.AI — Project Constitution

**Version:** 1.0  
**Authority:** PROJECT CONSTITUTION (highest)  
**Status:** APPROVED AND MANDATORY

This document captures the non-negotiable product rules from the Master Engineering Directive. Implementation must not contradict it.

## Supreme product rule

> THE SYSTEM WORKS IN THE BACKGROUND. THE BROKER SEES ONLY THE NEXT REQUIRED ACTION.

## Product definition

IAQAR.AI is an intelligent operating system for real-estate offices and licensed brokers — not a public listings website.

The system must receive opportunities, analyze/normalize them, extract structured data, store usable opportunities, rematch automatically, create operations only when broker action is needed, prepare WhatsApp/Telegram drafts, notify the correct office/broker, enable controlled cooperation, and preserve ownership and office privacy.

## Roles

- Internal: real-estate office, licensed broker, authorized team members (later).
- External: property owner, customer, cooperating broker.
- External participants must not access the Opportunity Bank, matching logic, other offices, unrelated cooperation, internal operations, or scoring.

## Tenant isolation

Every office-scoped record must include `officeId`. Broker-scoped records include `brokerId` and `officeId` where applicable. No office may read, modify, query, or infer another office’s data except through an explicit approved cooperation record with minimum necessary exposure.

Frontend hiding alone is not security. Firestore rules and backend authorization must enforce isolation.

## Approved home page

Only:

1. Office Card
2. Add Opportunity
3. Operations Center

Forbidden without approval: bottom navigation, deals page, separate settings button, unapproved widgets, static demo operations, unrequested menu items/status labels.

## Visual language (preserve)

Arabic, RTL, mobile-first, clean white background, light green accents, dark green headings, rounded cards, soft shadows, spacious, simple. Do not redesign the approved layout.

## Office Card

Displays: logo, cover/display image, office name, broker name, license number, city, approved services summary.

Settings open only by clicking logo or cover (accessible targets, keyboard support, subtle feedback). No standalone Settings button.

## Office Settings (approved sections)

1. Visual identity (logo, display image, wide WhatsApp-compatible cover) with upload/preview/crop/replace/remove/save/validation/loading/error. Cover crop ratio must be a configurable design setting.
2. Office data only: office name, broker name, license number, city, mobile. No email field.
3. Unique office name (≥4 visible chars, system-wide normalized uniqueness, race-safe backend enforcement, Arabic/Latin, no silent renames). Stable handle/slug for URLs when needed.
4. Office link: copy, share, QR, preview.
5. Notification preferences (match, owner/customer, cooperation, message, appointment/follow-up, important system).
6. Opportunity Bank entry: “بنك الفرص” (not a permanent home section).
7. Smart cooperation: DISABLED | APPROVAL_REQUIRED (default) | SMART_AUTOMATIC.

## Opportunity and operations rules (summary)

- Unified Opportunity model; sources are ingestion channels, not home sections.
- No match → save to bank; do not create an Operations item merely for storage.
- Matching is automatic, idempotent, threshold-driven.
- Operations Center shows actionable items only.
- No Deals page (`الصفقات`).
- Default outbound messaging: draft + broker review; do not auto-send without approved policy.
- Mock integrations must be labeled honestly.

## Execution rules

- Preserve stack: Firebase Auth, Firestore, FCM, R2/storage via Worker, PWA, existing rules/tests, Arabic RTL UI.
- Implement one approved phase at a time.
- A feature is “working” only when connected, persisted, access-controlled, tested, and free of fake production data.
- Do not invent missing business decisions.

## Current phase gate

Phase 0 (audit + governance) and Phase 1 (Office Card + Office Settings) only. Do not start Phase 2 without owner approval of the Phase 1 report.
