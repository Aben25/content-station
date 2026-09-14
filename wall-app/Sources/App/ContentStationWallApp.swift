import SwiftUI
import UIKit

@main
struct ContentStationWallApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var coordinator = AppCoordinator.shared

    var body: some Scene {
        WindowGroup {
            RootView(stateMachine: coordinator.stateMachine, previewSession: coordinator.capture.previewSession)
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                .preferredColorScheme(.dark)
                .onAppear {
                    ContentStationWallApp.applyScreenSettings()
                    coordinator.start()
                }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                ContentStationWallApp.applyScreenSettings()
                coordinator.didBecomeActive()
            }
        }
    }

    /// Keep the screen awake and as dark as the panel allows. The phone
    /// faces the wall, so the screen only needs to be legible up close.
    @MainActor
    static func applyScreenSettings() {
        UIApplication.shared.isIdleTimerDisabled = true
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for scene in scenes {
            scene.screen.brightness = 0.0
        }
    }
}
