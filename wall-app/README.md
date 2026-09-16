# ContentStation wall app

The current native iOS camera app. It captures motion-gated footage, uploads segments, reports health, and shows one full-screen status at a time. Integration behavior follows the [Firebase contract](../docs/FIREBASE-CONTRACT.md); the current visual implementation lives in `Sources/UI/` and `Sources/State/WallState.swift`.

## Generate and build

Requirements: Xcode 26. Build the checked-in project directly; regeneration is optional and requires a complete XcodeGen installation.

```
cd wall-app
xcodebuild -project ContentStationWall.xcodeproj -scheme ContentStationWall \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Keep `project.yml` and the checked-in project consistent. `Info-Debug.plist` mirrors `Info.plist` and adds only the local-network ATS exception. Release uses `Info.plist` without that exception.

Target: `ContentStationWall`, bundle id `com.contentstation.station`, iOS 17.0, iPhone only, portrait only, SwiftUI lifecycle, Swift 5 language mode.

## API configuration

The app requires `CS_API_BASE_URL`, the Firebase API / Cloud Run origin. No suffix is added. Pairing supplies the device JWT used for authenticated requests. Configuration reads in this order:

1. `Resources/Config.plist`, key `CS_API_BASE_URL`. Empty values are skipped.
2. `Info.plist`, the same key, filled from the build setting in `Config.xcconfig`.

The simplest path is to edit `Config.xcconfig`:

```
CS_API_BASE_URL = https:/$()/YOUR-SERVICE.run.app
```

The `$()` after `https:/` keeps xcconfig from reading `//` as a comment. The value can also be passed on the command line: `xcodebuild ... CS_API_BASE_URL=...`.

Product strings and timing constants come from `Sources/Generated/Product.swift`, written by `scripts/sync-product.sh` from `product.json`. Never edit it by hand.

## Preview states in the simulator

The simulator has no camera, so the app runs with capture disabled and shows whatever state you ask for. Launch arguments:

- `-CS_PREVIEW_STATE <state>` forces the display state. Values: `waiting reading connecting framing recording paused nointernet nointernet_long reframe hot fault`.
- `-CS_MOCK_API 1` makes every API call succeed with canned responses so pairing and the normal loop can be exercised without a backend.

In Xcode, Product > Scheme > Edit Scheme > Run > Arguments has one disabled entry per state. Tick one and run. From the command line:

```
xcrun simctl launch booted com.contentstation.station -CS_PREVIEW_STATE recording
```

Preview states fill in sample values (short code 4KP7, network "Fade Society", "Paused until 3:00 PM") for testing the current screens without a device or backend.

## Where things live

- `Sources/App` app entry, root view, and the coordinator that wires everything together.
- `Sources/State` the state enum with the copy table and the state machine with the priority rules.
- `Sources/UI` one view per glyph, the generic screen, recording, framing.
- `Sources/Capture` capture session, motion gate, segment writer, drift detector, thumbnails, preview streaming.
- `Sources/Network` API client, config long poll, heartbeat, upload queue, connectivity.
- `Sources/Pairing` QR payload, Wi-Fi join, pairing flow.
- `Sources/Support` Keychain, device identity, hours, time formatting, thermal, logging.

Segments are written to `Application Support/ContentStationWall/segments`. The upload queue is `uploads.json` next to it, the last Config is `config.json`, the drift reference is `reference.luma`. Credentials live in the Keychain, so a power cut or reinstall resumes without pairing again.

## Physical device status

Build 9 was accepted in internal TestFlight and tested on an iPhone 15 Pro Max. Pairing, preview, saved framing, recording, upload and cloud rendering produced a fully decoded vertical clip. See the dated [hosted verification report](../docs/reports/hosted-verification.md); a new simulator build does not repeat that hardware verification.

Keep the app open while recording and grant camera permission. During pairing, show the owner's QR on a second device and start about 1–2 feet away. Wi-Fi joining uses the `com.apple.developer.networking.HotspotConfiguration` entitlement. Managed-device enrollment and automatic relaunch are not established by the current verification.

Remaining hardware checks:

- Segment playback after a forced crash or restart, including queued upload recovery.
- The 720p fallback at thermal serious and the automatic recovery from critical.
- Motion gate thresholds (MAD over 6 on 32x32 luma) and the drift threshold (MAD over 28 on 64x64 luma) against real shop lighting.
- Wi-Fi loss/recovery, changing networks, and `NEHotspotConfiguration` behavior on open or already associated networks.
- Background URLSession uploads, relaunch handling, and the BGProcessingTask for retries.
- Exposure and white balance lock after framing.
- Screen brightness at 0.0 stays legible up close on the actual panel.

## TestFlight

The app ships to the existing App Store Connect record `com.contentstation.station` (app id 6793229212). Bump `CURRENT_PROJECT_VERSION` in `project.yml` above the last TestFlight build, then:

```bash
cd wall-app && xcodegen generate
# App Store Connect API key. Keep the .p8 out of the repo.
KID=$ASC_KEY_ID; ISS=$ASC_ISSUER_ID; KEY=~/.appstoreconnect/private_keys/AuthKey_$KID.p8
xcodebuild archive -project ContentStationWall.xcodeproj -scheme ContentStationWall -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build-device/ContentStationWall.xcarchive \
  -allowProvisioningUpdates -authenticationKeyPath "$KEY" -authenticationKeyID "$KID" -authenticationKeyIssuerID "$ISS"
xcodebuild -exportArchive -archivePath build-device/ContentStationWall.xcarchive -exportOptionsPlist ExportOptions.plist \
  -exportPath build-device/export -allowProvisioningUpdates -authenticationKeyPath "$KEY" -authenticationKeyID "$KID" -authenticationKeyIssuerID "$ISS"
xcrun altool --upload-app -f build-device/export/ContentStationWall.ipa -t ios --apiKey "$KID" --apiIssuer "$ISS"
```

`ExportOptions.plist` is method `app-store-connect`, team `HP284BJ924`, automatic signing, upload symbols. Processing takes 5 to 15 minutes, then the internal group gets the build.

## Reliability regressions

Run `Tests/run.sh` for pure Swift policy regressions. Saved reference identity comes only from optional `reference_frame_revision`, never a renewed signed URL. Older servers without a revision cannot signal a save by URL; framing still expires normally.

Queue entries carry the device ID captured when recording starts. Legacy files and unknown crash-orphan files are quarantined, as are entries from another pairing. Same-pairing persisted queue entries resume. Quarantined media remains subject to normal raw retention cleanup; it is never adopted under a new token.

For simulator integration use a Debug build with `CS_API_BASE_URL=http://localhost:4310`. Debug permits local-network HTTP only (`NSAllowsLocalNetworking`); Release keeps ATS defaults. Use a local hostname for physical-device Debug testing. No broad arbitrary-load exception is enabled.
