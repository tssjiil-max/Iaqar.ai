# iAqar AI 2.0 — Executive Engineering Charter

Date: 2026-10-23
Status: approved operating policy for maintenance work; NOT authorization for production deployment.

## Objective
Maintain one primary development repository for the multi-office iAqar system while preserving every existing repository, production function, historic branch and recoverable release.

## Authorized without per-step approval
- Inspect repository source, branches, diffs, dependencies, tests and documentation.
- Create isolated maintenance branches and audit reports.
- Add isolated non-deploying tests, formatting improvements and reviewed maintenance changes.
- Document unresolved findings and test failures honestly.

## Hard stops / approval gates
- Do not delete repositories or user/business data.
- Do not modify production databases, deployed workers, Firebase Hosting, Cloudflare or Vercel production settings.
- Do not merge changes into main or deploy to production without explicit user approval.
- Do not expose tokens, API keys or account secrets.
- Preserve a verifiable rollback path for every changed component.
- If a step is unsafe or permission-limited, skip that step and continue safe tasks.

## Execution sequence
1. Complete inventory of candidate repositories and branch topology.
2. Compare functionality of branch candidates and identify non-merged code.
3. Verify isolated test runs and review security-critical rules.
4. Build a retain / merge / defer / remove-after-review matrix.
5. Clean verified redundant code within maintenance branch only.
6. Organize central services, field offices, partners and subscriptions.
7. Prepare isolated pilot release candidate for approval.

## Continuous automation policy
Safe audit workflow may run manually and on maintenance branch changes. Do not give it write permissions or credentials for deployment. Scheduled default-branch monitoring requires separate review and approval before activation.
