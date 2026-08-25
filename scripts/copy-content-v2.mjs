/**
 * Copies src/v2 content modules into public/ for the existing App Shell.
 * Does not emit a separate V2 app, header, or navigation.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "src", "v2", "content");
const jsOut = path.join(root, "public", "js", "v2");
const cssOut = path.join(root, "public", "css", "content-v2.css");

function rewriteBrowserImports(directory) {
  // src/v2/content/<area>/*.js resolves ../../../../public/js from the repo root.
  // After copy to public/js/v2/<area>/, the browser needs ../../ (public/js).
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      rewriteBrowserImports(full);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const text = readFileSync(full, "utf8");
    const next = text.replaceAll("../../../../public/js/", "../../");
    if (next !== text) writeFileSync(full, next);
  }
}

rmSync(jsOut, { recursive: true, force: true });
mkdirSync(jsOut, { recursive: true });
cpSync(path.join(src, "flag.js"), path.join(jsOut, "flag.js"));
cpSync(path.join(src, "domain.js"), path.join(jsOut, "domain.js"));
cpSync(path.join(src, "mount.js"), path.join(jsOut, "mount.js"));
cpSync(path.join(src, "office-collapse.js"), path.join(jsOut, "office-collapse.js"));
cpSync(path.join(src, "task-summary.js"), path.join(jsOut, "task-summary.js"));
cpSync(path.join(src, "opportunity-details"), path.join(jsOut, "opportunity-details"), {
  recursive: true,
  filter: (srcPath) => !srcPath.endsWith(".css")
});
rewriteBrowserImports(path.join(jsOut, "opportunity-details"));
cpSync(path.join(src, "daily-tasks"), path.join(jsOut, "daily-tasks"), {
  recursive: true,
  filter: (srcPath) => !srcPath.endsWith(".css")
});
rewriteBrowserImports(path.join(jsOut, "daily-tasks"));

const baseCss = readFileSync(path.join(src, "styles.css"), "utf8");
const detailsCss = readFileSync(path.join(src, "opportunity-details", "styles.css"), "utf8");
const dailyTasksCss = readFileSync(path.join(src, "daily-tasks", "styles.css"), "utf8");
writeFileSync(
  cssOut,
  `${baseCss}\n\n/* Opportunity details (Content V2) */\n${detailsCss}\n\n/* Daily tasks execution list (Content V2) */\n${dailyTasksCss}\n`
);
console.log("src/v2 content copied → public/js/v2 + public/css/content-v2.css");
