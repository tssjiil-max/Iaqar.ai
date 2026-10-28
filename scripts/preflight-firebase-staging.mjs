#!/usr/bin/env node
// Fail-closed check: staging must not access production Firebase or Worker.
import { readFileSync } from "node:fs";
const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const html = read("public/index.html");
const scripts = ["public/js/access-gate.js", "public/js/workflow-office.js", "public/js/firebase-office.js"];
const problems = [];
if (html.includes("https://aqar-b5d76.web.app/__/firebase/init.js"))
  problems.push("index.html initializes PRODUCTION Firebase (aqar-b5d76).");
for (const path of scripts) {
  const contents = read(path);
  if (contents.includes("https://iaqar-macrodroid-intake.iaqar-ai.workers.dev"))
    problems.push(path + " targets PRODUCTION Cloudflare Worker.");
}
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== "iaqar-ai-staging")
  problems.push("Target project must be iaqar-ai-staging.");
if (problems.length) {
  console.error("STAGING DEPLOY BLOCKED: cross-environment isolation not verified.");
  for (const issue of problems) console.error("- " + issue);
  process.exitCode = 1;
} else console.log("Staging static cross-environment guard: PASS");
