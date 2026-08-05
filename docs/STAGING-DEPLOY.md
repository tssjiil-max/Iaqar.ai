# IAQAR.AI — Phase 9A Full-Functional Staging Deployment

Staging is a **non-production** path that must be **fully functional** (Worker
backend + Hosting channel), not a UI shell talking to a dead Worker. It must never
overwrite the live Hosting site or the production Worker.

## What staging is

| Surface | Staging target | Production target |
| --- | --- | --- |
| Cloudflare Worker | `iaqar-intake-staging` (`wrangler --env staging`) | `iaqar-macrodroid-intake` |
| Firebase project | **`iaqar-ai-staging`** | `aqar-b5d76` |
| Firebase Hosting | preview channel `staging` on `iaqar-ai-staging` | live Hosting (`aqar-b5d76`) |
| Firestore / Auth | project `iaqar-ai-staging` | project `aqar-b5d76` |
| R2 media | same bucket `iaqar-media` (office-scoped paths) | same |
| Hourly follow-up cron | **disabled** on staging Worker | enabled on production |

Client wiring: `public/js/runtime-config.js` sends Hosting channel hosts that contain
`--staging` to the staging Worker and sets `firebaseProjectId` to `iaqar-ai-staging`.
Production hosts keep the production Worker + `aqar-b5d76`.

## Full-functional definition

Staging is full-functional only when **all** of the following hold:

1. Staging Worker is deployed (`iaqar-intake-staging`)
2. Staging Hosting channel is deployed on **`iaqar-ai-staging`**
3. Worker `/health` reports `deploymentEnvironment: "staging"`,
   `projectId: "iaqar-ai-staging"`, `firebaseConfigured: true`, `backendReady: true`,
   `outboundMessaging: false`, `cronEnabled: false`
4. Browser on the channel has `window.IAQAR.workerBase` → staging Worker
5. Channel uses `/__/firebase/init.js` for project `iaqar-ai-staging`

## Required credentials (no FIREBASE_TOKEN)

Set these before `npm run deploy:staging`:

### Cloudflare
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

**Minimum Cloudflare API token permissions** (Account scope):

1. **Workers Scripts — Edit**
2. **Workers R2 Storage — Edit** (staging Worker binds `iaqar-media`)
3. **Account Settings — Read**

Create at: Cloudflare Dashboard → **My Profile → API Tokens** (or **Manage Account →
Account API Tokens**) → Create Token → custom token with the permissions above.

**Where to find `CLOUDFLARE_ACCOUNT_ID`:** Cloudflare Dashboard → any account page
(Workers & Pages / overview) → **Account ID** in the right sidebar (also visible in
the account home URL / Workers overview).

### Firebase staging service account (project `iaqar-ai-staging`)
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_PRIVATE_KEY_ID`

`FIREBASE_TOKEN` / `firebase login:ci` is **not used**. The deploy script builds a
temporary JSON key, sets `GOOGLE_APPLICATION_CREDENTIALS`, runs firebase-tools, syncs
the same secrets onto the staging Worker, then deletes the temp file (never committed,
never printed).

Recommended IAM on that service account for Hosting channel deploy:
- Firebase Hosting Admin
- Firebase Authentication Admin (channel authorized-domain sync)
- (Worker already uses the same SA against Firestore/Auth APIs)

Optional (FCM push on staging): `FCM_WEB_PUSH_VAPID_KEY` for the staging Worker.

Leave `META_*` empty — outbound Cloud API stays blocked; drafts/handoff still work.

## Cloud Agent secret injection

Repo / environment secrets added **after** a Cloud Agent run started are **not**
visible in that already-running session. Start a **new** Cloud Agent run (with the
secrets configured for the environment/repo) so
`FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` / `FIREBASE_PRIVATE_KEY_ID` (and
Cloudflare vars) are present in the process environment before deploy.

## Deploy (staging only) — do not run until owner approves live deploy

```bash
npm run deploy:staging
# or
./scripts/deploy-staging.sh
```

The script:

1. Runs `npm test` + `npm run check`
2. Writes a temp GAC file from the three Firebase SA secrets → `GOOGLE_APPLICATION_CREDENTIALS`
3. Deploys **only** `wrangler deploy --env staging`
4. Syncs Worker staging secrets from the same env vars (values not printed)
5. Deploys **only** `firebase hosting:channel:deploy staging --project iaqar-ai-staging`
6. Requires `/health` `backendReady: true` and `projectId: iaqar-ai-staging`
7. Runs `scripts/smoke-staging.mjs`
8. Deletes the temp GAC file on exit
9. **Refuses** bare production deploy commands; ignores `FIREBASE_TOKEN` if set

## After deploy

1. Open the printed Hosting channel URL (`iaqar-ai-staging--staging-…`).
2. Confirm `window.IAQAR.deploymentEnvironment === "staging"`.
3. Confirm `window.IAQAR.firebaseProjectId === "iaqar-ai-staging"`.
4. Confirm `window.IAQAR.workerBase` ends with `iaqar-intake-staging`.
5. Hit staging Worker `/health` — `backendReady: true`, `projectId: iaqar-ai-staging`.

## Explicitly out of Phase 9A

- Production Worker or live Hosting deploy (Phase 9B / owner-run `deploy-all`)
- Automatic WhatsApp/Telegram send (Q-3)
- Deals page / bottom navigation / home redesign
