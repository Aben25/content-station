import SwiftUI

@main
struct ContentStationApp: App {
    @StateObject private var camera = CameraController()
    @StateObject private var uploader = UploadQueue()
    @StateObject private var config = StationConfig.shared
    @StateObject private var kiosk = KioskMode()
    @StateObject private var scheduler = CaptureScheduler()

    var body: some Scene {
        WindowGroup {
            StationView()
                .environmentObject(camera)
                .environmentObject(uploader)
                .environmentObject(config)
                .environmentObject(kiosk)
                .environmentObject(scheduler)
                .preferredColorScheme(.dark)
                .task {
                    scheduler.onFire = { [camera] in camera.captureNow() }
                    kiosk.onHeartbeat = { [camera, uploader, config] in
                        camera.restartIfNeeded()
                        uploader.kick()
                        Task { await config.refreshAuthAndPing() }
                    }
                    kiosk.start()
                }
        }
    }
}
