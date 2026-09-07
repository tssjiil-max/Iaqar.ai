/**
 * Office activity recording service.
 * Operational activity belongs to the office runtime, not to the platform-admin control plane.
 */

export async function recordOfficeActivityEvent(helpers, {
  projectId,
  accessToken,
  officeId,
  eventType,
  metadata = {}
}) {
  if (!officeId || officeId === "platform") return;
  const eventId = `evt_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "activityEvents", eventId],
    accessToken,
    fields: {
      officeId: helpers.firestoreString(officeId),
      eventType: helpers.firestoreString(eventType),
      occurredAt: helpers.firestoreTimestamp(now),
      metadataJson: helpers.firestoreString(JSON.stringify(metadata || {}))
    }
  });
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId],
    accessToken,
    fields: {
      officeId: helpers.firestoreString(officeId),
      lastActivityAt: helpers.firestoreTimestamp(now),
      ...(eventType === "login" ? { lastLoginAt: helpers.firestoreTimestamp(now) } : {})
    }
  });
}

export async function recordOfficeLoginActivity(helpers, { projectId, accessToken, officeId, uid }) {
  return recordOfficeActivityEvent(helpers, {
    projectId,
    accessToken,
    officeId,
    eventType: "login",
    metadata: { uid: uid || "" }
  });
}
