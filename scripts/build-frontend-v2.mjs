import { cpSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "src", "v2");
const out = path.join(root, "public", "v2");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const tsc = spawnSync(process.execPath, [
  path.join(root, "node_modules", "typescript", "bin", "tsc"),
  "-p",
  path.join(src, "tsconfig.json")
], { cwd: root, stdio: "inherit" });

if (tsc.status !== 0) {
  process.exit(tsc.status || 1);
}

cpSync(path.join(src, "index.html"), path.join(out, "index.html"));
cpSync(path.join(src, "styles"), path.join(out, "styles"), { recursive: true });
console.log("frontend v2 built → public/v2");
