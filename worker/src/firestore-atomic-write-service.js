function compactFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value != null));
}

function firestoreDocumentName(projectId, segments) {
  const documentPath = segments.map(segment => String(segment)).join("/");
  return `projects/${projectId}/databases/(default)/documents/${documentPath}`;
}

export function buildFirestoreUpdateWrite({ projectId, segments, fields }) {
  if (!projectId) throw new Error("Firestore projectId is required");
  if (!Array.isArray(segments) || segments.length === 0) throw new Error("Firestore document path is required");
  const compacted = compactFields(fields);
  const fieldPaths = Object.keys(compacted);
  if (fieldPaths.length === 0) throw new Error("Firestore update fields are required");
  return {
    update: {
      name: firestoreDocumentName(projectId, segments),
      fields: compacted
    },
    updateMask: { fieldPaths }
  };
}

export async function commitFirestoreWrites({ projectId, accessToken, writes, fetchImpl = fetch }) {
  if (!projectId) throw new Error("Firestore projectId is required");
  if (!accessToken) throw new Error("Firestore access token is required");
  if (!Array.isArray(writes) || writes.length < 2) throw new Error("Firestore atomic commit requires multiple writes");
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Firestore atomic commit failed (${response.status}): ${detail}`);
  }
  return response.json().catch(() => ({}));
}
