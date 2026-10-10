# External cooperating broker implementation plan

Goal: implement the user-supplied 20-section specification on Staging only.
Architecture: optional fields on existing publicIntake/opportunities, existing office membership routes for review, existing matching admission and journey guards. External negotiation remains office mediated.
Tech stack: existing vanilla JS, Firebase Firestore, Cloudflare Worker, Node tests and Playwright.
Spec: user-supplied specification of 2026-10-10.

Global constraints: preserve office URLs, existing forms, legacy data, identity and channels. No Production deployment, memberships, automatic commission or external accounts.
Review focus: forged verification; pending records edited through existing editor; retry after pipeline failure; mixed owner/client versus broker duplicates; stale matches approved after cooperation closes.

- [x] Write and run failing tests for public submissions, review security, matching admission and negotiation guards.
- [x] Add shared external-broker domain validation and optional Firestore create constraints.
- [x] Extend current public-office form using common contact fields and stable submission id.
- [x] Preserve metadata in the existing intake pipeline, notify through existing notifyOffice, and retain pending review.
- [x] Add office-authorized review/commission evidence and audit to the record details; gate matching until review.
- [x] Guard journey approval and external proposal/session links, preserving office-mediated cooperation.
- [x] Run all tests, rules emulator, check and mobile browser cases; commit and publish isolated PR.
- [ ] Deploy through existing Staging-only workflow and verify live version; never merge production.
Rollback: revert additive code/rules; optional fields remain on records, no data migration or deletion.

Verification: npm test passed (2063 tests); check passed (706 parsed targets); Firestore emulator passed (50 rules tests); mobile browser passed four submissions and office review. Independent review found three issues; all reproduced RED then fixed GREEN. No Production changes.
