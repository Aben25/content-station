import Foundation

/// Launch arguments used to preview screens and run without a backend.
/// `-CS_PREVIEW_STATE recording` forces a display state.
/// `-CS_MOCK_API 1` makes every API call succeed with canned data.
enum LaunchArguments {
    static var previewState: WallState? {
        guard let raw = UserDefaults.standard.string(forKey: "CS_PREVIEW_STATE") else { return nil }
        return WallState(rawValue: raw.trimmingCharacters(in: .whitespaces).lowercased())
    }

    static var mockApi: Bool {
        UserDefaults.standard.bool(forKey: "CS_MOCK_API")
    }
}
