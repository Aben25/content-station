# ContentStation wall app

The iOS app that runs on an iPhone mounted permanently on a shop wall. It captures motion gated footage, uploads segments, reports health, and shows one full screen status at a time. Behavior follows `docs/CONTRACT.md` and `docs/handoff/HANDOFF.md`; visuals and copy follow `docs/handoff/design/project/Wall App.dc.html`.

## Generate and build

Requirements: Xcode 26 and XcodeGen (`brew install xcodegen`).

```
cd wall-app
xcodegen generate
xcodebuild -project ContentStationWall.xcodeproj -scheme ContentStationWall \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

`ContentStationWall.xcodeproj` is generated output. Edit `project.yml` and regenerate instead of editing the project in Xcode.

Target: `ContentStationWall`, bundle id `com.contentstation.station`, iOS 17.0, iPhone only, portrait only, SwiftUI lifecycle, Swift 5 language mode.

## API base URL and anon key

The app needs two values: the Edge Function base url (`{SUPABASE_URL}/functions/v1/api`) and the Supabase anon key. It reads them in this order:

1. `Resources/Config.plist`, keys `CS_API_BASE_URL` and `CS_SUPABASE_ANON_KEY`. Empty values are skipped.
2. `Info.plist`, same keys, filled from the build settings in `Config.xcconfig`.

The simplest path is to edit `Config.xcconfig`:

```
CS_API_BASE_URL = https:/$()/abcdefgh.supabase.co/functions/v1/api
CS_SUPABASE_ANON_KEY = eyJhbGciOi...
```

The `$()` after `https:/` keeps xcconfig from reading `//` as a comment. Both values can also be passed on the command line: `xcodebuild ... CS_API_BASE_URL=... CS_SUPABASE_ANON_KEY=...`.

Product strings and timing constants come from `Sources/Generated/Product.swift`, written by `scripts/sync-product.sh` from `product.json`. Never edit it by hand.

## Preview states in the simulator

The simulator has no camera, so the app runs with capture disabled and shows whatever state you ask for. Launch arguments:

- `-CS_PREVIEW_STATE <state>` forces the display state. Values: `waiting reading connecting framing recording paused nointernet nointernet_long reframe hot fault`.
- `-CS_MOCK_API 1` makes every API call succeed with canned responses so pairing and the normal loop can be exercised without a backend.

In Xcode, Product > Scheme > Edit Scheme > Run > Arguments has one disabled entry per state. Tick one and run. From the command line:

```
xcrun simctl launch booted com.contentstation.station -CS_PREVIEW_STATE recording
```

Preview states fill in sample values (short code 4KP7, network "Fade Society", "Paused until 3:00 PM") so the screens match the design file.

## Where things live

- `Sources/App` app entry, root view, and the coordinator that wires everything together.
- `Sources/State` the state enum with the copy table and the state machine with the priority rules.
- `Sources/UI` one view per glyph, the generic screen, recording, framing.
- `Sources/Capture` capture session, motion gate, segment writer, drift detector, thumbnails, preview streaming.
- `Sources/Network` API client, config long poll, heartbeat, upload queue, connectivity.
- `Sources/Pairing` QR payload, Wi-Fi join, pairing flow.
- `Sources/Support` Keychain, device identity, hours, time formatting, thermal, logging.

Segments are written to `Application Support/ContentStationWall/segments`. The upload queue is `uploads.json` next to it, the last Config is `config.json`, the drift reference is `reference.luma`. Credentials live in the Keychain, so a power cut or reinstall resumes without pairing again.

## Device setup checklist (MDM and Single App Mode)

From HANDOFF section 3. Every wall phone must be:

1. iPhone 12 or newer.
2. Supervised through Apple Business Manager, added with Apple Configurator.
3. Enrolled in the MDM (Mosyle, Hexnode, or Miradore, still to be decided) with Single App Mode locked to `com.contentstation.station`. This is what relaunches the app after a power cut or crash.
4. Passcode off.
5. Auto lock off (the app also disables the idle timer and sets brightness to zero on launch and on every return to foreground).
6. iOS automatic updates blocked.
7. Camera permission granted. The app asks on first launch; the MDM profile can pre-approve it.
8. Wi-Fi joins happen through the app during pairing, which needs the `com.apple.developer.networking.HotspotConfiguration` entitlement enabled on the App ID in the developer portal.

## Unverified on real hardware

Everything below compiles and follows the contract, but has only been run in the simulator, which has no camera.

- The full capture path: AVCaptureSession at 1920x1080 30 fps with the frames rotated to portrait, VideoToolbox H.264 encoding, the compressed pre roll ring, and the fragmented MP4 output through `AVAssetWriter` with `movieFragmentInterval`. Confirm a segment written on a phone plays after a forced crash.
- The 720p fallback at thermal serious and the automatic recovery from critical.
- Motion gate thresholds (MAD over 6 on 32x32 luma) and the drift threshold (MAD over 28 on 64x64 luma) against real shop lighting.
- `NEHotspotConfiguration` join, including the already associated case and open networks.
- QR decoding at 6 to 8 feet with `videoZoomFactor` 2.0.
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
