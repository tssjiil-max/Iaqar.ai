// Starts only the downloaded local Java emulator; never invokes Firebase CLI or cloud discovery.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, openSync, closeSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const jar = process.env.FIRESTORE_EMULATOR_JAR;
assert.ok(jar, "Set FIRESTORE_EMULATOR_JAR to the official v1.19.8 emulator JAR");
assert.equal(createHash("sha256").update(readFileSync(jar)).digest("hex"), "9d43599ed6151199e8d604dc87fac51218e49e5f3a48519b1ae560bbe5e3382d");
const root = path.resolve(import.meta.dirname, "../..");
const log = openSync(process.env.FIRESTORE_EMULATOR_LOG || "/tmp/iaqar-firestore-local.log", "w");
const emulator = spawn("java", ["-jar", jar, "--host", "127.0.0.1", "--port", "8080", "--project_id", "demo-iaqar-financial-verification", "--rules", path.join(root, "firestore.rules"), "--single_project_mode", "true"], { stdio: ["ignore", log, log] });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (emulator.exitCode !== null) throw new Error(`Emulator exited ${emulator.exitCode}`);
    try {
      ready = (await fetch("http://127.0.0.1:8080/", { signal: AbortSignal.timeout(1000) })).status === 200;
    } catch { /* wait for local Java startup */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, "Local emulator must be ready");
  const test = spawn(process.execPath, [path.join(import.meta.dirname, "intake-amount-emulator.mjs")], {
    stdio: "inherit", env: { ...process.env, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", GCLOUD_PROJECT: "demo-iaqar-financial-verification" }
  });
  process.exitCode = await new Promise((resolve, reject) => { test.on("error", reject); test.on("exit", code => resolve(code ?? 1)); });
} finally {
  emulator.kill("SIGTERM");
  await new Promise(resolve => emulator.once("exit", resolve));
  closeSync(log);
}
