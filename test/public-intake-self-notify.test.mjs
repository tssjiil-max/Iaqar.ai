import test from "node:test";
import assert from "node:assert/strict";
import {
  SELF_PUBLIC_INTAKE_LIMIT,
  SELF_PUBLIC_INTAKE_STORAGE_KEY,
  createPublicIntakeNotifySession,
  isSelfSubmittedPublicIntake,
  rememberSelfSubmittedPublicIntake,
  shouldNotifyActorAboutPublicIntake
} from "../public/js/public-intake-notify-domain.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

test("the broker who just submitted via the office link is not notified about that intake", () => {
  const stored = rememberSelfSubmittedPublicIntake("intake_self_1", []);
  assert.equal(isSelfSubmittedPublicIntake("intake_self_1", stored), true);
  assert.equal(shouldNotifyActorAboutPublicIntake({
    intakeId: "intake_self_1",
    selfSubmittedIds: stored
  }), false);
});

test("a later public intake from a real visitor still notifies the office", () => {
  const stored = rememberSelfSubmittedPublicIntake("intake_self_1", []);
  assert.equal(shouldNotifyActorAboutPublicIntake({
    intakeId: "intake_visitor_9",
    selfSubmittedIds: stored
  }), true);
});

test("blank or unknown intake ids never suppress a notice", () => {
  assert.equal(shouldNotifyActorAboutPublicIntake({ intakeId: "", selfSubmittedIds: ["intake_1"] }), true);
  assert.equal(shouldNotifyActorAboutPublicIntake({ intakeId: "intake_1", selfSubmittedIds: [] }), true);
  assert.equal(shouldNotifyActorAboutPublicIntake({}), true);
});

test("the newest self-submitted intake stays first and the list stays bounded", () => {
  let stored = [];
  for (let index = 1; index <= SELF_PUBLIC_INTAKE_LIMIT + 3; index += 1) {
    stored = rememberSelfSubmittedPublicIntake(`intake_${index}`, stored);
  }
  assert.equal(stored[0], `intake_${SELF_PUBLIC_INTAKE_LIMIT + 3}`);
  assert.equal(stored.length, SELF_PUBLIC_INTAKE_LIMIT);
  assert.equal(stored.includes("intake_1"), false);
});

test("remembering the same intake again moves it to the front without duplicating", () => {
  const stored = rememberSelfSubmittedPublicIntake("intake_b", ["intake_a", "intake_b"]);
  assert.deepEqual(stored, ["intake_b", "intake_a"]);
});

test("the session helper persists ids and answers the notify gate from storage", () => {
  const memory = new Map();
  const storage = {
    getItem(key) {
      return memory.has(key) ? memory.get(key) : null;
    },
    setItem(key, value) {
      memory.set(key, String(value));
    }
  };
  const session = createPublicIntakeNotifySession(storage);
  session.remember("intake_self_2");
  assert.equal(session.shouldNotify({ intakeId: "intake_self_2" }), false);
  assert.equal(session.shouldNotify({ intakeId: "intake_other" }), true);
  assert.equal(memory.get(SELF_PUBLIC_INTAKE_STORAGE_KEY), JSON.stringify(["intake_self_2"]));
});

test("the public form remembers the intake before matching, and the office listener skips that notice", () => {
  const accessGate = readRepositoryFile("public", "js", "access-gate.js");
  const workflow = readRepositoryFile("public", "js", "workflow-office.js");
  const rememberIndex = accessGate.indexOf("rememberSelfSubmittedPublicIntake(ref.id)");
  const setIndex = accessGate.indexOf("await ref.set(intakePayload)");
  const matchIndex = accessGate.indexOf("triggerPublicIntakeMatching(targetOffice, ref.id)");
  assert.ok(rememberIndex > -1, "the public form must remember the intake it just created");
  assert.ok(setIndex > -1);
  assert.ok(matchIndex > -1);
  assert.ok(rememberIndex < setIndex, "remember before Firestore set so the office listener cannot win the race");
  assert.ok(accessGate.includes("excludeCallerPush"), "logged-in submitters must ask the Worker to skip their own push");
  assert.ok(accessGate.includes("Authorization"), "the public form must send the broker session when present");
  assert.ok(workflow.includes("shouldNotifyForPublicIntake"), "the office listener must consult the self-submit gate");
  assert.ok(workflow.includes("excludeCallerPush"), "the listener must also skip the submitter's push if it runs matching");
  assert.ok(workflow.includes("showLocalMatchNotification"), "match toasts still exist for real visitor intakes");
});

test("the Worker excludes the caller from public-intake match pushes only when asked", () => {
  const worker = readRepositoryFile("worker", "src", "index.js");
  const handlerStart = worker.indexOf("async function handlePublicIntakeMatching(");
  const handlerEnd = worker.indexOf("function structuredPublicIntakeToParsed(");
  const publicIntake = worker.slice(handlerStart, handlerEnd);
  assert.ok(publicIntake.includes("excludeCallerPush"), "public-intake must honour excludeCallerPush");
  assert.ok(publicIntake.includes("peekCallerUid"), "the caller uid must be read without failing the public route");
  assert.ok(publicIntake.includes("excludeUserUid"), "the match push must receive the excluded uid");
  const pushStart = worker.indexOf("async function sendOfficePush(");
  const pushEnd = worker.indexOf("function configureWebPushVapid(");
  const push = worker.slice(pushStart, pushEnd);
  assert.ok(push.includes("selectOfficePushTargetDevices"), "device targeting must use the shared filter");
  assert.ok(push.includes("excludeUserUid"), "sendOfficePush must accept an excluded uid");
});
