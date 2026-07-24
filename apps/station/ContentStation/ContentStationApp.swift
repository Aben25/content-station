import SwiftUI

@main
struct ContentStationApp: App {
    @StateObject private var camera = CameraController()
    @StateObject private var uploader = UploadQueue()
    @StateObject private var config = StationConfig.shared
    @StateObject private var kiosk = KioskMode()

    var body: some Scene {
        WindowGroup {
            StationView()
                .environmentObject(camera)
                .environmentObject(uploader)
                .environmentObject(config)
                .environmentObject(kiosk)
                .preferredColorScheme(.dark)
                .task {
                    kiosk.onHeartbeat = { [camera, uploader, config] in
                        camera.restartIfNeeded()
                        uploader.kick()
                        Task { await config.registerAndRefresh() }
                    }
                    kiosk.start()
                }
        }
    }
}
