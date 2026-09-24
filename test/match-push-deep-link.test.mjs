import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { buildNotificationLink } from "../worker/src/index.js";

test("MATCH_REVIEW push preserves its exact match in the generated deep link", async () => {
  const source = readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");
  const start = source.indexOf("async function sendOfficeMatchNotifications(");
  const end = source.indexOf("\nfunction buildNotificationLink(", start);
  assert.ok(start >= 0 && end > start);
  const links = [];
  const context = {
    console,
    Date,
    livingTaskId: (id) => `mg_${id}`,
    setFirestoreDocument: async () => {},
    firestoreString: String,
    firestoreInteger: Number,
    firestoreBoolean: Boolean,
    firestoreTimestamp: (value) => value,
    sendOfficePush: async (args) => {
      links.push(buildNotificationLink(args));
    }
  };
  const send = runInNewContext(`${source.slice(start, end)}\nsendOfficeMatchNotifications`, context);
  await send({
    projectId: "iaqar-ai-staging",
    officeId: "office-staging",
    accessToken: "test-token",
    matches: [{
      matchId: "mat_exact_1",
      operationId: "op_exact_1",
      matchGroupId: "opp_exact_1",
      opportunityId: "opp_exact_1"
    }]
  });
  assert.equal(links.length, 1);
  const params = new URL(links[0], "https://example.test").searchParams;
  assert.equal(params.get("officeId"), "office-staging");
  assert.equal(params.get("openDailyTask"), "mg_opp_exact_1");
  assert.equal(params.get("openOperation"), "op_exact_1");
  assert.equal(params.get("openOpportunity"), "opp_exact_1");
  assert.equal(params.get("openMatch"), "mat_exact_1");
});
