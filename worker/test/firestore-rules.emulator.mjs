import test from "node:test";
import assert from "node:assert/strict";

const projectId = "aqar-b5d76";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const databaseRoot = `http://${emulatorHost}/v1/projects/${projectId}/databases/(default)`;
const documentRoot = `${databaseRoot}/documents`;

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function userToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: "none", typ: "JWT" })}.${base64Url({
    iss: `https://securetoken.google.com/${projectId}`,
    aud: projectId,
    auth_time: now,
    user_id: uid,
    sub: uid,
    iat: now,
    exp: now + 3600,
    firebase: { identities: {}, sign_in_provider: "custom" }
  })}.`;
}

function fields(value) {
  return {
    officeId: { stringValue: value.officeId },
    ownerUid: { stringValue: value.ownerUid },
    officeName: { stringValue: value.officeName },
    officeNameKey: { stringValue: value.officeNameKey },
    brokerName: { stringValue: value.brokerName },
    phone: { stringValue: value.phone },
    whatsapp: { stringValue: value.phone },
    licenseNumber: { stringValue: "123456" },
    city: { stringValue: "المدينة المنورة" },
    specialties: { arrayValue: { values: [] } },
    logoUrl: { stringValue: "" },
    displayImageUrl: { stringValue: "" },
    coverUrl: { stringValue: "" },
    whatsappCoverUrl: { stringValue: "" },
    publicSlug: { stringValue: `${value.officeId}-public` },
    notificationPreferences: {
      mapValue: {
        fields: {
          matches: { booleanValue: true },
          participants: { booleanValue: true },
          cooperation: { booleanValue: true },
          messages: { booleanValue: true },
          appointmentsFollowUps: { booleanValue: true },
          systemImportant: { booleanValue: true }
        }
      }
    },
    cooperationMode: { stringValue: "APPROVAL_REQUIRED" },
    updatedAt: { timestampValue: new Date().toISOString() }
  };
}

async function firestoreRequest(path, { method = "GET", token = "owner", body } = {}) {
  return fetch(path.startsWith("http") ? path : `${documentRoot}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

async function seed() {
  await firestoreRequest("offices/office-a", {
    method: "PATCH",
    body: { fields: fields({
      officeId: "office-a",
      ownerUid: "owner-a",
      officeName: "مكتب ألف",
      officeNameKey: "مكتبألف",
      brokerName: "وسيط ألف",
      phone: "0551234567"
    }) }
  });
  await firestoreRequest("offices/office-b", {
    method: "PATCH",
    body: { fields: fields({
      officeId: "office-b",
      ownerUid: "owner-b",
      officeName: "مكتب باء",
      officeNameKey: "مكتبباء",
      brokerName: "وسيط باء",
      phone: "0551234567"
    }) }
  });
  await firestoreRequest("publicOffices/office-a", {
    method: "PATCH",
    body: { fields: { officeId: { stringValue: "office-a" }, officeName: { stringValue: "مكتب ألف" } } }
  });
}

test.beforeEach(async () => {
  const response = await fetch(`http://${emulatorHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
    method: "DELETE"
  });
  assert.ok(response.ok, `failed to clear emulator: ${response.status}`);
  await seed();
});

test("office owners can access their tenant but cannot read, query, or modify another office", async () => {
  const token = userToken("owner-a");
  assert.equal((await firestoreRequest("offices/office-a", { token })).status, 200);
  assert.equal((await firestoreRequest("offices/office-b", { token })).status, 403);

  const query = await firestoreRequest(`${databaseRoot}/documents:runQuery`, {
    method: "POST",
    token,
    body: { structuredQuery: { from: [{ collectionId: "offices" }] } }
  });
  assert.equal(query.status, 403);

  const otherUpdate = await firestoreRequest(
    `${documentRoot}/offices/office-b?updateMask.fieldPaths=phone&updateMask.fieldPaths=whatsapp`,
    {
      method: "PATCH",
      token,
      body: { fields: { phone: { stringValue: "0550000000" }, whatsapp: { stringValue: "0550000000" } } }
    }
  );
  assert.equal(otherUpdate.status, 403);

  const ownUpdate = await firestoreRequest(
    `${documentRoot}/offices/office-a?updateMask.fieldPaths=phone&updateMask.fieldPaths=whatsapp`,
    {
      method: "PATCH",
      token,
      body: { fields: { phone: { stringValue: "0550000000" }, whatsapp: { stringValue: "0550000000" } } }
    }
  );
  assert.equal(ownUpdate.status, 200);
});

test("clients cannot change ownership, office names, claims, handles, or public projections", async () => {
  const token = userToken("owner-a");
  const attempts = [
    () => firestoreRequest(`${documentRoot}/offices/office-a?updateMask.fieldPaths=ownerUid`, {
      method: "PATCH",
      token,
      body: { fields: { ownerUid: { stringValue: "attacker" } } }
    }),
    () => firestoreRequest(`${documentRoot}/offices/office-a?updateMask.fieldPaths=officeName&updateMask.fieldPaths=officeNameKey`, {
      method: "PATCH",
      token,
      body: { fields: { officeName: { stringValue: "اسم بديل" }, officeNameKey: { stringValue: "اسمبديل" } } }
    }),
    () => firestoreRequest("officeNameClaims/مكتبألف", {
      method: "PATCH",
      token,
      body: { fields: { officeId: { stringValue: "office-a" }, officeName: { stringValue: "مكتب ألف" } } }
    }),
    () => firestoreRequest("officeHandles/office-a-public", {
      method: "PATCH",
      token,
      body: { fields: { officeId: { stringValue: "office-a" } } }
    }),
    () => firestoreRequest(`${documentRoot}/publicOffices/office-a?updateMask.fieldPaths=officeName`, {
      method: "PATCH",
      token,
      body: { fields: { officeName: { stringValue: "اسم بديل" } } }
    })
  ];
  const statuses = [];
  for (const attempt of attempts) statuses.push((await attempt()).status);
  assert.deepEqual(statuses, [403, 403, 403, 403, 403]);
});

test("an atomic Firestore claim permits exactly one normalized office name owner", async () => {
  const claimUrl = `${documentRoot}/officeNameClaims/${encodeURIComponent("المسارالعقاري")}`;
  const write = officeId => ({
    update: {
      name: `projects/${projectId}/databases/(default)/documents/officeNameClaims/المسارالعقاري`,
      fields: {
        officeId: { stringValue: officeId },
        officeName: { stringValue: "المسار العقاري" }
      }
    },
    updateMask: { fieldPaths: ["officeId", "officeName"] },
    currentDocument: { exists: false }
  });
  const commitA = await firestoreRequest(`${databaseRoot}/documents:commit`, {
    method: "POST",
    body: { writes: [write("office-a")] }
  });
  const commitB = await firestoreRequest(`${databaseRoot}/documents:commit`, {
    method: "POST",
    body: { writes: [write("office-b")] }
  });
  assert.equal(commitA.status, 200);
  assert.notEqual(commitB.status, 200);
  const claim = await (await firestoreRequest(claimUrl)).json();
  assert.equal(claim.fields.officeId.stringValue, "office-a");
});
