import SwiftUI

@main
struct ContentStationApp: App {
    @StateObject private var camera = CameraController()
    @StateObject private var uploader = UploadQueue()
    @StateObject private var config = StationConfig.shared
    @StateObject private var kiosk = KioskMode()
    @StateObject private var scheduler = CaptureScheduler()
    @StateObject private var health = DeviceHealth()

    var body: some Scene {
        WindowGroup {
            StationView()
                .environmentObject(camera)
                .environmentObject(uploader)
                .environmentObject(config)
                .environmentObject(kiosk)
                .environmentObject(scheduler)
                .environmentObject(health)
                .preferredColorScheme(.dark)
                .task {
                    scheduler.onFire = { [camera] in camera.captureNow() }
                    scheduler.captureBlocked = { [health] in
                        health.refresh()
                        return health.current.captureBlocked
                    }
                    kiosk.onHeartbeat = { [camera, uploader, config, health, scheduler] in
                        camera.restartIfNeeded()
                        uploader.kick()
                        health.refresh()
                        let snap = health.current
                        Task {
                            await config.refreshAuthAndPing(.init(
                                batteryPercent: snap.batteryLevel >= 0 ? Int(snap.batteryLevel * 100) : nil,
                                isCharging: snap.isCharging,
                                freeDiskMB: Int(snap.freeDiskBytes / (1024 * 1024)),
                                pendingUploads: uploader.pendingCount,
                                isCapturing: scheduler.isRunning,
                                intervalMinutes: scheduler.intervalMinutes,
                                blocked: snap.captureBlocked ?? snap.warning
                            ))
                        }
                    }
                    kiosk.start()
                }
        }
    }
}
