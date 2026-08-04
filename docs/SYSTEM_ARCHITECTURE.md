# IAQAR.AI System Architecture

## Current connected architecture

| Layer | Implementation | Evidence |
|---|---|---|
| Hosting/UI | Static Arabic RTL mobile-first app | `public/index.html` |
| Access and public intake | Firebase Auth gate, office membership check, public owner/customer forms | `public/js/access-gate.js` (`bootstrapAccess`, `verifyAccess`, `publicOffice`, `intakeForm`) |
| Tenant runtime | Resolves `officeId`; creates office-scoped Firestore references | `public/js/firebase-office.js` (`resolveOfficeId`, `createOfficePaths`) |
| Office settings | Office profile, visual identity, public link, notification preferences, cooperation mode | `public/js/office-settings.js` |
| Opportunity Bank entry | Authenticated, office-scoped read-only Phase 1 shell | `public/js/opportunity-bank.js` |
| Live workflow | Match/intake/internal result listeners, FCM registration, workflow actions | `public/js/workflow-office.js` |
| PWA/push | Web manifest, share target, service worker, FCM/FID bridge | `public/manifest.webmanifest`, `public/share-target.html`, `public/firebase-messaging-sw.js`, `public/js/fcm-fid.js` |
| Privileged backend | Cloudflare Worker monolith | `worker/src/index.js`, `worker/wrangler.toml` |
| Primary data | Firestore, rooted at `offices/{officeId}` for tenant data | `firestore.rules`, `public/js/firebase-office.js` |
| Media | Cloudflare R2 binding `IAQAR_MEDIA` | `worker/wrangler.toml`, Worker `/media/*` routes |
| Notifications | FCM HTTP v1 through the Worker; in-app Operations fallback | Worker `/fcm/*`, `sendOfficePush`; `public/js/workflow-office.js` |
| Tests | Node built-in test runner | `worker/test/worker.test.mjs`, `worker/test/phase1.test.mjs` |

Firebase Hosting rewrites `/o/**` to `public/index.html` (`firebase.json`). Public handles resolve through `officeHandles/{handle}`, with a read-only legacy fallback query on `publicOffices.publicSlug`.

## Phase 1 request paths

### Office settings save

1. The authenticated manager submits the form in `public/js/office-settings.js`.
2. Images are validated and cropped in the browser.
3. `POST /office/settings` validates manager authorization and normalizes the office name on the Worker.
4. A Firestore transaction reads the office, normalized name claim, and public handle.
5. The transaction atomically updates:
   - `offices/{officeId}`
   - `publicOffices/{officeId}`
   - `officeNameClaims/{normalizedName}`
   - `officeHandles/{publicSlug}`
6. Conflicting normalized claims fail with a clear Arabic error.

Direct client writes cannot change the office name, ownership fields, public office projection, name claims, or handle claims (`firestore.rules`).

### Visual identity

`POST /media/office-image` and `DELETE /media/office-image` require an authenticated office manager and an `X-Office-Id` matching the authorized tenant. Files are restricted to JPEG, PNG, or WebP and 10 MB. R2 keys are:

```text
office-images/{officeId}/logo
office-images/{officeId}/display
office-images/{officeId}/whatsapp-cover
```

The legacy `POST /media/office-cover` route remains as a compatible alias for the display image. Public reads are restricted to validated office-image paths.

### Notifications

Device registration remains in `offices/{officeId}/devices`. The Worker reads the office notification preference category before FCM delivery. A disabled category returns a skipped result and does not enumerate/send to devices. The device-level enable/disable control remains separate.

## Current constraints

- The Worker is a single JavaScript module that combines auth, Meta webhook intake, matching, workflow, FCM, media, office settings, and administration.
- The current matching/workflow implementation still uses historical `clients`, `owners`, `matches`, and internal `deals` collections. The separate Deals home surface has been removed, but collection migration belongs to later approved phases.
- Existing parser and matching paths are Madinah-oriented and deterministic; no external AI extraction provider is connected.
- Meta and FCM production behavior depends on runtime secrets and platform configuration. Code and fixtures do not prove live delivery.
- R2, not Firebase Storage, is the existing media layer and is preserved.
- There is no root build tool, frontend framework, linter, TypeScript compiler, or browser E2E harness.

## Approved target architecture

The existing stack remains. Later phases evolve the domain behind stable adapters:

```text
Authorized source
  -> Worker validation/storage
  -> Firestore event outbox/background job
  -> extraction/normalization adapter
  -> unified Opportunity
  -> automatic idempotent matching
  -> actionable Operation
  -> preference-aware notification
  -> broker-reviewed message draft
```

A Firestore-backed outbox/job design is acceptable. A new message broker, framework, database, hosting provider, or state-management architecture requires explicit approval.

## Security boundaries

- Firestore rules enforce office membership and `officeId` for client-accessible tenant records.
- Worker routes independently validate Firebase identity, office membership/role, and target `officeId`.
- Service-account writes bypass rules and therefore require backend validation and protected-field allowlists.
- Public projections contain only approved office profile data. Internal settings, notification preferences, cooperation controls, and tenant records are not public.
- Cross-office data access remains prohibited until an explicit cooperation permission model is implemented in Phase 6.
