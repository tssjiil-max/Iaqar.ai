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

async function verifyBackupRecovery(accessToken) {
  const databaseUrl = `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)`;
  const databaseResponse = await fetch(databaseUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000)
  });
  const databaseBody = await readJsonResponse(databaseResponse);

  const schedulesUrl = `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)/backupSchedules`;
  const schedulesResponse = await fetch(schedulesUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000)
  });
  const schedulesBody = await readJsonResponse(schedulesResponse);

  const backupsUrl = `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)/backups?pageSize=5`;
  const backupsResponse = await fetch(backupsUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000)
  });
  const backupsBody = await readJsonResponse(backupsResponse);

  const schedules = schedulesBody.backupSchedules || [];
  const backups = backupsBody.backups || [];
  const pitr = String(databaseBody.pointInTimeRecoveryEnablement || "UNKNOWN");

  if (backups.length > 0) {
    const latest = backups[0];
    return {
      ok: true,
      mechanism: "scheduled_backup",
      reference: latest.name,
      timestamp: latest.snapshotTime || latest.createTime || "unknown",
      pitr
    };
  }
  if (schedules.length > 0) {
    return {
      ok: true,
      mechanism: "backup_schedule",
      reference: schedules[0].name,
      timestamp: schedules[0].updateTime || schedules[0].createTime || "schedule-only",
      pitr
    };
  }

  const reasons = [];
  if (pitr !== "POINT_IN_TIME_RECOVERY_ENABLED") {
    reasons.push(`pointInTimeRecovery=${pitr}`);
  }
  if (backupsResponse.status === 404) {
    reasons.push("no_managed_backups");
  } else if (!backupsResponse.ok) {
    reasons.push(`backups_api_http_${backupsResponse.status}`);
  }
  if (schedulesResponse.status === 403) {
    reasons.push("backupSchedules_permission_denied");
  } else if (!schedulesResponse.ok && schedulesResponse.status !== 404) {
    reasons.push(`backupSchedules_http_${schedulesResponse.status}`);
  }

  return {
    ok: false,
    mechanism: "none_verified",
    pitr,
    minimumRecovery: "owner-run Firestore export or enable managed backup schedule / PITR before controlled deploy",
    reason: reasons.join("; ") || "no_backup_or_schedule_found"
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

function runUnitTests(testFiles) {
  try {
    execFileSync(process.execPath, ["--test", ...testFiles], {
      cwd: root,
      stdio: "pipe",
      encoding: "utf8"
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: String(error.stderr || error.message || "unit tests failed").split("\n").slice(-3).join(" ") };
  }
}

function assessPilotMaxFiveArchitecture(activeOffices, pilotConfig) {
  const activeIds = activeOffices.map((office) => office.officeId);
  const canStartWithCurrent = activeOffices.length > 0
    && activeOffices.length <= pilotConfig.maxOffices;
  const seedReady = activeOffices.length > 0;
  return {
    canSupportMaxFive: true,
    canStartWithCurrent,
    seedReady,
    activeIds,
    note: seedReady
      ? `architecture supports maxOffices=${pilotConfig.maxOffices} with ${activeOffices.length} real authorized office(s) initially; do not seed fake offices`
      : "no active production offices to authorize"
  };
}

async function main() {
  const results = [];
  const creds = loadProductionServiceAccount();

  if (!creds.ok) {
    results.push(report("PRODUCTION CREDENTIALS", STATUS.fail, "credentials unavailable"));
    console.log("Secure action: set FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON to the aqar-b5d76 service-account JSON in the Cloud Agent environment secrets (never commit or paste into chat).");
    results.push(failPreflight("BACKUP/RECOVERY", "credentials unavailable"));
    results.push(report("REAL ACTIVE PRODUCTION OFFICES", STATUS.notRun));
    results.push(failPreflight("PILOT MAX 5 ARCHITECTURE", "credentials unavailable"));
    results.push(failPreflight("OFFICE #6 DENIAL", "credentials unavailable"));
    results.push(failPreflight("REGISTRATION LOCK", "credentials unavailable"));
    results.push(failPreflight("ROLLBACK TARGET", "credentials unavailable"));
  } else {
    results.push(passPreflight("PRODUCTION CREDENTIALS"));
    const accessToken = await getProductionAccessToken(creds.serviceAccount);

    try {
      const backup = await verifyBackupRecovery(accessToken);
      results.push(backup.ok
        ? passPreflight("BACKUP/RECOVERY", `project=${PRODUCTION_PROJECT}; mechanism=${backup.mechanism}; ref=${backup.reference}; timestamp=${backup.timestamp}`)
        : failPreflight("BACKUP/RECOVERY", `${backup.reason}; minimumRecovery=${backup.minimumRecovery}`));
    } catch (error) {
      results.push(failPreflight("BACKUP/RECOVERY", error.message));
    }

    try {
      const rollback = await verifyRollbackTarget(accessToken);
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
      const docs = await firestoreListDocuments(accessToken, "offices");
      const activeOffices = docs
        .map(normalizeOfficeRecord)
        .filter(isActiveOffice)
        .sort((a, b) => a.officeId.localeCompare(b.officeId));
      const pilotConfig = await readPilotAccessConfig(accessToken);

      results.push(report("REAL ACTIVE PRODUCTION OFFICES", String(activeOffices.length)));

      const architecture = assessPilotMaxFiveArchitecture(activeOffices, pilotConfig);
      results.push(architecture.canStartWithCurrent
        ? passUnit("PILOT MAX 5 ARCHITECTURE", architecture.note)
        : failPreflight("PILOT MAX 5 ARCHITECTURE", architecture.note));

      const sixthCandidateId = pilotConfig.enabled
        ? (activeOffices.find((office) => !pilotConfig.authorizedOfficeIds.includes(office.officeId))?.officeId
          || "office-6-probe")
        : "office-6-probe";
      const sixthDecision = evaluatePilotOfficeAccess(pilotConfig, sixthCandidateId);
      if (pilotConfig.enabled && pilotConfig.authorizedOfficeIds.length > 0 && !sixthDecision.allowed) {
        results.push(passPreflight("OFFICE #6 DENIAL", `${sixthCandidateId}; live pilotAccess enabled`));
      } else if (!pilotConfig.enabled) {
        const unitProbe = evaluatePilotOfficeAccess(
          normalizePilotAccessConfig({
            enabled: true,
            maxOffices: 5,
            authorizedOfficeIds: architecture.activeIds.slice(0, 5).length
              ? architecture.activeIds.slice(0, 5)
              : ["office-1", "office-2", "office-3", "office-4", "office-5"]
          }),
          "office-6-probe"
        );
        results.push(unitProbe.allowed === false
          ? passUnit("OFFICE #6 DENIAL", "live pilotAccess disabled; unit probe denies office-6-probe")
          : failPreflight("OFFICE #6 DENIAL", "unit probe did not deny office #6"));
      } else {
        results.push(failPreflight("OFFICE #6 DENIAL", `${sixthCandidateId} was not denied`));
      }

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
      results.push(failPreflight("PILOT MAX 5 ARCHITECTURE", error.message));
      results.push(failPreflight("OFFICE #6 DENIAL", error.message));
      results.push(failPreflight("REGISTRATION LOCK", error.message));
    }
  }

  const killSwitchTests = runUnitTests([
    "test/pilot-access-domain.test.mjs",
    "worker/test/pilot-access-service.test.mjs"
  ]);
  const killSwitchDetail = killSwitchTests.ok ? "pilot-access-domain + pilot-access-service" : killSwitchTests.detail;
  const killSwitchStatus = killSwitchTests.ok ? STATUS.passUnit : STATUS.fail;
  for (const label of [
    "MATCHING KILL SWITCH",
    "PUBLIC ROUTING KILL SWITCH",
    "PUSH KILL SWITCH",
    "COLLABORATION KILL SWITCH"
  ]) {
    results.push(report(label, killSwitchStatus, killSwitchDetail));
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
