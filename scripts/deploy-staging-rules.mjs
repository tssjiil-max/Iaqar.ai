// Publish firestore.rules to the Staging Firebase project ONLY (iaqar-ai-staging),
// through the Firebase Rules API (firebase-admin). Used instead of `firebase deploy`
// because the Staging service account cannot read Service Usage (API-enabled check).
// Rules only; Production (aqar-b5d76) is refused.
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getSecurityRules } from "firebase-admin/security-rules";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const PROJECT = "iaqar-ai-staging";
const fail = (msg) => { console.log(`::error title=Staging rules deploy failed::${String(msg).replace(/\r?\n/g, " ").slice(0, 900)}`); process.exit(1); };

if (process.env.IAQAR_DEPLOY_TARGET !== "staging-rules") fail("IAQAR_DEPLOY_TARGET must be 'staging-rules'");
const { serviceAccount } = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT);
if (serviceAccount?.project_id !== PROJECT) fail("service account is not iaqar-ai-staging");

const source = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT });
const rules = getSecurityRules();

try {
  const released = await rules.releaseFirestoreRulesetFromSource(source);
  const live = await rules.getFirestoreRuleset();
  const liveSource = live.source?.[0]?.content || "";
  if (live.name !== released.name || liveSource !== source) fail(`release mismatch: live ${live.name} vs released ${released.name}`);
  const sha = process.env.GITHUB_SHA || "";
  console.log(`Released ${released.name} to ${PROJECT} (cloud.firestore)`);
  console.log(`::notice title=Staging rules::firestore.rules released to ${PROJECT} as ${released.name} from ${sha}`);
} catch (error) {
  fail(`${error?.code || ""} ${error?.message || error}`);
}
