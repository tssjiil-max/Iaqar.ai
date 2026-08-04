# System Architecture

## Current architecture

IAQAR.AI is a framework-free Arabic RTL progressive web application.

| Layer | Current implementation |
| --- | --- |
| Web client | Static HTML/CSS in `public/index.html` and browser JavaScript in `public/js/` |
| Hosting/PWA | Firebase Hosting, `manifest.webmanifest`, service worker, share target |
| Identity | Firebase Authentication compat SDK and office membership documents |
| Database | Cloud Firestore with office subcollections |
| Authorization | `firestore.rules` plus Cloudflare Worker authorization |
| Backend | Cloudflare Worker in `worker/src/index.js` |
| Media | Private/public-scoped Cloudflare R2 keys through authenticated Worker routes |
| Push | Firebase Cloud Messaging HTTP v1 through the Worker, with in-app fallback |
| External intake | Official Meta webhook and PWA share target; outbound messaging disabled |
| Tests | Node test runner in `worker/test/worker.test.mjs` plus syntax checks |

The repository has no bundler or frontend framework. This is an intentional
constraint for current phases; new work must fit the existing browser-script
and Worker structure.

## Tenant boundary

Authenticated workspace data is stored under:

```text
offices/{officeId}
  members/{uid}
  opportunities/{id}
  matches/{id}
  deals/{id}              # legacy internal workflow data; not a public Deals page
  alerts/{id}
  devices/{id}
  inbox/{id}
  publicIntake/{id}
```

Firestore membership checks guard client reads. Worker routes verify Firebase
ID tokens and independently confirm office ownership or membership before
sensitive operations. Every office child document must also contain the same
`officeId`.

Public office projections are stored separately in `publicOffices`. They must
contain public-safe identity data only and are never an authorization source.

## Phase 1 architecture

Office Settings continues to use the office document as the source of truth.
System-wide office-name uniqueness uses an atomic claim document:

```text
officeNameClaims/{normalizedName}
  officeId
  ownerUid
  officeName
  createdAt
  updatedAt
```

The claim and office update occur in one Firestore transaction. Rules bind an
existing claim to its owning office and prevent a different office from
overwriting it.

Office identity media is uploaded through an authenticated Worker route. R2
keys are office-scoped and kind-scoped:

```text
office-identity/{officeId}/{logo|display|cover}
```

The browser crops selected images before upload. Crop ratios are defined in one
configuration object rather than repeated through the UI.

Notification category preferences and cooperation mode are persisted on the
office profile:

```text
notificationPreferences: {
  matches,
  contacts,
  cooperation,
  messages,
  appointments,
  system
}
cooperationMode: DISABLED | APPROVAL_REQUIRED | SMART_AUTOMATIC
```

`APPROVAL_REQUIRED` is the default. These preferences do not grant cooperation
access; Phase 6 will add explicit cooperation records and permissions.

## Approved target architecture

Future phases extend the existing stack with Firestore-backed domain records
and a small database-backed outbox/job mechanism when asynchronous processing
is needed. No external message broker is required.

Representative flow:

```text
source received -> source stored -> analysis requested -> data extracted
-> opportunity created/updated -> completeness evaluated -> matching requested
-> match created -> operation created -> notification created -> broker action
```

Each handler must use a stable deduplication key, record status/failure, enforce
the tenant boundary, and tolerate retries. External provider failures must not
corrupt the Opportunity.

## Known architectural constraints

- `worker/src/index.js` is currently monolithic; this is technical debt, not
  authorization to migrate frameworks during a feature phase.
- Existing `deals` documents remain internal compatibility data. The approved
  UI must not expose a separate Deals page or navigation item.
- Production Meta and FCM readiness depends on deployment secrets that are not
  committed. Code-level adapter tests do not prove a deployed integration.
