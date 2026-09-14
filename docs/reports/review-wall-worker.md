# Wall and worker review

Reviewed wall commit `6c7726e`, current Python worker/tests, integration requirements, and pinned upstream adapter behavior. Read-only implementation review; no live services, model calls, or broad test reruns. Previously reported simulator builds and tests were not independently repeated.

## Findings

1. **P1 — In-flight encoder output can cross pairing boundaries.** `wall-app/Sources/Capture/SegmentWriter.swift:57–62` clears the ring and switches identity, but encoding remains asynchronous, supplies no per-frame context (`:151`), and callback ingestion carries no origin. A sample submitted before the switch can arrive afterward, repopulate the cleared ring, and be labeled with the new device when a file starts. Capture a pairing generation for each submitted frame and reject stale output before ingestion; include delayed callback coverage. Parent accepted; wall implementer is fixing this.

2. **P2 — Lost completion responses can defeat idempotent recovery.** `engine-worker/contentstation_worker.py:359–360` checks the local lease before every `/done` retry. If the first request commits and its response is lost, the concurrent heartbeat receives 409 because the job is already done (`:315–317`), sets cancellation, and prevents the otherwise valid identical retry. Stop renewal during completion and allow bounded identical completion retries under server authorization, including after an ambiguous outcome. Add a test whose first completion commits, heartbeat rejects, and second completion returns original IDs. Parent accepted and is fixing this.

3. **P2 — AI mode discards upstream captioned exports.** Worker `:278` always uploads `source_clip_N.mp4`. Pinned upstream `main.py:2035–2047` produces a captioned derivative and announces the final deliverable through `CLIP_READY`; captions default on. Speech clips therefore lose captions despite successfully rendering them. Resolve the final output securely within the job directory, or explicitly disable captions and document the clean-export behavior. Verify with a stub upstream that produces distinct clean/final files, without model calls.

Stable reference revisions and queue origin checks otherwise match the requested design. Background URLSession lifecycle and real capture scheduling still require targeted device verification.

## Fix verification

Re-reviewed `d2f9cc0` and `31d4d17`: all three findings resolved. Encode closures capture generations and reject stale callbacks on the writer queue. Completion stops renewal and preserves server-authorized retries despite local cancellation. AI exports follow validated `CLIP_READY` paths, including containment checks. Focused regression additions cover each fix. Parent reports 15 Swift assertions, Debug build, 12 worker tests, and real local 30-second 1080×1920 playback passing; not independently rerun. No remaining important findings in the reviewed changes. Physical-device scheduling and paid AI execution remain unverified.
