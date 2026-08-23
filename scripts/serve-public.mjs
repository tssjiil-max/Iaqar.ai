/**
 * Static public/ server used for local V2 + legacy isolation checks.
 * Directory URLs serve that folder's index.html, not the legacy root.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "public");
const port = Number(process.env.PORT || 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff"
};

function resolveFile(pathname) {
  const clean = decodeURIComponent(pathname.split("?")[0] || "/");
  const joined = path.join(root, clean);
  if (!joined.startsWith(root)) return null;
  if (clean === "/" ) return path.join(root, "index.html");
  if (fs.existsSync(joined) && fs.statSync(joined).isDirectory()) {
    return path.join(joined, "index.html");
  }
  if (fs.existsSync(joined)) return joined;
  if (!path.extname(joined) && fs.existsSync(`${joined}.html`)) return `${joined}.html`;
  return null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  const filePath = resolveFile(url.pathname);
  if (!filePath) {
    res.writeHead(404, { "Cache-Control": "no-store" });
    res.end("not found");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`local public server http://127.0.0.1:${port}/`);
  console.log(`frontend v2        http://127.0.0.1:${port}/v2/#/opportunities`);
});
