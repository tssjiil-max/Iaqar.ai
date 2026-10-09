// Staging activation of the platform's Telegram bot: the token is checked, nothing secret is
// printed, only the Staging Worker can become the bot's address, and the chain is proven.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALLOWED_UPDATES, cleanToken, prepare, redact, register, stagingWebhookUrl, webhookSecretFor } from "../scripts/staging-telegram-activate.mjs";

const TOKEN = "1234567890:AAExampleExampleExampleExampleExample"; // pragma: allowlist secret
const WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Telegram + the Staging Worker, in memory. */
function world({ me = { is_bot: true, id: 7, username: "iaqar_test_bot" }, workerSecret = null, previousUrl = "" } = {}) {
  const state = { webhook: { url: previousUrl }, calls: [], workerSecret };
  const fetchImpl = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    const target = String(url);
    if (target.startsWith("https://api.telegram.org/")) {
      const method = target.split("/").pop();
      state.calls.push(method);
      if (!target.includes(`/bot${TOKEN}/`)) return json({ ok: false, description: "Unauthorized" }, 401);
      if (method === "getMe") return me ? json({ ok: true, result: me }) : json({ ok: false, description: "Unauthorized" }, 401);
      if (method === "setWebhook") { state.webhook = { url: body.url, secret: body.secret_token, allowed: body.allowed_updates }; return json({ ok: true, result: true }); }
      if (method === "getWebhookInfo") return json({ ok: true, result: { url: state.webhook.url, pending_update_count: 2 } });
    }
    if (target === `${WORKER}/telegram/webhook`) {
      state.calls.push("worker");
      const expected = state.workerSecret === null ? state.webhook.secret : state.workerSecret;
      if (!expected) return json({ ok: false, error: "telegram_webhook_not_configured" }, 503);
      if (init.headers["x-telegram-bot-api-secret-token"] !== expected) return json({ ok: false, error: "telegram_webhook_unauthorized" }, 401);
      return json({ ok: true, ignored: true, reason: "chat_not_linked" });
    }
    throw new Error(`unexpected call to ${target}`);
  };
  return { state, fetchImpl };
}

test("only a bot token is accepted; the webhook secret is stable and never the token", () => {
  assert.equal(cleanToken(`  ${TOKEN}\n`), TOKEN, "stray whitespace from a pasted secret is removed");
  assert.equal(cleanToken("not-a-token"), "");
  assert.equal(cleanToken(""), "");
  const secret = webhookSecretFor(TOKEN);
  assert.match(secret, /^[a-f0-9]{64}$/);
  assert.equal(webhookSecretFor(TOKEN), secret, "the same on every deploy");
  assert.ok(!secret.includes(TOKEN.split(":")[1]));
  assert.notEqual(webhookSecretFor(`${TOKEN}x`), secret);
  assert.equal(webhookSecretFor(TOKEN, "my_own-secret_value_123"), "my_own-secret_value_123", "an explicit secret wins");
  assert.throws(() => webhookSecretFor(TOKEN, "short"));
  assert.throws(() => webhookSecretFor(TOKEN, "has spaces in the secret value"));
});

test("only the Staging Worker can become the bot's address", () => {
  assert.equal(stagingWebhookUrl(WORKER), `${WORKER}/telegram/webhook`);
  assert.equal(stagingWebhookUrl(`${WORKER}/`), `${WORKER}/telegram/webhook`);
  for (const bad of ["https://iaqar-macrodroid-intake.iaqar-ai.workers.dev", "http://iaqar-intake-staging.iaqar-ai.workers.dev", "https://iaqar-intake-staging.evil.example", "https://evil.example/iaqar-intake-staging.workers.dev", "", "nonsense"]) {
    assert.throws(() => stagingWebhookUrl(bad), `refuses ${bad || "(empty)"}`);
  }
});

test("prepare: checks the token with Telegram and writes three private files; prints no secret", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-prepare-"));
  const lines = [];
  const { fetchImpl } = world();
  const result = await prepare({ env: { TELEGRAM_BOT_TOKEN: `${TOKEN}\n` }, dir: path.join(dir, "t"), fetchImpl, log: (line) => lines.push(line) });
  assert.equal(result.username, "iaqar_test_bot");
  const read = (name) => fs.readFileSync(path.join(dir, "t", name), "utf8");
  assert.equal(read("TELEGRAM_BOT_TOKEN"), TOKEN);
  assert.equal(read("TELEGRAM_WEBHOOK_SECRET"), webhookSecretFor(TOKEN));
  assert.equal(read("TELEGRAM_BOT_USERNAME"), "iaqar_test_bot");
  assert.equal(fs.statSync(path.join(dir, "t", "TELEGRAM_BOT_TOKEN")).mode & 0o077, 0, "readable by the owner only");
  const printed = lines.join("\n");
  assert.ok(printed.includes("@iaqar_test_bot"));
  assert.ok(!printed.includes(TOKEN) && !printed.includes(webhookSecretFor(TOKEN)), "no secret reaches the log");

  await assert.rejects(prepare({ env: {}, dir, fetchImpl }), /missing or is not a bot token/);
  await assert.rejects(prepare({ env: { TELEGRAM_BOT_TOKEN: TOKEN }, dir, fetchImpl: world({ me: null }).fetchImpl }), /refused/);
  await assert.rejects(prepare({ env: { TELEGRAM_BOT_TOKEN: TOKEN }, dir, fetchImpl: world({ me: { is_bot: false, username: "a_person" } }).fetchImpl }), /does not belong to a bot/);
  const failing = async () => { throw new Error(`connect failed https://api.telegram.org/bot${TOKEN}/getMe`); };
  await assert.rejects(prepare({ env: { TELEGRAM_BOT_TOKEN: TOKEN }, dir, fetchImpl: failing }), (error) => !error.message.includes(TOKEN) && /<token>/.test(error.message));
});

