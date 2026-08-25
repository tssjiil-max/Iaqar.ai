#!/usr/bin/env node
/**
 * Local QA server: static public/ + in-memory worker routes.
 * Does not touch production Firebase or production worker data.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resetWorld,
  snapshot,
  operationsForOffice,
  opportunitiesForOffice,
  patchOpportunity,
  mintPartySession,
  getPartySession,
  replyPartySession,
  confirmCompletion,
  cooperationAction,
  bookAppointment,
  setFailNextPatch,
  OFFICES
} from "./qa-store.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = path.join(root, "public");
const PORT = Number(process.env.QA_PORT || 4191);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2"
};

function send(res, status, body, headers = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body || "");
  res.writeHead(status, {
    "content-length": payload.length,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    ...headers
  });
  res.end(payload);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), { "content-type": "application/json; charset=utf-8" });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

function officeFrom(req, body = {}) {
  const header = String(req.headers["x-office-id"] || "").trim();
  return header || String(body.officeId || OFFICES.client.id);
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (pathname.endsWith("/")) pathname += "index.html";
  const filePath = path.normalize(path.join(publicDir, pathname));
  if (!filePath.startsWith(publicDir)) {
    send(res, 403, "forbidden");
    return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  const ext = path.extname(filePath);
  send(res, 200, fs.readFileSync(filePath), { "content-type": MIME[ext] || "application/octet-stream" });
  return true;
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type,authorization,x-office-id",
      "access-control-allow-methods": "GET,POST,OPTIONS"
    });
    res.end();
    return true;
  }

  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "POST" && pathname === "/qa/reset") {
    resetWorld();
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === "POST" && pathname === "/qa/fail-next-patch") {
    const body = await readBody(req);
    setFailNextPatch(body.count || 1);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (req.method === "GET" && pathname === "/qa/state") {
    sendJson(res, 200, { ok: true, state: snapshot() });
    return true;
  }
  if (req.method === "GET" && pathname === "/qa/operations") {
    const officeId = url.searchParams.get("officeId") || OFFICES.client.id;
    sendJson(res, 200, { ok: true, items: operationsForOffice(officeId) });
    return true;
  }
  if (req.method === "GET" && pathname === "/qa/opportunities") {
    const officeId = url.searchParams.get("officeId") || OFFICES.client.id;
    sendJson(res, 200, { ok: true, records: opportunitiesForOffice(officeId) });
    return true;
  }

  if (req.method === "POST" && pathname === "/opportunity/patch") {
    const body = await readBody(req);
    const result = patchOpportunity(
      body.opportunityId,
      body.formData || {},
      body.editorKey || body.field || "",
      body.patch
    );
    sendJson(res, result.status || 200, result);
    return true;
  }
  if (req.method === "POST" && pathname === "/party/sessions") {
    const body = await readBody(req);
    const result = mintPartySession({
      officeId: officeFrom(req, body),
      matchId: body.matchId,
      party: body.party
    });
    sendJson(res, result.status || 200, result);
    return true;
  }
  const partyGet = pathname.match(/^\/party\/sessions\/([^/]+)$/);
  if (req.method === "GET" && partyGet) {
    const result = getPartySession(decodeURIComponent(partyGet[1]));
    sendJson(res, result.status || 200, result);
    return true;
  }
  const partyReply = pathname.match(/^\/party\/sessions\/([^/]+)\/reply$/);
  if (req.method === "POST" && partyReply) {
    const body = await readBody(req);
    const result = replyPartySession(decodeURIComponent(partyReply[1]), body.action);
    sendJson(res, result.status || 200, result);
    return true;
  }
  if (req.method === "POST" && pathname === "/match/living-action") {
    const body = await readBody(req);
    const result = confirmCompletion(body.matchId);
    sendJson(res, 200, result);
    return true;
  }
  if (req.method === "POST" && (pathname === "/cooperation/request" || pathname === "/cooperation/workflow" || pathname === "/cooperation/lifecycle")) {
    const body = await readBody(req);
    const action = body.action || (pathname.endsWith("/request") ? "REQUEST" : body.action);
    const cooperationId = body.cooperationId || "coop_431";
    const result = cooperationAction(officeFrom(req, body), cooperationId, action);
    sendJson(res, result.status || 200, result);
    return true;
  }
  if (req.method === "POST" && pathname === "/qa/appointments") {
    const body = await readBody(req);
    const result = bookAppointment(body);
    sendJson(res, result.status || 200, result);
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const partyToken = String(url.searchParams.get("cv2Party") || "").trim();
    if (partyToken && url.pathname.startsWith("/qa")) {
      res.writeHead(302, { Location: `/?cv2Party=${encodeURIComponent(partyToken)}` });
      res.end();
      return;
    }
    if (await handleApi(req, res, url)) return;
    if (serveStatic(req, res, url)) return;
    send(res, 404, "not found");
  } catch (error) {
    sendJson(res, 500, { ok: false, error: String(error.message || error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`qa-server listening on http://127.0.0.1:${PORT}\n`);
});
