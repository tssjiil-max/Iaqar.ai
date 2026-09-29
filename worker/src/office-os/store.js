/**
 * Office OS store — plain-JS reads/writes over the Worker's Firestore REST helpers.
 * Every module here goes through this adapter, so the storage layer can be swapped
 * (tests use an in-memory double) without touching business logic.
 */

export function createStore(deps, { projectId, accessToken }) {
  const {
    getFirestoreDocument, setFirestoreDocument, createFirestoreDocumentIfAbsent,
    patchFirestoreDocument, listCollectionDocuments, firestoreFieldsToJs, jsToFirestoreValue
  } = deps;

  const encode = (obj = {}) => {
    const fields = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue;
      fields[key] = jsToFirestoreValue(value);
    }
    return fields;
  };

  const idOf = (doc) => decodeURIComponent(String(doc?.name || "").split("/").pop() || "");

  return {
    projectId,
    accessToken,
    encode,

    async get(segments) {
      const doc = await getFirestoreDocument({ projectId, segments, accessToken, allowMissing: true });
      if (!doc) return null;
      return { id: String(segments[segments.length - 1]), ...firestoreFieldsToJs(doc.fields || {}), __updateTime: doc.updateTime || "" };
    },

    /** Merge-write the given fields (other fields untouched). */
    async set(segments, obj) {
      await setFirestoreDocument({ projectId, segments, accessToken, fields: encode(obj) });
    },

    /** Create-only. Returns false when the document already exists (idempotent replays). */
    async create(segments, obj) {
      return createFirestoreDocumentIfAbsent({ projectId, segments, accessToken, fields: encode(obj) });
    },

    /** Merge-write guarded by the document's updateTime. Throws status 409 on conflict. */
    async patchIfUnchanged(segments, obj, updateTime) {
      await patchFirestoreDocument({ projectId, segments, accessToken, fields: encode(obj), updateTime });
    },

    async list(segments, pageSize = 300) {
      const docs = await listCollectionDocuments({ projectId, segments, accessToken, pageSize });
      return (docs || []).map((doc) => ({ id: idOf(doc), ...firestoreFieldsToJs(doc.fields || {}) }));
    },

    /**
     * Read-modify-write with an updateTime precondition, retried on conflict so two
     * concurrent replies/actions never overwrite each other.
     */
    async update(segments, mutate, { attempts = 6 } = {}) {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const current = await this.get(segments);
        if (!current) return null;
        const patch = await mutate(current);
        if (!patch) return { current, patch: null };
        try {
          if (current.__updateTime) await this.patchIfUnchanged(segments, patch, current.__updateTime);
          else await this.set(segments, patch);
          return { current, patch, next: { ...current, ...patch } };
        } catch (error) {
          if (error?.status === 409 && attempt < attempts - 1) continue;
          throw error;
        }
      }
      throw Object.assign(new Error("تعذر الحفظ بسبب تحديث متزامن — حاول مجددًا"), { status: 409, code: "concurrent_update", publicMessage: "تعذر الحفظ بسبب تحديث متزامن — حاول مجددًا" });
    }
  };
}

export function officePath(officeId, ...rest) {
  return ["offices", officeId, ...rest];
}
