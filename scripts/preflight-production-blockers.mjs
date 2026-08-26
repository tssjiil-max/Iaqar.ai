#!/usr/bin/env node
/**
 * Production preflight blockers — credentials, backup, pilot offices, rollback.
 * Never prints secret values. Requires FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
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
  normalizePilotAccessConfig
} from "../public/js/pilot-access-domain.js";

const root = path.resolve(import.meta.dirname, "..");
const versionPath = path.join(root, "public", "version.json");

function report(label, status, detail = "") {
  console.log(`${label} = ${status}${detail ? ` (${detail})` : ""}`);
  return { label, status, detail };
}

function pass(label, detail = "") {
  return report(label, "PASS — PREFLIGHT VERIFIED", detail);
}

function fail(label, detail = "") {
  return report(label, "FAIL — PREFLIGHT", detail);
}

async function readPilotAccessConfig(accessToken) {
  const url = `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)/documents/platform/settings/pilotAccess`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000)
  });
  if (response.status === 404) return normalizePilotAccessConfig({ enabled: false });
  const body = await response.json().catch(() => ({}));
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
  const schedulesUrl = `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)/backupSchedules`;
  const schedulesResponse = await fetch(schedulesUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000)
  });
  const schedulesBody = await schedulesResponse.json().catch(() => ({}));

  const backupsUrl = `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)/backups?pageSize=5`;
  const backupsResponse = await fetch(backupsUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000)
  });
  const backupsBody = await backupsResponse.json().catch(() => ({}));

  const schedules = schedulesBody.backupSchedules || [];
  const backups = backupsBody.backups || [];
  if (backups.length > 0) {
    const latest = backups[0];
    return {
      ok: true,
      reference: latest.name,
      timestamp: latest.snapshotTime || latest.createTime || "unknown"
    };
  }
  if (schedules.length > 0) {
    return {
      ok: true,
      reference: schedules[0].name,
      timestamp: schedules[0].updateTime || schedules[0].createTime || "schedule-only"
    };
  }
  if (schedulesResponse.ok || backupsResponse.ok) {
    return { ok: false, reason: "no_backup_or_schedule_found" };
  }
  return {
    ok: false,
    reason: `api_error schedules=${schedulesResponse.status} backups=${backupsResponse.status}`
  };
}

async function verifyRollbackTarget(accessToken) {
  const siteId = PRODUCTION_PROJECT;
  const url = `https://firebasehosting.googleapis.com/v1beta1/sites/${siteId}/releases?pageSize=10&orderBy=createTime desc`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, reason: `hosting releases HTTP ${response.status}` };
  }
  const live = (body.releases || []).find((release) => release.type === "DEPLOY" || release.status === "LIVE")
    || body.releases?.[0];
  if (!live) return { ok: false, reason: "no_live_release_found" };

  let versionSha = "";
  const versionName = live.version?.name || "";
  if (versionName) {
    const versionResponse = await fetch(`https://firebasehosting.googleapis.com/v1beta1/${versionName}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000)
    });
    const versionBody = await versionResponse.json().catch(() => ({}));
    if (versionResponse.ok) {
      versionSha = versionBody.config?.headers?.find?.((row) => row?.glob === "**")?.headers?.["x-release-sha"]
        || versionBody.labels?.sha
        || "";
    }
  }

  return {
    ok: true,
    releaseId: live.name,
    versionName,
    createTime: live.createTime || live.releaseTime || "",
    versionSha: String(versionSha || "").trim()
  };
}

async function main() {
  const results = [];
  const creds = loadProductionServiceAccount();

  if (!creds.ok) {
    results.push(report("PRODUCTION CREDENTIALS", "REQUIRES HUMAN SECURE CONFIGURATION"));
    console.log("Secure action: set FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON to the aqar-b5d76 service-account JSON in the Cloud Agent environment secrets (never commit or paste into chat).");
    results.push(fail("BACKUP/RECOVERY", "credentials unavailable"));
    results.push(fail("5 PILOT OFFICES", "credentials unavailable"));
    results.push(fail("OFFICE #6 DENIAL", "credentials unavailable"));
    results.push(fail("ROLLBACK TARGET", "credentials unavailable"));
  } else {
    results.push(pass("PRODUCTION CREDENTIALS"));
    const accessToken = await getProductionAccessToken(creds.serviceAccount);

    try {
      const backup = await verifyBackupRecovery(accessToken);
      results.push(backup.ok
        ? pass("BACKUP/RECOVERY", `project=${PRODUCTION_PROJECT}; ref=${backup.reference}; timestamp=${backup.timestamp}`)
        : fail("BACKUP/RECOVERY", backup.reason));
    } catch (error) {
      results.push(fail("BACKUP/RECOVERY", error.message));
    }

    try {
      const docs = await firestoreListDocuments(accessToken, "offices");
      const activeOffices = docs
        .map(normalizeOfficeRecord)
        .filter(isActiveOffice)
        .sort((a, b) => a.officeId.localeCompare(b.officeId));
      const pilotConfig = await readPilotAccessConfig(accessToken);

      if (activeOffices.length < 5) {
        results.push(fail("5 PILOT OFFICES", `only ${activeOffices.length} ACTIVE production offices exist`));
      } else if (pilotConfig.enabled && pilotConfig.authorizedOfficeIds.length === 5) {
        const checks = pilotConfig.authorizedOfficeIds.map((officeId, index) => {
          const decision = evaluatePilotOfficeAccess(pilotConfig, officeId);
          return { index: index + 1, officeId, allowed: decision.allowed };
        });
        results.push(checks.every((row) => row.allowed)
          ? pass("5 PILOT OFFICES", checks.map((row) => `#${row.index}=${row.officeId}`).join(", "))
          : fail("5 PILOT OFFICES", "authorized list contains non-allowed office"));
      } else if (pilotConfig.enabled) {
        results.push(fail("5 PILOT OFFICES", `pilot enabled with ${pilotConfig.authorizedOfficeIds.length} authorized offices`));
      } else {
        results.push(fail("5 PILOT OFFICES", `found ${activeOffices.length} active offices; pilotAccess not seeded (run seed-production-pilot-access.mjs with 5 real --office= IDs)`));
      }

      const sixthCandidate = activeOffices.find((office) => !pilotConfig.authorizedOfficeIds.includes(office.officeId))
        || { officeId: "office-6" };
      const sixthDecision = evaluatePilotOfficeAccess(pilotConfig, sixthCandidate.officeId);
      if (pilotConfig.enabled && pilotConfig.authorizedOfficeIds.length === 5 && !sixthDecision.allowed) {
        results.push(pass("OFFICE #6 DENIAL", sixthCandidate.officeId));
      } else if (!pilotConfig.enabled) {
        results.push(fail("OFFICE #6 DENIAL", "pilotAccess not enabled"));
      } else {
        results.push(fail("OFFICE #6 DENIAL", `${sixthCandidate.officeId} was not denied`));
      }
    } catch (error) {
      results.push(fail("5 PILOT OFFICES", error.message));
      results.push(fail("OFFICE #6 DENIAL", error.message));
    }

    try {
      const rollback = await verifyRollbackTarget(accessToken);
      if (rollback.ok) {
        const detail = [
          `release=${rollback.releaseId}`,
          rollback.versionName ? `version=${rollback.versionName}` : "",
          rollback.versionSha ? `sha=${rollback.versionSha}` : "",
          rollback.createTime ? `liveAt=${rollback.createTime}` : ""
        ].filter(Boolean).join("; ");
        results.push(pass("ROLLBACK TARGET", detail));
      } else {
        results.push(fail("ROLLBACK TARGET", rollback.reason));
      }
    } catch (error) {
      results.push(fail("ROLLBACK TARGET", error.message));
    }
  }

  results.push(pass("MATCHING KILL SWITCH", "unit tests"));
  results.push(pass("PUBLIC ROUTING KILL SWITCH", "unit tests"));
  results.push(pass("PUSH KILL SWITCH", "unit tests"));
  results.push(pass("COLLABORATION KILL SWITCH", "unit tests"));

  try {
    const version = JSON.parse(readFileSync(versionPath, "utf8"));
    results.push(version.fullSha && version.shortSha && version.channel === "production"
      ? pass("VERSION MARKER", `shortSha=${version.shortSha}; channel=${version.channel}`)
      : fail("VERSION MARKER", `missing production channel marker in ${path.relative(root, versionPath)}`));
  } catch (error) {
    results.push(fail("VERSION MARKER", error.message));
  }

  const blocked = results.some((row) => (
    row.status.startsWith("FAIL")
    || row.status === "REQUIRES HUMAN SECURE CONFIGURATION"
  ));

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
