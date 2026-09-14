# Wall application reliability report

Implemented Task 3 in the committed Xcode project and matching project.yml. No signing, distribution, deployment, or TestFlight changes.

## Changes

- DeviceConfig decodes optional `reference_frame_revision`. Both framing completion and drift reset use this saved revision. Polling a different signed URL with the same revision changes neither state. Older servers without a revision no longer infer a save from URL changes; framing still expires by time.
- Each completed segment records the device ID captured when its writer starts. Changing pairing finishes the old writer and clears pre-roll. Queued upload URL / completion calls explicitly use the captured active pairing token, so a later token cannot substitute midway through processing.
- Queue records persist origin device ID and quarantine state. A mismatched pairing, missing token, or legacy record is quarantined. Same-device persisted records resume across restart. Unknown crash-orphan MP4s are quarantined because their original identity cannot be proved. This intentionally trades orphan recovery for shop isolation.
- Unpair cancels queue processing, old background tasks, config/heartbeat loops, and outstanding API requests. Results check authorization again after awaits; callbacks cannot resurrect quarantined or removed entries. Preview/thumb detached requests capture their credential before dispatch.
- Retention still removes quarantined files and unknown expired MP4s; removed queued items also cancel associated background tasks. Storage 401/403 refreshes its signed URL on retry; device API 401 ends queue processing and triggers unpair.
- `CS_API_BASE_URL` is required, backend-neutral, and used without any added suffix. Legacy anon key/header is optional. Debug uses a separate Info-Debug.plist permitting local-network HTTP; Release retains ATS defaults with no exception.

## Verification performed

- Added the pure Swift regressions first and observed failure because revision and authorization policies did not yet exist.
- `wall-app/Tests/run.sh`: 11 assertions passed. Covers decoded stable/new/legacy revisions, same/different/absent pairing credentials, and the actual StateMachine remaining in framing on URL rotation and exiting after a saved revision.
- Checked-in Xcode project built successfully for iOS Simulator, Debug and Release, with `CODE_SIGNING_ALLOWED=NO` (Xcode 26). No project regeneration was necessary.
- Inspected the built Info.plist files: Debug contains only `NSAllowsLocalNetworking = true`; Release has no `NSAppTransportSecurity` exception.
- `git diff --check` clean for wall files.

## Remaining physical-device verification

The pure Swift tests exercise reference/framing and authorization policies, not iOS background URLSession execution or persisted queue I/O. Verify on an iPhone: delayed writer completion during re-pair; force quit/relaunch with same-pairing background uploads; token revocation while PUT/completion runs; re-pairing while offline; retention removal of quarantined files; fragmented MP4 recovery after power loss. Also verify QR/Wi-Fi enrollment, real camera pre-roll and orientation, exposure/white balance, drift threshold under shop lighting, thermal recovery and long-duration recording. Simulator build success does not establish those hardware behaviors.

No physical-device or hosted Firebase smoke test was performed by this task. Full local engine/owner integration is reported separately by the integration task.

## Follow-up: asynchronous encoder pairing race

Review identified that clearing the pre-roll ring alone did not prevent a VideoToolbox callback already in flight from repopulating it after a pairing switch. Fixed by capturing a generation in each per-frame encode output handler and checking that generation on the writer's serial queue immediately before ingestion. Pairing switches and encoder rebuilds advance the generation before clearing the ring. Switching pairing also clears prior motion state and forces the next encoded frame to be a keyframe. The former unretained C callback has been replaced by a per-frame handler with a weak writer reference.

Added generation regressions before the change and observed their initial compile failure for the missing policy. `Tests/run.sh` now passes 15 assertions, including acceptance of current callbacks and rejection of delayed old-pairing / old-encoder callbacks. Rebuilt the changed Debug simulator target successfully with signing disabled; no unrelated Release rerun. This proves the generation policy and successful integration compilation, not a physical VideoToolbox timing stress test. The iPhone re-pair-under-capture scenario remains in the hardware checklist.
