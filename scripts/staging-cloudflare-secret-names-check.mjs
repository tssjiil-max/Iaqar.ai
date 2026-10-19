#!/usr/bin/env node
/**
 * Staging Cloudflare Worker secret-NAMES check (read-only, one-off).
 *
 * Purpose: tell apart two very different situations for the WhatsApp Embedded
 * Signup flow on Staging:
 *   (a) a secret the flow needs (META_APP_SECRET, and whichever of
 *       META_WHATSAPP_ACCESS_TOKEN / META_ACCESS_TOKEN the outbound-agent
 *       transport reads) is simply not bound on the Staging Worker yet — a
 *       real configuration gap, which would explain signups failing outright; vs.
 *   (b) every secret the flow needs IS bound, and a given number simply has
 *       never had Embedded Signup completed for it — not a bug, a step the
 *       office manager still needs to do in their own browser.
 *
 * Cloudflare's Workers API has no "read a secret's value" endpoint — secret
 * bindings are write-only by design (you can PUT one, list its NAME, or
 * delete it; you can never GET its value back). So this script cannot leak a
 * Meta token or app secret even if it tried to: the API response itself only
 * ever contains { name, type }. Nothing is copied into GitHub; nothing here
 * is written to Cloudflare.
 *
 * Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (the same two
 * secrets .github/workflows/deploy-unified-staging.yml already uses to
 * *deploy* to Staging — reused here read-only, nothing new granted).
 */

const STAGING_WORKER_SCRIPT_NAME = "iaqar-intake-staging";

// The exact secret names the real code depends on for Embedded Signup /
// outbound Graph API calls (worker/src/index.js completeEmbeddedSignup, and
// worker/src/office-os/whatsapp-agent-transport.js). Checked by name only.
const EXPECTED_META_SECRETS = [
  "META_APP_SECRET", // required by completeEmbeddedSignup() for the OAuth code->token exchange
  "META_WHATSAPP_ACCESS_TOKEN", // read by whatsapp-agent-transport.js (outbound send; still gated off by WHATSAPP_AGENT_SEND)
  "META_ACCESS_TOKEN" // transport.js's fallback name for the same token
];

async function main() {
  const apiToken = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const dir = process.env.DIAGNOSTIC_OUT || "artifacts/staging-diagnostics";

  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });

  if (!apiToken || !accountId) {
    const report = {
      ok: false,
      error: "CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID not available to this job",
      checkedWorker: STAGING_WORKER_SCRIPT_NAME
    };
    await writeFile(`${dir}/cloudflare-secret-names-check.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(STAGING_WORKER_SCRIPT_NAME)}/secrets`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken}` }
  });
  const payload = await response.json().catch(() => ({}));

  let report;
  if (!response.ok || !Array.isArray(payload.result)) {
    report = {
      ok: false,
      checkedWorker: STAGING_WORKER_SCRIPT_NAME,
      httpStatus: response.status,
      // Cloudflare error payloads are small, non-secret structured error codes/messages — safe to pass through.
      cloudflareError: payload.errors || payload.messages || null
    };
  } else {
    const boundNames = new Set(payload.result.map((s) => String(s && s.name || "")));
    report = {
      ok: true,
      checkedWorker: STAGING_WORKER_SCRIPT_NAME,
      totalSecretsBound: boundNames.size,
      metaSecrets: Object.fromEntries(EXPECTED_META_SECRETS.map((name) => [name, boundNames.has(name)]))
    };
  }

  await writeFile(`${dir}/cloudflare-secret-names-check.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
