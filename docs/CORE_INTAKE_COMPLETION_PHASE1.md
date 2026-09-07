# Core + Intake + Data Completion — Phase 1

## Scope

This phase stabilizes the canonical Opportunity completion contract before any Matching, Negotiation, Viewing, Deal, Collaboration, or UI source migration.

## Source of truth

- `Opportunity` remains the canonical OFFER / REQUEST record.
- `evaluateMatchingReadiness()` remains the matching algorithm gate during migration.
- `evaluateOpportunityCoreReadiness()` is the canonical pre-matching completion gate and adds structural `opportunityKind` validation without silently changing matching-engine semantics.
- Data Completion always patches the same Opportunity; it never creates a replacement Opportunity.

## Additive persistence plan

A new Worker-only office subcollection is introduced:

`offices/{officeId}/completionSessions/{sessionId}`

The collection is additive and requires no backfill. Existing Opportunities, Matches, Operations, Deals, and Party Sessions are not migrated or renamed.

A completion session stores only:

- opaque `sessionId`
- `officeId`
- `opportunityId`
- SHA-256 `tokenHash` (never the raw token)
- `status`: OPEN / COMPLETED / EXPIRED / REVOKED
- `allowedFields`
- created / updated / expiry / completion timestamps
- creator audit value

The browser never reads or writes this Firestore collection directly. All reads and writes are through Worker routes after opaque-token verification.

## Security invariants

1. Raw Opportunity / office IDs are not embedded in the public token.
2. The stored session record never contains the raw token.
3. A party may patch only fields present in `allowedFields` for that session.
4. Ownership, office IDs, lifecycle, match IDs, deal IDs, and routing fields are never accepted from the public completion page.
5. A terminal or expired session cannot be reused.
6. Public response projection contains office branding + safe Opportunity summary only.

## Transition behavior

- Incomplete Opportunity -> existing `MISSING_DATA` Operation remains authoritative.
- Completion submission patches the same Opportunity.
- Core readiness is recalculated after every accepted submission.
- Still incomplete -> session remains OPEN with the remaining fields.
- Complete -> session becomes COMPLETED; later integration will close MISSING_DATA and request matching exactly once.

## Rollback

This phase is additive. Rollback is deleting the completion-session routes/service and leaving the new collection unread. No existing business record requires rollback or data migration.

## Explicitly not in this phase

- No Production or Staging deploy.
- No deletion of legacy Intake / Daily Tasks fallbacks.
- No Matching engine rule changes.
- No Negotiation / Viewing / Deal state changes.
- No automatic WhatsApp or Telegram sends.
