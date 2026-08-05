# IAQAR.AI — Phase 9A Full-Functional Staging Deployment

Staging is a **non-production** path that must be **fully functional** (Worker
backend + Hosting channel), not a UI shell talking to a dead Worker. It must never
overwrite the live Hosting site or the production Worker.

## What staging is

| Surface | Staging target | Production target |
| --- | --- | --- |
| Cloudflare Worker | `iaqar-intake-staging` (`wrangler --env staging`) | `iaqar-macrodroid-intake` |
| Firebase Hosting | preview channel `staging` | live Hosting (`aqar-b5d76`) |
| Firestore / Auth | same project `aqar-b5d76` (explicit Phase 9A choice) | same |
| R2 media | same bucket `iaqar-media` (office-scoped paths) | same |
| Hourly follow-up cron | **disabled** on staging Worker | enabled on production |

Client wiring: `public/js/runtime-config.js` sends Hosting channel hosts that contain
`--staging` to the staging Worker URL. Production hosts keep the production Worker.
Staging hosts **never** fall back to the production Worker.

## Full-functional definition

Staging is full-functional only when **all** of the following hold:

1. Staging Worker is deployed (`iaqar-intake-staging`)
2. Staging Hosting channel is deployed (`--staging`)
3. Worker `/health` reports `deploymentEnvironment: "staging"`,
   `firebaseConfigured: true`, `backendReady: true`, `outboundMessaging: false`,
   `cronEnabled: false`
4. Browser on the channel has `window.IAQAR.workerBase` → staging Worker
5. Channel uses `/__/firebase/init.js` (same project, channel-local)

Without Worker Firebase secrets, Hosting alone is **UI-only** (forms may write
publicIntake client-side; phone login / matching / ops / messages / FCM fail with
`firebase_not_configured`). `npm run deploy:staging` **refuses** to complete in
that state.

## Required credentials

Set these in the environment before running the staging deploy script:

- `CLOUDFLARE_API_TOKEN` — Workers deploy permission
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account id
- `FIREBASE_TOKEN` — from `firebase login:ci` (**needs Auth Admin** so the channel
  domain is authorized for Firebase Auth)

Worker secrets for the **staging** env (set once with Wrangler) — **required** for
full-functional backend:

```bash
cd worker
npx wrangler secret put FIREBASE_CLIENT_EMAIL --env staging
npx wrangler secret put FIREBASE_PRIVATE_KEY --env staging
npx wrangler secret put FIREBASE_PRIVATE_KEY_ID --env staging
```

Optional (FCM push on staging):

```bash
npx wrangler secret put FCM_WEB_PUSH_VAPID_KEY --env staging
# or set [env.staging.vars] FCM_WEB_PUSH_VAPID_KEY
# optional: FIREBASE_WEB_API_KEY
```

Leave `META_*` empty — outbound Cloud API stays blocked; drafts/handoff still work.

## Shared-project side effects (honesty)

Phase 9A reuses project `aqar-b5d76` and R2 `iaqar-media`. That means:

- Staging Auth users and Firestore data are the **same** as production
- Staging media keys land in the **same** R2 bucket (office-scoped paths)
- Matching / intake / ops / message drafts written via staging Worker mutate **live** data
- Staging cron is disabled so follow-up reminders are not double-fired

A second Firebase project is out of Phase 9A.

## Deploy (staging only)

```bash
npm run deploy:staging
# or
./scripts/deploy-staging.sh
```

The script:

1. Runs `npm test` + `npm run check` (refuses to deploy a red tree)
2. Deploys **only** `wrangler deploy --env staging`
3. Deploys **only** `firebase hosting:channel:deploy staging`
4. Requires `/health` `backendReady: true` (fails if secrets missing → UI-only)
5. Runs `scripts/smoke-staging.mjs` (Worker + optional Hosting channel URL)
6. **Refuses** bare `wrangler deploy` and bare `firebase deploy --only hosting`

## After deploy

1. Open the printed Hosting channel URL (contains `--staging`).
2. Confirm `window.IAQAR.deploymentEnvironment === "staging"`.
3. Confirm `window.IAQAR.workerBase` ends with `iaqar-intake-staging`.
4. Hit staging Worker `/health` — expect `backendReady: true`.
5. Exercise phone login / public intake matching / operations as needed.
6. Do **not** enable production Meta outbound.

## Explicitly out of Phase 9A

- Production Worker or live Hosting deploy (Phase 9B / owner-run `deploy-all`)
- A separate Firebase project (not created here)
- Automatic WhatsApp/Telegram send (Q-3)
- Deals page / bottom navigation / home redesign