test("register: points the bot at Staging, receive-only, and proves Telegram and the Worker agree", async () => {
  const lines = [];
  const { state, fetchImpl } = world({ previousUrl: "https://old.example/telegram/webhook/some-office" });
  const result = await register({ env: { TELEGRAM_BOT_TOKEN: TOKEN, STAGING_WORKER_URL: WORKER }, fetchImpl, log: (line) => lines.push(line), wait: async () => {} });
  assert.equal(result.url, `${WORKER}/telegram/webhook`);
  assert.equal(state.webhook.url, `${WORKER}/telegram/webhook`);
  assert.equal(state.webhook.secret, webhookSecretFor(TOKEN));
  assert.deepEqual(state.webhook.allowed, [...ALLOWED_UPDATES]);
  assert.ok(!state.calls.some((method) => /^send/i.test(method)), "nothing is sent to anyone");
  const printed = lines.join("\n");
  assert.match(printed, /old\.example/, "says the bot was moved from its previous address");
  assert.ok(!printed.includes("some-office") && !printed.includes(TOKEN) && !printed.includes(state.webhook.secret));

  // The Worker does not have the same secret → refused, with the reason.
  const mismatch = world({ workerSecret: "another-secret-on-the-worker" });
  await assert.rejects(register({ env: { TELEGRAM_BOT_TOKEN: TOKEN, STAGING_WORKER_URL: WORKER }, fetchImpl: mismatch.fetchImpl, log: () => {}, attempts: 2, wait: async () => {} }), /did not accept a signed call/);
  // The Worker has no secret at all.
  const off = world({ workerSecret: "" });
  await assert.rejects(register({ env: { TELEGRAM_BOT_TOKEN: TOKEN, STAGING_WORKER_URL: WORKER }, fetchImpl: off.fetchImpl, log: () => {}, attempts: 2, wait: async () => {} }), /must refuse an unsigned call with 401 \(got 503\)/);
  // Never Production.
  const prod = world();
  await assert.rejects(register({ env: { TELEGRAM_BOT_TOKEN: TOKEN, STAGING_WORKER_URL: "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev" }, fetchImpl: prod.fetchImpl, log: () => {} }), /not the Staging Worker/);
  assert.ok(!prod.state.calls.includes("setWebhook"), "nothing was changed at Telegram");
});

test("a token never survives in a message", () => {
  assert.equal(redact(`x ${TOKEN} y`, TOKEN), "x <token> y");
  assert.equal(redact(`https://api.telegram.org/bot${TOKEN}/getMe`, ""), "https://api.telegram.org/bot<token>/getMe");
});

test("the deploy treats the bot as optional and never deploys it outside Staging", () => {
  const script = fs.readFileSync(new URL("../scripts/deploy-staging.sh", import.meta.url), "utf8");
  assert.match(script, /if \[\[ -n "\$\{TELEGRAM_BOT_TOKEN:-\}" \]\]; then/);
  assert.match(script, /TELEGRAM_BOT_TOKEN not set/);
  for (const name of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_BOT_USERNAME"]) {
    assert.match(script, new RegExp(`wrangler secret put ${name} --env staging`), `${name} goes to the staging Worker only`);
  }
  // The intake bot's three settings; the separate support bot (TELEGRAM_SUPPORT_*) has its own two.
  const puts = script.split("\n").filter((line) => line.includes("wrangler secret put TELEGRAM_") && !line.includes("TELEGRAM_SUPPORT_"));
  assert.equal(puts.length, 3);
  const supportPuts = script.split("\n").filter((line) => line.includes("wrangler secret put TELEGRAM_SUPPORT_"));
  assert.equal(supportPuts.length, 2);
  assert.ok(supportPuts.every((line) => line.includes("--env staging")));
  assert.ok(puts.every((line) => line.includes("--env staging")));
  assert.match(script, /staging-telegram-activate\.mjs register/);
  const production = fs.readFileSync(new URL("../worker/wrangler.toml", import.meta.url), "utf8");
  assert.ok(!/TELEGRAM_BOT_TOKEN\s*=/.test(production), "no token in the repository");
});
