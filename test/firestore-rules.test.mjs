import test from "node:test";
import assert from "node:assert/strict";

const host = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || "demo-iaqar";
const base = host && `http://${host}/v1/projects/${projectId}/databases/(default)/documents`;

function unsignedFirebaseToken(uid, claims = {}) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: uid,
    user_id: uid,
    iat: now,
    exp: now + 3600,
    ...claims
  })}.`;
}

const value = {
  string: stringValue => ({ stringValue }),
  bool: booleanValue => ({ booleanValue }),
  array: values => ({ arrayValue: { values } }),
  map: fields => ({ mapValue: { fields } })
};

function officeFields(officeId, ownerUid, officeName) {
  return {
    officeId: value.string(officeId),
    ownerUid: value.string(ownerUid),
    officeName: value.string(officeName),
    officeNameKey: value.string(officeName.replace(/\s/g, "").toLowerCase()),
    brokerName: value.string(`وسيط ${officeId}`),
    phone: value.string("0551234567"),
    licenseNumber: value.string("1234567890"),
    city: value.string("المدينة المنورة"),
    specialties: value.array([]),
    cooperationMode: value.string("APPROVAL_REQUIRED"),
    notificationPreferences: value.map({
      matches: value.bool(true),
      contacts: value.bool(true),
      cooperation: value.bool(true),
      messages: value.bool(true),
      appointments: value.bool(true),
      system: value.bool(true)
    })
  };
}

async function request(path, { token = "owner", method = "GET", fields, updateMask = [] } = {}) {
  const url = new URL(`${base}/${path}`);
  updateMask.forEach(field => url.searchParams.append("updateMask.fieldPaths", field));
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(fields ? { "Content-Type": "application/json" } : {})
    },
    ...(fields ? { body: JSON.stringify({ fields }) } : {})
  });
}

async function seed() {
  await request("offices/office-a", {
    method: "PATCH",
    fields: officeFields("office-a", "user-a", "مكتب ألف")
  });
  await request("offices/office-b", {
    method: "PATCH",
    fields: officeFields("office-b", "user-b", "مكتب باء")
  });
  for (const [officeId, uid] of [["office-a", "user-a"], ["office-b", "user-b"]]) {
    await request(`offices/${officeId}/members/${uid}`, {
      method: "PATCH",
      fields: {
        officeId: value.string(officeId),
        uid: value.string(uid),
        role: value.string("owner"),
        active: value.bool(true)
      }
    });
    await request(`offices/${officeId}/opportunities/seed`, {
      method: "PATCH",
      fields: { officeId: value.string(officeId), title: value.string(`فرصة ${officeId}`) }
    });
  }
}

test("Firestore rules enforce office isolation and backend-only name claims", { skip: !host }, async () => {
  await seed();
  const tokenA = unsignedFirebaseToken("user-a");

  assert.equal((await request("offices/office-a", { token: tokenA })).status, 200);
  assert.equal((await request("offices/office-b", { token: tokenA })).status, 403);
  assert.equal((await request("offices/office-b/opportunities/seed", { token: tokenA })).status, 403);
  assert.equal((await request("offices", { token: tokenA })).status, 403);

  assert.ok([200, 201].includes((await request("offices/office-a/opportunities/client-created", {
    token: tokenA,
    method: "PATCH",
    fields: { officeId: value.string("office-a"), title: value.string("فرصة صحيحة") }
  })).status));
  assert.equal((await request("offices/office-a/opportunities/wrong-tenant", {
    token: tokenA,
    method: "PATCH",
    fields: { officeId: value.string("office-b"), title: value.string("فرصة خاطئة") }
  })).status, 403);

  assert.equal((await request("offices/office-b/opportunities/seed", {
    token: tokenA,
    method: "PATCH",
    fields: { title: value.string("تعديل غير مصرح") },
    updateMask: ["title"]
  })).status, 403);
  assert.equal((await request("officeNameClaims/مكتبألف", {
    token: tokenA,
    method: "PATCH",
    fields: {
      officeId: value.string("office-a"),
      officeName: value.string("مكتب ألف"),
      ownerUid: value.string("user-a")
    }
  })).status, 403);
});
