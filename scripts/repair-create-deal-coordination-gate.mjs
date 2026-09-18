import fs from "node:fs";

const indexPath = "worker/src/index.js";
const packagePath = "worker/package.json";

let source = fs.readFileSync(indexPath, "utf8");
const oldLine = '    const creationGate=evaluateDealCreation({match:m,coordination:{outcome:m.coordinationOutcome||""}});';
const replacement = [
  '    const coordination=await loadCoordinationSession(partySessionHelpers(),{projectId,officeId,matchId:recordId,accessToken});',
  '    const creationGate=evaluateDealCreation({match:m,coordination});'
].join("\n");

if (!source.includes(oldLine)) {
  throw new Error("create_deal legacy coordination projection line not found");
}
source = source.replace(oldLine, replacement);
fs.writeFileSync(indexPath, source);

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const testCommand = "node test/create-deal-coordination-gate.test.mjs";
if (!pkg.scripts?.test) throw new Error("worker package test script not found");
if (!pkg.scripts.test.includes(testCommand)) {
  pkg.scripts.test = `${testCommand} && ${pkg.scripts.test}`;
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
