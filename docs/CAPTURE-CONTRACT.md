# The Capture Contract

The stable interface of Content Station. The iPhone station and the processing
pipeline never talk to each other — they both talk to Firebase, and this
document is the agreement between them.

Anything that honours this contract can be the pipeline: the Node worker in
this repo, a Cloud Function, an n8n flow, a Python script driving any LLM, or
a human with a laptop. The station does not know and must never need to know.

```
station (iPhone) ──▶ Cloud Storage + Firestore ◀── any processor(s)
```

- **Project:** `lemekeru` · **Bucket:** `lemekeru-content-station`
- **Collections:** `csCaptures`, `csStations`
- The station authenticates as an anonymous Firebase user whose uid is the
  station identity. Processors authenticate with the Admin SDK (service
  account) and bypass security rules.

---

## What the station writes (the producer side)

One capture = one Storage object + one Firestore document, in that order.
The document only appears after the footage is fully uploaded, so a document
with `status: "uploaded"` is a guarantee that its bytes exist.

**Storage:** `captures/{captureId}/raw.mp4` — vertical video, ≤500 MB,
`video/*` content type. `captureId` is a lowercase UUID derived from the
recording's filename, which makes station retries idempotent.

**Firestore:** `csCaptures/{captureId}`:

```jsonc
{
  "stationId": "<uid of the station>",   // enforced by rules == request.auth.uid
  "status": "uploaded",                   // the only status a station may write
  "storagePath": "captures/<id>/raw.mp4",
  "bytes": 8123456,
  "createdAt": <timestamp>,
  "updatedAt": <timestamp>
}
```

The station's write access ends here. Rules prevent it from setting any other
status, touching other stations' captures, or approving itself.

## What the owner writes (the review side)

The dashboard (Firebase Auth, owner email allowlist) may only:

- edit `plan` fields and set `status: "approve_requested"` — a request, not a
  publication
- set `status: "rejected"`
- pair stations: flip `csStations/{uid}.approved` to `true`

## What processors do (the consumer side)

Processors poll (or listen) for work and drive every other status. Two job
types exist today:

| Claim on | Working status | Success | Failure |
|---|---|---|---|
| `uploaded` | `processing` | `needs_review` or `culled` | `error` |
| `approve_requested` | `publishing` | `approved` | `publish_failed` |

**Claim protocol** — required for any processor, and what makes processors
interchangeable and concurrent:

1. Query candidates by status, oldest `createdAt` first.
2. In a **transaction**: re-read the doc; proceed only if it is still in the
   claimable status (or its claim is stale); set the working status plus
   `claimedBy` (any stable worker id) and `claimedAt` (server timestamp).
3. A claim older than 15 minutes is stale — the worker died; any processor may
   re-claim.
4. On completion, delete `claimedBy`/`claimedAt`, set the result status and
   `updatedAt`. On failure, also set `error` (string, human-readable — it is
   shown to the owner).

**Processing a capture** (`uploaded` → `needs_review`) means, at minimum:
download `storagePath`, produce a reviewable `plan`, upload any derived media
under the same prefix, and write:

```jsonc
{
  "status": "needs_review",
  "transcript": "...",                    // "" if none — never omit
  "probe": { "durationSec": 15.0, "width": 720, "height": 1280, "warnings": [] },
  "plan": { /* ContentPlan, below */ },
  "scene": { "description": "...", "objects": ["..."], "showsBusiness": true, "reason": "..." },
  "thumbStoragePath": "captures/<id>/thumbnail.jpg",
  "brandedStoragePath": "captures/<id>/branded.mp4"   // or null if unusable
}
```

Derived media lives under `captures/{captureId}/` — the same prefix — so that
deleting the prefix deletes the capture completely.

**Publishing** (`approve_requested` → `approved`) means posting
`brandedStoragePath` (or raw) to the platforms in `approvedPlatforms` using
`plan.captions`, then writing `postizDraftId` (or an equivalent external id)
and `status: "approved"`. Publishing credentials belong to the processor, never
to the dashboard or the station.

**Culled captures.** A station on a timer films the same corner all day, so
most clips show nothing worth an owner's attention. A processor may end a
capture as `culled` instead of `needs_review`, writing `cullReason` (a sentence
the owner can read) and deleting the capture's Storage objects exactly as a
rejection does. Culling must be conservative: a measurement that fails should
let the capture through, never discard it. The reference implementation culls
on two signals — no motion in frame, and a vision pass judging that the frames
do not show the business at all.

**Rejected captures:** a processor must treat `status: "rejected"` as a
deletion order — remove every object under the capture's prefix and set
`status: "deleted"`. Raw footage of customers is a liability; it does not
linger.

## ContentPlan shape

The one structure the dashboard renders and edits. Any generator — any model,
any harness, or none — must produce:

```jsonc
{
  "usable": true,
  "angle": "one-line editorial angle",
  "hookOptions": ["three", "hook", "candidates"],
  "selectedHook": "the default choice",
  "onScreenTitle": "burned into the render",
  "captions": { "instagram": "...", "tiktok": "...", "facebook": "..." },
  "cta": "call to action",
  "hashtags": ["#..."],
  "platforms": ["instagram", "tiktok", "facebook"],
  "recommendedTime": "free-form",
  "warnings": ["surfaced verbatim to the owner"]
}
```

**Ground the copy in the footage.** A generator that only sees a transcript
will invent when the transcript is empty — a real capture of a desk and two
laptops produced "1 WRENCH = 3 JOBS DONE" for a hardware store. Describe the
frames and pass that description to the writer, and keep concrete claims
answerable to what was actually seen or said.

Two invariants regardless of generator:

- **Prohibited-claims guard.** Captions must never contain the configured
  prohibited claims (see `PROHIBITED_CLAIMS`); scrub or regenerate before
  writing the plan.
- **Warnings are honest.** If the plan was produced without a model, degraded,
  or from an empty transcript, say so in `warnings` — the owner reads them.

## Station registry (`csStations/{uid}`)

Written by the station on first launch: `{ approved: false, pairingCode:
"<6 chars>", name, appVersion, createdAt, lastSeenAt }`. The owner approves;
a processor then mirrors approval into the custom auth claim
`stationApproved: true` (Storage rules read the claim, not the collection) and
records `claimSynced: true`. Revoking works the same in reverse. A station
whose identity is deleted server-side recovers by re-registering under a new
uid with the same pairing code — expect and tolerate duplicate codes, pair the
most recently seen.

## What this buys

The station app on TestFlight never changes when the pipeline does. Swap the
LLM, move rendering to a GPU box, replace the worker with a cloud service,
run three processors at once — the phone in the shop keeps doing the only
thing it knows: record, upload, mark `uploaded`.

## Reference implementation

`apps/backend/src/worker.ts` implements the consumer side; the LLM call in
`apps/backend/src/hermes.ts` is a plain OpenAI-compatible HTTP request
configured entirely by `CONTENT_LLM_BASE_URL` / `CONTENT_LLM_API_KEY` /
`CONTENT_LLM_MODEL` — point it at any compatible endpoint (OpenRouter, Ollama,
LM Studio, a local proxy) with no code change.
