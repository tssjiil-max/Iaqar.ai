#!/usr/bin/env node
// Stand-in for a linter/type checker.
//
// This project ships no build step and has no linter or type checker configured, so the
// closest honest equivalent is: parse every JavaScript file we ship (including the inline
// scripts inside the HTML shells), parse every JSON config, and sanity-check the
// Firestore rules file. This catches syntax regressions, not type or style problems, and
// must not be reported as "lint passes".

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const SKIP_DIRECTORIES = new Set([".git", "node_modules", ".cursor"]);

const failures = [];
let checked = 0;

function fail(file, error) {
  failures.push(`${path.relative(root, file)}: ${error && error.message ? error.message : error}`);
}

async function collect(directory, predicate, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".firebaserc") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      await collect(full, predicate, found);
    } else if (predicate(full)) {
      found.push(full);
    }
  }
  return found;
}

function checkJavaScript(file) {
  checked += 1;
  try {
    // `node --check` honours the module type resolved from the nearest package.json, so
    // it parses both the classic browser scripts and the ES modules correctly.
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    fail(file, new Error(String(error.stderr || error.message).trim().split("\n").slice(0, 4).join(" ")));
  }
}

function checkJson(file) {
  checked += 1;
  try {
    JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(file, error);
  }
}

function checkInlineScripts(file) {
  const html = readFileSync(file, "utf8");
  const pattern = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let index = 0;
  while ((match = pattern.exec(html)) !== null) {
    index += 1;
    const attributes = match[1] || "";
    const code = match[2] || "";
    if (!code.trim()) continue;
    checked += 1;
    try {
      if (/type\s*=\s*["']module["']/i.test(attributes)) {
        // Inline module: parse by wrapping in a function is not possible, so defer to a
        // temporary --check run through stdin-free evaluation.
        new vm.Script(`(async () => {\n${code}\n})`);
      } else {
        new vm.Script(code);
      }
    } catch (error) {
      fail(file, new Error(`inline script #${index}: ${error.message}`));
    }
  }
}

function checkFirestoreRules(file) {
  checked += 1;
  const rules = readFileSync(file, "utf8");
  if (!/^\s*rules_version\s*=\s*'2'\s*;/m.test(rules)) {
    fail(file, new Error("missing rules_version = '2'"));
    return;
  }
  let depth = 0;
  for (const character of rules) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth < 0) break;
  }
  if (depth !== 0) fail(file, new Error(`unbalanced braces (depth ${depth})`));
}

const javascriptFiles = await collect(root, file => /\.(mjs|js)$/.test(file));
for (const file of javascriptFiles) checkJavaScript(file);

const jsonFiles = await collect(root, file => file.endsWith(".json"));
for (const file of jsonFiles) checkJson(file);

const webmanifest = path.join(root, "public", "manifest.webmanifest");
if (await stat(webmanifest).then(() => true, () => false)) checkJson(webmanifest);

const htmlFiles = await collect(root, file => file.endsWith(".html"));
for (const file of htmlFiles) checkInlineScripts(file);

checkFirestoreRules(path.join(root, "firestore.rules"));

if (failures.length) {
  console.error(`check failed (${failures.length} of ${checked} targets):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`check passed: ${checked} targets parsed (${javascriptFiles.length} JS, ${jsonFiles.length} JSON, ${htmlFiles.length} HTML shells).`);
