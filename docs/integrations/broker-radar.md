# Broker Radar → iAqar staging pilot

Status: implementation prepared for review, not deployed. Manual JSON import, not background sync. No real phone data has been imported or tested.

## Existing source contract

Android repository `tssjiil-max/BrokerRadar-Android`, inspected revision `530d5f7eae608d50496876c9ca1c66b0e9c34cee` (`fix/br-fix-017-capture-alerts-080`). `InternalExport.kt` / `OfficeExport.encode` writes a v1 JSON object per listing. Ads live in the device's Room database; GitHub does not contain that database. Main's README describes an older scaffold, so it was not used as the feature contract.

## Pilot

1. Deploy the reviewed changes to Firebase/Worker **staging only** using the established safe workflow. This branch does not deploy anything itself.
2. Sign into the intended staging office as a manager. Its opportunity scout must already be enabled; import does not change settings.
3. Android: Settings → Privacy and Data → Export full internal listing. Select one real listing and save its JSON.
4. Website: Settings → Broker Radar. Choose that JSON. The preview is local until the explicit import button is pressed. Original ad text may contain phones; additional structured contact evidence is off by default.
5. Import. Verify saved/updated/duplicate counts. The only destination is that office's pending `scoutFeed`, with source `BROKER_RADAR` and Android listing ID. No direct inventory, consent, licence or deal is created.
6. Open the existing opportunity scout. Its normal pipeline understands, merges, matches and reviews the feed. A cycle with no searches, zero fetched items or an error is reported as deferred; running a cycle is not claimed to prove every item was processed. The existing scheduled cycle or an explicit retry may process it later.
7. Review and add the find through the existing broker workflow. Only then should it appear in office records. Repeat the file: no duplicate feed document. Import into a different office: no cross-office read or write.

Limits: 20 exports, 200 KB combined JSON, 4000 characters per original text (the existing scout reader currently consumes up to 2000). Media bytes are not in Android's JSON export; this pilot does not pretend to transfer photos. No notification backfill or reading private WhatsApp history. No enabled API upload on Android.

## Replaceable screen

`#/office?layout=supervision` is an optional screen, reached from the existing office. It uses current session/profile, Firestore-backed shared record/task state and existing detail/action routes. Five sections render inside the screen. Existing office and bottom navigation remain. Change the view/CSS independently of the import contract and services; Claude can replace that presentation later.

## Next step for automatic sync

Requires an explicit Android upload/pairing feature, revocable office-bound authorization, network opt-in, stable outbox IDs, retry/backoff and a tested APK update. Do not call this file importer automatic sync. A real export from the user's phone and authenticated staging session are still required for the live pilot.
