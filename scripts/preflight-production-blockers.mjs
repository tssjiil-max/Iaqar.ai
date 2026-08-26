#!/usr/bin/env node
/**
 * Production preflight blockers — credentials, backup, pilot offices, rollback.
 * Never prints secret values. Requires FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  PRODUCTION_HOST,
  PRODUCTION_PROJECT,
  firestoreFieldString,
  firestoreListDocuments,
  getProductionAccessToken,
  isActiveOffice,
  loadProductionServiceAccount,
  normalizeOfficeRecord
} from "./production-credentials.mjs";
import {
  evaluatePilotOfficeAccess,
  evaluatePilotRegistration,
  normalizePilotAccessConfig
} from "../public/js/pilot-access-domain.js";
import { buildVersionPayload } from "../public/js/release-version-domain.js";

const root = path.resolve(import.meta.dirname, "..");
const versionGeneratorPath = path.join(root, "scripts", "write-staging-version.mjs");
const deployScriptPath = path.join(root, "scripts", "deploy-production-pilot.sh");

const STATUS = Object.freeze({
  passPreflight: "PASS — PREFLIGHT VERIFIED",
  passUnit: "PASS — UNIT ONLY",
  fail: "FAIL — PREFLIGHT",
  notRun: "NOT RUN"
});

function report(label, status, detail = "") {
  console.log(`${label} = ${status}${detail ? ` (${detail})` : ""}`);
  return { label, status, detail, blocked: status === STATUS.fail };
}

function passPreflight(label, detail = "") {
  return report(label, STATUS.passPreflight, detail);
}

function passUnit(label, detail = "") {
  return report(label, STATUS.passUnit, detail);
}

function failPreflight(label, detail = "") {
  return report(label, STATUS.fail, detail);
}

function notRun(label, detail = "") {
  return report(label, STATUS.notRun, detail);
}

async function readJsonResponse(response) {
  const body = await response.json().catch(() => ({}));
  return body;
}

async function readPilotAccessConfig(accessToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)/documents/platform/settings/pilotAccess`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000)
  });
  if (response.status === 404) return normalizePilotAccessConfig({ enabled: false });
  const body = await readJsonResponse(response);
  if (!response.ok) throw new Error(`pilotAccess read failed: HTTP ${response.status}`);
  const fields = body.fields || {};
  let featureFlags = {};
  const rawFlags = firestoreFieldString(fields, "featureFlagsJson");
  if (rawFlags) {
    try { featureFlags = JSON.parse(rawFlags); } catch { featureFlags = {}; }
  }
  const officeIds = (fields.authorizedOfficeIds?.arrayValue?.values || [])
    .map((item) => String(item?.stringValue || "").trim())
    .filter(Boolean);
  return normalizePilotAccessConfig({
    enabled: fields.enabled?.booleanValue === true,
    maxOffices: Number(fields.maxOffices?.integerValue || 5),
    authorizedOfficeIds: officeIds,
    featureFlags
  });
}

const SPARK_PLAN = "SPARK";
const BLAZE_PLAN = "BLAZE";

async function inferFirebasePlan(accessToken) {
  const explicitPlan = String(process.env.IAQAR_FIREBASE_PLAN || "").trim().toUpperCase();
  if (explicitPlan === SPARK_PLAN || explicitPlan === BLAZE_PLAN) {
    return { plan: explicitPlan, source: "env" };
  }

  const databaseUrl = `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)`;
  const databaseResponse = await fetch(databaseUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000)
  });
  const databaseBody = await readJsonResponse(databaseResponse);

  const schedulesResponse = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)/backupSchedules`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) }
  );
  const backupsResponse = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)/backups?pageSize=1`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) }
  );

  const pitr = String(databaseBody.pointInTimeRecoveryEnablement || "UNKNOWN");
  const sparkSignals = [
    pitr === "POINT_IN_TIME_RECOVERY_DISABLED",
    backupsResponse.status === 404,
    schedulesResponse.status === 403 || schedulesResponse.status === 404
  ].filter(Boolean).length;

  if (sparkSignals >= 2) {
    return { plan: SPARK_PLAN, source: "api_signals", pitr };
  }
  if (pitr === "POINT_IN_TIME_RECOVERY_ENABLED") {
    return { plan: BLAZE_PLAN, source: "pitr_enabled", pitr };
  }
  return { plan: "UNKNOWN", source: "inconclusive", pitr };
}

async function verifyBackupRecovery(accessToken, rollback) {
  const databaseUrl = `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)`;
  const databaseResponse = await fetch(databaseUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000)
  });
  const databaseBody = await readJsonResponse(databaseResponse);
  if (!databaseResponse.ok) {
    return { ok: false, reason: `firestore database HTTP ${databaseResponse.status}` };
  }

  const planInfo = await inferFirebasePlan(accessToken);
  const pitr = String(databaseBody.pointInTimeRecoveryEnablement || planInfo.pitr || "UNKNOWN");

  if (planInfo.plan === BLAZE_PLAN) {
    const backupsResponse = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)/backups?pageSize=5`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) }
    );
    const backupsBody = await readJsonResponse(backupsResponse);
    const backups = backupsBody.backups || [];
    if (backups.length > 0) {
      const latest = backups[0];
      return {
        ok: true,
        plan: BLAZE_PLAN,
        mechanism: "managed_backup",
        reference: latest.name,
        timestamp: latest.snapshotTime || latest.createTime || "unknown"
      };
    }
    if (pitr === "POINT_IN_TIME_RECOVERY_ENABLED") {
      return {
        ok: true,
        plan: BLAZE_PLAN,
        mechanism: "point_in_time_recovery",
        reference: `projects/${PRODUCTION_PROJECT}/databases/(default)`,
        timestamp: pitr
      };
    }
    return {
      ok: false,
      plan: BLAZE_PLAN,
      reason: "blaze_project_without_verified_managed_backup_or_pitr"
    };
  }

  const deployScriptReady = existsSync(deployScriptPath)
    && readFileSync(deployScriptPath, "utf8").includes("firebase deploy");
  const hostingRollbackReady = Boolean(rollback?.ok && rollback.rollbackTarget);
  if (!hostingRollbackReady) {
    return {
      ok: false,
      plan: planInfo.plan === SPARK_PLAN ? SPARK_PLAN : "UNKNOWN",
      reason: "spark_requires_verified_hosting_release_rollback"
    };
  }
  if (!deployScriptReady) {
    return {
      ok: false,
      plan: planInfo.plan === SPARK_PLAN ? SPARK_PLAN : "UNKNOWN",
      reason: "spark_requires_git_based_redeploy_script"
    };
  }

  return {
    ok: true,
    plan: planInfo.plan === SPARK_PLAN ? SPARK_PLAN : "UNKNOWN",
    mechanism: "spark_hosting_rollback+git_rules_redeploy+firestore_readable",
    reference: rollback.rollbackTarget,
    timestamp: rollback.createTime || "live_release",
    note: "scheduled_backups_and_pitr_are_blaze_only_and_not_required_on_spark; firestore_data_restore_requires_owner_manual_export"
  };
}

async function resolveHostingSiteName(accessToken) {
  const sitesUrl = `https://firebasehosting.googleapis.com/v1beta1/projects/${PRODUCTION_PROJECT}/sites`;
  const sitesResponse = await fetch(sitesUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000)
  });
  const sitesBody = await readJsonResponse(sitesResponse);
  if (!sitesResponse.ok) {
    throw new Error(`hosting sites HTTP ${sitesResponse.status}`);
  }
  const siteName = sitesBody.sites?.[0]?.name
    || `projects/${PRODUCTION_PROJECT}/sites/${PRODUCTION_PROJECT}`;
  return siteName;
}

async function verifyRollbackTarget(accessToken) {
  const siteName = await resolveHostingSiteName(accessToken);
  const liveUrl = `https://firebasehosting.googleapis.com/v1beta1/${siteName}/channels/live`;
  const liveResponse = await fetch(liveUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000)
  });
  const liveBody = await readJsonResponse(liveResponse);
  if (!liveResponse.ok) {
    return { ok: false, reason: `live channel HTTP ${liveResponse.status}` };
  }

  const liveRelease = liveBody.release;
  if (!liveRelease?.name) {
    return { ok: false, reason: "no_live_release_found" };
  }

  const versionName = liveRelease.version?.name || "";
  let versionSha = "";
  if (versionName) {
    const versionResponse = await fetch(`https://firebasehosting.googleapis.com/v1beta1/${versionName}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000)
    });
    const versionBody = await readJsonResponse(versionResponse);
    if (versionResponse.ok) {
      versionSha = versionBody.config?.headers?.find?.((row) => row?.glob === "**")?.headers?.["x-release-sha"]
        || versionBody.labels?.sha
        || "";
    }
  }

  return {
    ok: true,
    rollbackTarget: liveRelease.name,
    versionName,
    createTime: liveRelease.releaseTime || liveRelease.createTime || "",
    versionSha: String(versionSha || "").trim()
  };
}

function verifyVersionMarkerMechanism() {
  const checks = [];
  if (!existsSync(versionGeneratorPath)) checks.push("missing write-staging-version.mjs");
  if (!existsSync(deployScriptPath)) checks.push("missing deploy-production-pilot.sh");
  const deployScript = existsSync(deployScriptPath)
    ? readFileSync(deployScriptPath, "utf8")
    : "";
  if (!deployScript.includes("write-staging-version.mjs")) {
    checks.push("deploy script does not generate version.json");
  }
  if (!deployScript.includes("--channel=production")) {
    checks.push("deploy script missing --channel=production");
  }
  const gitignore = existsSync(path.join(root, ".gitignore"))
    ? readFileSync(path.join(root, ".gitignore"), "utf8")
    : "";
  if (!gitignore.includes("public/version.json")) {
    checks.push("public/version.json not gitignored");
  }

  try {
    const fullSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const shortSha = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const payload = buildVersionPayload({
      fullSha,
      shortSha,
      branch: "preflight-check",
      deployedAt: new Date().toISOString(),
      channel: "production"
    });
    if (payload.channel !== "production" || !payload.fullSha || !payload.shortSha) {
      checks.push("version payload validation failed");
    }
  } catch (error) {
    checks.push(`version payload probe failed: ${error.message}`);
  }

  return { ok: checks.length === 0, checks };
}

function assessPilotMaxFive(activeOffices, pilotConfig) {
  const activeCount = activeOffices.length;
  const maxOffices = pilotConfig.maxOffices || 5;
  const architectureSupportsMaxFive = maxOffices === 5 && activeCount <= 5;
  const detail = activeCount > 0
    ? `maxOffices=5; ${activeCount} real active office(s); does not require 5 offices pre-seeded`
    : "maxOffices=5; no active offices yet; limit enforced by registration lock at capacity";

  if (!architectureSupportsMaxFive) {
    return { status: STATUS.fail, detail: `maxOffices=${maxOffices}; active=${activeCount}` };
  }

  const unitConfig = normalizePilotAccessConfig({
    enabled: true,
    maxOffices: 5,
    authorizedOfficeIds: activeOffices.map((office) => office.officeId).slice(0, 5)
  });
  if (unitConfig.maxOffices !== 5) {
    return { status: STATUS.fail, detail: "pilot maxOffices normalization failed" };
  }

  return { status: STATUS.passUnit, detail };
}

function assessOfficeSixDenial(activeOffices, pilotConfig) {
  const activeIds = activeOffices.map((office) => office.officeId);

  if (pilotConfig.enabled && pilotConfig.authorizedOfficeIds.length > 0) {
    const sixthCandidateId = activeOffices.find((office) => !pilotConfig.authorizedOfficeIds.includes(office.officeId))?.officeId
      || "office-6-probe";
    const sixthDecision = evaluatePilotOfficeAccess(pilotConfig, sixthCandidateId);
    if (!sixthDecision.allowed) {
      return {
        status: STATUS.passPreflight,
        detail: `live enabled; denies ${sixthCandidateId}`
      };
    }
    return {
      status: STATUS.fail,
      detail: `${sixthCandidateId} was not denied`
    };
  }

  const unitConfig = normalizePilotAccessConfig({
    enabled: true,
    maxOffices: 5,
    authorizedOfficeIds: activeIds.slice(0, 5).length
      ? activeIds.slice(0, 5)
      : ["office-1", "office-2", "office-3", "office-4", "office-5"]
  });
  const unitDenial = evaluatePilotOfficeAccess(unitConfig, "office-6-probe");
  if (unitDenial.allowed === false) {
    return {
      status: STATUS.passUnit,
      detail: "live pilotAccess disabled; unit denies office-6-probe"
    };
  }
  return {
    status: STATUS.fail,
    detail: "unit probe did not deny office #6"
  };
}

async function main() {
  const results = [];
  const creds = loadProductionServiceAccount();
  let planInfo = { plan: "UNKNOWN", source: "credentials_unavailable" };

  if (!creds.ok) {
    results.push(report("PRODUCTION CREDENTIALS", STATUS.fail, "credentials unavailable"));
    console.log("Secure action: set FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON to the aqar-b5d76 service-account JSON in the Cloud Agent environment secrets (never commit or paste into chat).");
    results.push(report("FIREBASE PLAN", STATUS.notRun));
    results.push(failPreflight("BACKUP/RECOVERY", "credentials unavailable"));
    results.push(failPreflight("ROLLBACK TARGET", "credentials unavailable"));
    results.push(report("REAL ACTIVE PRODUCTION OFFICES", STATUS.notRun));
    results.push(failPreflight("PILOT MAX 5", "credentials unavailable"));
    results.push(failPreflight("OFFICE #6 DENIAL", "credentials unavailable"));
    results.push(failPreflight("REGISTRATION LOCK", "credentials unavailable"));
    results.push(failPreflight("VERSION MARKER", "credentials unavailable"));
  } else {
    const accessToken = await getProductionAccessToken(creds.serviceAccount);
    planInfo = await inferFirebasePlan(accessToken);
    results.push(report(
      "FIREBASE PLAN",
      planInfo.plan === SPARK_PLAN || planInfo.plan === BLAZE_PLAN ? STATUS.passPreflight : STATUS.fail,
      `${planInfo.plan}; source=${planInfo.source}`
    ));
    results.push(passPreflight("PRODUCTION CREDENTIALS"));

    let rollback = { ok: false, reason: "not_checked" };
    try {
      rollback = await verifyRollbackTarget(accessToken);
      if (rollback.ok) {
        const detail = [
          `rollbackTarget=${rollback.rollbackTarget}`,
          rollback.versionName ? `version=${rollback.versionName}` : "",
          rollback.versionSha ? `sha=${rollback.versionSha}` : "",
          rollback.createTime ? `liveAt=${rollback.createTime}` : ""
        ].filter(Boolean).join("; ");
        results.push(passPreflight("ROLLBACK TARGET", detail));
      } else {
        results.push(failPreflight("ROLLBACK TARGET", rollback.reason));
      }
    } catch (error) {
      results.push(failPreflight("ROLLBACK TARGET", error.message));
    }

    try {
      const backup = await verifyBackupRecovery(accessToken, rollback);
      results.push(backup.ok
        ? passPreflight(
          "BACKUP/RECOVERY",
          `plan=${backup.plan}; mechanism=${backup.mechanism}; ref=${backup.reference}; timestamp=${backup.timestamp}${backup.note ? `; ${backup.note}` : ""}`
        )
        : failPreflight("BACKUP/RECOVERY", `${backup.plan || planInfo.plan}: ${backup.reason}`));
    } catch (error) {
      results.push(failPreflight("BACKUP/RECOVERY", error.message));
    }

    try {
      const docs = await firestoreListDocuments(accessToken, "offices");
      const activeOffices = docs
        .map(normalizeOfficeRecord)
        .filter(isActiveOffice)
        .sort((a, b) => a.officeId.localeCompare(b.officeId));
      const pilotConfig = await readPilotAccessConfig(accessToken);

      results.push(report("REAL ACTIVE PRODUCTION OFFICES", String(activeOffices.length)));

      const pilotMaxFive = assessPilotMaxFive(activeOffices, pilotConfig);
      results.push(report("PILOT MAX 5", pilotMaxFive.status, pilotMaxFive.detail));

      const officeSix = assessOfficeSixDenial(activeOffices, pilotConfig);
      results.push(report("OFFICE #6 DENIAL", officeSix.status, officeSix.detail));

      const registrationDecision = evaluatePilotRegistration(pilotConfig, {
        activeOfficeCount: activeOffices.length
      });
      if (!pilotConfig.enabled) {
        const closedAtMax = evaluatePilotRegistration(
          normalizePilotAccessConfig({ enabled: true, maxOffices: 5 }),
          { activeOfficeCount: 5 }
        );
        results.push(closedAtMax.allowed === false
          ? passUnit("REGISTRATION LOCK", `live open (${activeOffices.length}/${pilotConfig.maxOffices}); unit closes at maxOffices=5`)
          : failPreflight("REGISTRATION LOCK", "unit probe did not close registration at max offices"));
      } else if (activeOffices.length >= pilotConfig.maxOffices && !registrationDecision.allowed) {
        results.push(passPreflight("REGISTRATION LOCK", `live closed at ${activeOffices.length}/${pilotConfig.maxOffices}`));
      } else if (activeOffices.length < pilotConfig.maxOffices && registrationDecision.allowed) {
        results.push(passUnit("REGISTRATION LOCK", `live open (${activeOffices.length}/${pilotConfig.maxOffices}); registration lock engages at max`));
      } else {
        results.push(failPreflight("REGISTRATION LOCK", registrationDecision.code || "unexpected registration state"));
      }
    } catch (error) {
      results.push(report("REAL ACTIVE PRODUCTION OFFICES", STATUS.notRun, error.message));
      results.push(failPreflight("PILOT MAX 5", error.message));
      results.push(failPreflight("OFFICE #6 DENIAL", error.message));
      results.push(failPreflight("REGISTRATION LOCK", error.message));
    }
  }

  try {
    const version = verifyVersionMarkerMechanism();
    let liveVersionStatus = "not_published";
    try {
      const liveResponse = await fetch(new URL("/version.json", PRODUCTION_HOST), {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000)
      });
      if (liveResponse.ok) liveVersionStatus = "published";
    } catch {
      liveVersionStatus = "unreachable";
    }
    results.push(version.ok
      ? passPreflight("VERSION MARKER", `generation mechanism verified; live=${liveVersionStatus}; public/version.json is deploy-generated`)
      : failPreflight("VERSION MARKER", version.checks.join("; ")));
  } catch (error) {
    results.push(failPreflight("VERSION MARKER", error.message));
  }

  const blocked = results.some((row) => row.blocked);

  console.log("");
  console.log(blocked
    ? "PRODUCTION PREFLIGHT = BLOCKED"
    : "PRODUCTION PREFLIGHT = READY FOR CONTROLLED DEPLOY");
  if (blocked) {
    console.log("NO PRODUCTION DEPLOY. NO MERGE.");
    console.log("STOP FOR HUMAN REVIEW.");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
