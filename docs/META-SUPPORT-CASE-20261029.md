# Meta Support — Embedded Signup access denied

Status: PREPARED, NOT SUBMITTED. No support case ID exists.
Date: 29 October 2026 (Saudi Arabia).
App ID: 976041872203912
Business Login Configuration ID: 935400705477695
Approved staging URL: https://iaqar-ai-staging--staging-9c4b0k7h.web.app/#/settings/channels
Historical root-host observation: iaqar-ai-staging.web.app (release 549d6f05; not the approved user-facing channel).

## Support request
Our WhatsApp Embedded Signup opens Meta and shows: «ليست لديك صلاحية وصول. هذه الميزة غير متوفرة لك حتى الآن» (You do not have access; this feature is not available to you yet).

Business Settings displays the same app ID under the name “11”, owned by the portfolio displayed as «عقار». Screenshots show Sultan Alharbi and the Iaqar-WhatsApp system user with full asset access. The options to open the app dashboard and app settings appear grey. This does not establish a developer/admin role on the app, nor that Business Login is approved.

Please inspect the relationship between the App ID and Configuration ID, the configuration's current Embedded Signup variation and supported version/products, support for WhatsApp Business app onboarding (Coexistence), app mode, review/advanced-access requirements, personal developer roles versus Business Settings asset roles, and allowed JavaScript SDK/OAuth domains for iaqar-ai-staging.web.app. Identify the precise restriction and corrective action.

The known number remains in WhatsApp Business on the phone. We request diagnostic guidance only: no migration, deregistration, account deletion, disconnection, permission changes or outbound messages.

## Server-side evidence, read-only
Cloudflare settings GET: HTTP 200, success=true.
Worker: iaqar-intake-staging
DEPLOYMENT_ENV=staging
FIREBASE_PROJECT_ID=iaqar-ai-staging
META_APP_ID=976041872203912
META_CONFIG_ID=935400705477695
META_ONBOARDING_MODE=coexistence

Cloudflare secret names GET: HTTP 200. META_ACCESS_TOKEN, META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN exist as secret_text bindings. No values were retrieved; presence does not prove validity, ownership, scope or expiry.

Live Worker /meta/config returned:
enabled=true; graphVersion=v25.0; onboardingMode=coexistence; inboundOnly=true; outboundMessaging=false.
Request ID: 25a64985-ed43-4e53-93ae-d3d8693e5868.
This enabled flag is local configuration presence, not a Meta authorization result.

## Exact verification limits
No authenticated Graph API request inspecting this configuration was issued: the execution environment has no Meta access-token binding, the Cloudflare API exposes secret names rather than values, and the existing staging application has no read-only configuration-inspection route. No secret was extracted, and no diagnostic Worker was deployed.
Consequently the configuration's owner, variation, review status, domains, current Meta access restrictions and number eligibility remain UNVERIFIED. There is no official Meta error code captured for the popup failure; classification remains UNKNOWN_META_ERROR.

## Submission attempt
Opening Business Support Home in the available agent browser redirected to a Meta business login page. No authenticated session or support form was available, and no case was submitted. The user's phone browser session is separate.
No phone, registration, subscription, messaging or production mutation was performed. No access token, app secret, authorization code, phone number or raw sensitive log is included in this report.
