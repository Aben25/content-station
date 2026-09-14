import BackgroundTasks
import UIKit

/// Handles background URLSession wakeups and the maintenance task.
final class AppDelegate: NSObject, UIApplicationDelegate {
    static let maintenanceTaskIdentifier = "ai.contentstation.wall.maintenance"

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UIDevice.current.isBatteryMonitoringEnabled = true
        BGTaskScheduler.shared.register(forTaskWithIdentifier: AppDelegate.maintenanceTaskIdentifier, using: nil) { task in
            AppDelegate.runMaintenance(task)
        }
        AppDelegate.scheduleMaintenance()
        return true
    }

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        Task { @MainActor in
            AppCoordinator.shared.uploads.backgroundCompletionHandler = completionHandler
        }
    }

    static func scheduleMaintenance() {
        let request = BGProcessingTaskRequest(identifier: maintenanceTaskIdentifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        request.earliestBeginDate = Date().addingTimeInterval(15 * 60)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            Log.app.info("maintenance task not scheduled: \(error.localizedDescription, privacy: .public)")
        }
    }

    private static func runMaintenance(_ task: BGTask) {
        scheduleMaintenance()
        task.expirationHandler = {
            task.setTaskCompleted(success: false)
        }
        Task { @MainActor in
            AppCoordinator.shared.runMaintenance()
            try? await Task.sleep(nanoseconds: 20 * 1_000_000_000)
            task.setTaskCompleted(success: true)
        }
    }
}
