# Smart marketing — implementation and validation

## Delivered
- Staging-only office tool; preserves the original six cards, main navigation, matching and negotiation.
- Four PNG sizes; seven template purposes, three visual treatments; real editable preview and Arabic fonts (IBM Plex, Tajawal, Noto Naskh and Noto Kufi).
- Server-authorized office settings, up to 40 drafts, versioned approvals, identity invalidation, deletion, and last 100 audit events. Logo snapshots are not duplicated in the state document.
- Office-specific campaign proposals and a weekly plan, personalised by actual services, audience, area and budget.
- Existing Gemini client for optional creative copy: ten calls per office/day, one call/minute, cache and rejection of unverified claims.
- Optional fixed-endpoint Brave Search adapter: sourced URLs, favourite preservation, indexed-link rechecks, no fabricated terms or costs. No provider key means “يتطلب ربط خدمة البحث”. A search index result is not a live HTTP reachability check.
- Copy for six channels, manual file/text sharing, and UTM links preserving office paths. Staging public landing passes validated UTM only; canonical/OG remain intact.
- Existing real public OG/canonical infrastructure was retained instead of duplicating it. No ranking guarantee.

## Explicit limitations
- Acquisition analytics are not connected: visits, channel attribution, conversion counts, deduplication, past-performance optimisation and best campaign remain unavailable. Draft/approval counts are real preparation activity, not acquisition results.
- No paid subscription was purchased and no social-network account was connected. No automatic posting, delivery claims or spending.
- Search and Gemini API calls were tested with provider doubles locally. They are not evidence of a live provider connection.
- This release stores drafts with campaign type/channel and audit records; it does not introduce a separate campaign lifecycle.
- PNG exports deliberately show the original office link. UTM is used for shared text links.

## Local verification (2026-10-10)
- New marketing domain/service tests: authentication, two-office isolation, drafts, exact version approval, identity invalidation, body-size limits, provider errors/absence, URL sanitisation, cache and UTM.
- Full web regression suite: 1900/1900 passed before final copy helper; fresh final results are recorded in CI.
- Existing Worker test command passed.
- Firestore emulator: 50/50 passed, including denial of direct marketingState access to owners, members, other offices and anonymous clients.
- Existing complete property browser journey: 45/45 passed locally.
- Marketing browser: 17 checks passed on two isolated offices, 360/390/430px widths, server persistence, four PNG sizes and all four fonts. All fixture data are synthetic. PNG signature and pixel dimensions were checked.
- Font failure regression: all required IBM weights (400, 500, 600) block PNG rendering when their request fails.
- Syntax checks passed. The repository has no separate build/lint/typecheck; syntax checks must not be labelled as those.
- An independent reviewer identified five authorization/rendering issues; each was reproduced in failing tests and fixed. Firestore collection restrictions, canonical office photo/services, required font weights, required approval version, and identity invalidation now have regressions.

## Deployment safeguards
- New branch workflow targets only `codex/smart-marketing-staging-20261010` and the existing isolated `office-os-preview` channel/Worker on `iaqar-ai-staging`.
- Rules deployment refuses to overwrite Staging rules that differ from the reviewed base commit. Marketing remains API-only.
- Live acceptance uses two uniquely named temporary QA offices/users and cleans them up; it refuses all Production targets.
- No merge into the shared Staging branch or Production is performed. Live deployment success requires an actual successful workflow; local proof is not a live success claim.
