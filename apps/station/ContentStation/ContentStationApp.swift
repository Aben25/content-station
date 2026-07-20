import SwiftUI

@main
struct ContentStationApp: App {
    @StateObject private var camera = CameraController()
    @StateObject private var uploader = UploadQueue()

    var body: some Scene {
        WindowGroup {
            StationView()
                .environmentObject(camera)
                .environmentObject(uploader)
                .preferredColorScheme(.dark)
        }
    }
}
