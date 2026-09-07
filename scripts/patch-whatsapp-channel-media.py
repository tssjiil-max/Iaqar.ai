from pathlib import Path

path = Path('worker/src/index.js')
s = path.read_text()

old_call = '''          rawPayload: { entryId: wabaId, changeField: change.field, metadata: value.metadata, message },
          accessToken
        });'''
new_call = '''          rawPayload: { entryId: wabaId, changeField: change.field, metadata: value.metadata, message },
          accessToken,
          env
        });'''
if old_call in s:
    s = s.replace(old_call, new_call, 1)
elif 'accessToken,\n          env\n        });' not in s:
    raise SystemExit('WhatsApp save call anchor missing')

old_sig = 'async function saveInboundMessage({ projectId, officeId, wabaId, phoneNumberId, displayPhoneNumber, message, senderName, rawPayload, accessToken }) {'
new_sig = 'async function saveInboundMessage({ projectId, officeId, wabaId, phoneNumberId, displayPhoneNumber, message, senderName, rawPayload, accessToken, env = null }) {'
if old_sig in s:
    s = s.replace(old_sig, new_sig, 1)
elif new_sig not in s:
    raise SystemExit('saveInboundMessage signature anchor missing')

response_anchor = '''  if (!response.ok) {
    const detail = await response.text();
    console.error("[iaqar-whatsapp] Firestore write failed", response.status, detail);
    throw appError("firestore_write_failed", 502, "تعذر حفظ رسالة واتساب");
  }

  try {'''
response_new = '''  if (!response.ok) {
    const detail = await response.text();
    console.error("[iaqar-whatsapp] Firestore write failed", response.status, detail);
    throw appError("firestore_write_failed", 502, "تعذر حفظ رسالة واتساب");
  }

  // Meta media messages may arrive without a text/caption. Until the official
  // media downloader is wired, retain them for review instead of feeding an empty
  // text part into Canonical Intake and falsely marking the channel as failed.
  if (!messageText) {
    await setFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "inbox", documentId],
      accessToken,
      fields: {
        processingState: firestoreString("needs_media_adapter"),
        status: firestoreString("pending_review"),
        isProcessed: firestoreBoolean(false),
        processingError: firestoreString("channel_media_requires_adapter"),
        canonicalIntake: firestoreBoolean(true),
        sourceChannel: firestoreString("whatsapp"),
        updatedAt: firestoreTimestamp(new Date())
      }
    });
    return {
      duplicate: false,
      documentId,
      deferred: true,
      reason: "channel_media_requires_adapter"
    };
  }

  try {'''
if 'reason: "channel_media_requires_adapter"' not in s:
    if response_anchor not in s:
        raise SystemExit('WhatsApp media guard anchor missing')
    s = s.replace(response_anchor, response_new, 1)

old_process = '''      projectId, officeId, inboxDocumentId: documentId, messageText,
      senderName, senderPhone, receivedAt, accessToken
    });'''
new_process = '''      projectId, officeId, inboxDocumentId: documentId, messageText,
      senderName, senderPhone, receivedAt, accessToken, env
    });'''
if old_process in s:
    s = s.replace(old_process, new_process, 1)
elif 'senderName, senderPhone, receivedAt, accessToken, env' not in s:
    raise SystemExit('processInboundMessage env anchor missing')

path.write_text(s)
