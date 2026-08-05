# IAQAR.AI — Phase 9A Staging Deployment

Staging is a **non-production** path. It must never overwrite the live Hosting site or
the production Worker.

## What staging is

| Surface | Staging target | Production target |
| --- | --- | --- |
| Cloudflare Worker | `iaqar-intake-staging` (`wrangler --env staging`) | `iaqar-macrodroid-intake` |
| Firebase Hosting | preview channel `staging` | live Hosting (`aqar-b5d76`) |
| Firestore / Auth | same project `aqar-b5d76` (explicit Phase 9A choice) | same |
| R2 media | same bucket `iaqar-media` (office-scoped paths) | same |

Client wiring: `public/js/runtime-config.js` sends Hosting channel hosts that contain
`--staging` to the staging Worker URL. Production hosts keep the production Worker.

## Required credentials

Set these in the environment before running the staging deploy script:

- `CLOUDFLARE_API_TOKEN` — Workers deploy permission
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account id
- `FIREBASE_TOKEN` — from `firebase login:ci`

Worker secrets for the **staging** env (set once with Wrangler):

```bash
cd worker
npx wrangler secret put FIREBASE_CLIENT_EMAIL --env staging
npx wrangler secret put FIREBASE_PRIVATE_KEY --env staging
npx wrangler secret put FIREBASE_PRIVATE_KEY_ID --env staging
# optional if used in production:
# npx wrangler secret put FIREBASE_WEB_API_KEY --env staging
# npx wrangler secret put FCM_WEB_PUSH_VAPID_KEY --env staging
```

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
4. Smoke-checks `/health` on the staging Worker
5. **Refuses** bare `wrangler deploy` and bare `firebase deploy --only hosting`

## After deploy

1. Open the printed Hosting channel URL (contains `--staging`).
2. Confirm the browser console / `window.IAQAR.deploymentEnvironment === "staging"`.
3. Confirm `window.IAQAR.workerBase` ends with `iaqar-intake-staging`.
4. Hit staging Worker `/health` — expect `deploymentEnvironment: "staging"`.
5. Do **not** enable production Meta outbound; Meta credentials remain empty.

## Explicitly out of Phase 9A

- Production Worker or live Hosting deploy (Phase 9B / owner-run `deploy-all`)
- A separate Firebase project (not created here)
- Automatic WhatsApp/Telegram send (Q-3)
- Deals page / bottom navigation / home redesign
