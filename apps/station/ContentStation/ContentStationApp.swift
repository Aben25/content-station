import SwiftUI

@main
struct ContentStationApp: App {
    @StateObject private var camera = CameraController()
    @StateObject private var uploader = UploadQueue()
    @StateObject private var config = StationConfig.shared

    var body: some Scene {
        WindowGroup {
            StationView()
                .environmentObject(camera)
                .environmentObject(uploader)
                .environmentObject(config)
                .preferredColorScheme(.dark)
        }
    }
}
