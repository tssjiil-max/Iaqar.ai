#!/usr/bin/env node
// Fail-closed check: staging must not access production Firebase or Worker.
import { readFileSync, readdirSync } from "node:fs";
const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const html = read("public/index.html");
const scripts = readdirSync(new URL("../public/js/", import.meta.url)).filter(file => file.endsWith(".js")).map(file => "public/js/" + file);
const problems = [];
if (!html.includes('src="/__/firebase/init.js"') || html.includes("https://aqar-b5d76.web.app/__/firebase/init.js"))
  problems.push("index.html must initialize Firebase from current Hosting project.");
for (const path of scripts) {
  const contents = read(path);
  if (contents.includes("https://iaqar-macrodroid-intake.iaqar-ai.workers.dev"))
    problems.push(path + " targets PRODUCTION Cloudflare Worker.");
}
if (read("public/js/firebase-office.js").includes('const PROJECT_ID = "aqar-b5d76"'))
  problems.push("Firebase office runtime hardcodes production.");
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== "iaqar-ai-staging")
  problems.push("Target project must be iaqar-ai-staging.");
if (problems.length) {
  console.error("STAGING DEPLOY BLOCKED: cross-environment isolation not verified.");
  for (const issue of problems) console.error("- " + issue);
  process.exitCode = 1;
} else console.log("Staging static cross-environment guard: PASS");
