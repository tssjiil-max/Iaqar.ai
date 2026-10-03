/** Office library data: Firestore metadata (offices/<id>/library) + Worker file storage. Same paths and rules as the old screen. */

import { ApiError, db, idToken, workerBase } from "./runtime.js";
import { session } from "./session.js";
import { buildLibraryItem } from "../../js/office-library-domain.js";
import { checkLibraryFile, normalizeLibraryMeta } from "../domain/library-domain.js";

const col = () => db().collection("offices").doc(session.officeId).collection("library");

export async function listLibrary() {
  const snap = await col().orderBy("createdAt", "desc").limit(200).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

/** Uploads the file, then records it. Throws ApiError with a message the screen can show. */
export async function addLibraryItem(file, rawMeta) {
  const checked = checkLibraryFile(file);
  if (!checked.ok) throw new ApiError(checked.message);
  const normalized = normalizeLibraryMeta(rawMeta);
  if (!normalized.ok) throw new ApiError("راجع الحقول المظللة", { details: { errors: normalized.errors } });
  let response;
  try {
    response = await fetch(`${workerBase()}/media/office-library`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await idToken()}`, "X-Office-Id": session.officeId, "X-File-Name": encodeURIComponent(file.name || "file"), "Content-Type": checked.contentType },
      body: file
    });
  } catch (_) {
    throw new ApiError("تعذر الاتصال بالخادم — تحقق من الإنترنت وحاول مجددًا");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new ApiError(body.message || "تعذر رفع الملف", { code: body.error, status: response.status });
  const item = buildLibraryItem({
    officeId: session.officeId, fileName: body.fileName || file.name, contentType: checked.contentType, mediaPath: body.mediaPath,
    ...normalized.meta, fileSizeBytes: file.size, createdBy: session.user.uid
  });
  await col().doc(item.id).set(item);
  return item;
}

/** Edits only the descriptive fields; links to an opportunity/cooperation are never touched. */
export async function updateLibraryItem(id, rawMeta) {
  const normalized = normalizeLibraryMeta(rawMeta);
  if (!normalized.ok) throw new ApiError("راجع الحقول المظللة", { details: { errors: normalized.errors } });
  await col().doc(id).update({ ...normalized.meta, updatedAt: new Date().toISOString() });
}

export async function deleteLibraryItem(id) {
  await col().doc(id).delete();
}

/** Fetches the stored file with the member's token and returns a blob URL. */
export async function fetchLibraryFile(item) {
  if (!item.mediaPath) throw new ApiError("لا يوجد ملف مرتبط");
  let response;
  try {
    response = await fetch(`${workerBase()}/media/office?officeId=${encodeURIComponent(session.officeId)}&path=${encodeURIComponent(item.mediaPath)}`, { headers: { Authorization: `Bearer ${await idToken()}` } });
  } catch (_) {
    throw new ApiError("تعذر الاتصال بالخادم");
  }
  if (!response.ok) throw new ApiError("تعذر فتح الملف");
  return URL.createObjectURL(await response.blob());
}
