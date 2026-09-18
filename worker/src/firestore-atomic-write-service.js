function compactFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value != null));
}

function firestoreDocumentName(projectId, segments) {
  const documentPath = segments.map(segment => String(segment)).join("/");
  return `projects/${projectId}/databases/(default)/documents/${documentPath}`;
}

export function buildFirestoreUpdateWrite({ projectId, segments, fields, precondition = null }) {
  if (!projectId) throw new Error("Firestore projectId is required");
  if (!Array.isArray(segments) || segments.length === 0) throw new Error("Firestore document path is required");
  const compacted = compactFields(fields);
  const fieldPaths = Object.keys(compacted);
  if (fieldPaths.length === 0) throw new Error("Firestore update fields are required");
  const write = {
    update: {
      name: firestoreDocumentName(projectId, segments),
      fields: compacted
    },
    updateMask: { fieldPaths }
  };
  if (precondition) {
    if (typeof precondition.updateTime === "string" && precondition.updateTime) {
      write.currentDocument = { updateTime: precondition.updateTime };
    } else if (typeof precondition.exists === "boolean") {
      write.currentDocument = { exists: precondition.exists };
    } else {
      throw new Error("Firestore write precondition must use updateTime or exists");
    }
  }
  return write;
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
    let firestoreCode = "";
    try {
      firestoreCode = String(JSON.parse(detail)?.error?.status || "");
    } catch {}
    const error = new Error(`Firestore atomic commit failed (${response.status}): ${detail}`);
    error.status = response.status;
    error.firestoreCode = firestoreCode;
    error.code = firestoreCode || String(response.status || "");
    throw error;
  }
  return response.json().catch(() => ({}));
}
