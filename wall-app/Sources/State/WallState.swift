import Foundation

/// Every full screen state the wall can show. `idle` is the black screen
/// outside hours and is not a design state.
enum WallState: String, CaseIterable, Equatable {
    case waiting
    case reading
    case connecting
    case framing
    case recording
    case paused
    case nointernet
    case nointernetLong = "nointernet_long"
    case reframe
    case hot
    case fault
    case idle

    /// The status value and code sent to POST /device/status.
    func reported(faultCode: String?) -> (status: String, code: String?) {
        switch self {
        case .nointernetLong: return ("nointernet", "long")
        case .fault: return ("fault", faultCode ?? FaultCode.unknown.rawValue)
        default: return (rawValue, nil)
        }
    }
}

enum FaultCode: String {
    case unknown = "E-31"
    case wifiJoin = "W-01"
    case pairClaim = "P-01"
    case storageFull = "S-01"
    case cameraUnavailable = "C-01"
}

/// The glyph drawn above the text on generic screens.
enum Glyph: Equatable {
    case code
    case dot
    case ring
    case pause
    case off
    case frame
    case hot
    case fault
    case bar
}

/// Dynamic values that fill the copy table.
struct CopyContext: Equatable {
    var shortCode: String = ""
    var ssid: String = ""
    var pausedUntil: String = ""
    var faultCode: String = FaultCode.unknown.rawValue
}

/// What a generic screen shows: glyph, two lines, and the code for waiting.
struct StateCopy: Equatable {
    var glyph: Glyph?
    var line1: String
    var line2: String
    var code: String

    /// The data table from the Wall App design file, with dynamic values
    /// filled from the context.
    static func copy(for state: WallState, context: CopyContext) -> StateCopy {
        switch state {
        case .waiting:
            return StateCopy(
                glyph: .code,
                line1: "Open \(Product.startUrlDisplay) on your phone",
                line2: "Then hold your phone up to the camera",
                code: context.shortCode
            )
        case .reading:
            return StateCopy(glyph: .dot, line1: "Got it.", line2: "You can lower your phone", code: "")
        case .connecting:
            let network = context.ssid.isEmpty ? "Wi-Fi" : "\(context.ssid) Wi-Fi"
            return StateCopy(
                glyph: .bar,
                line1: "Joining \(network)",
                line2: "Then checking in with \(Product.nameLower)",
                code: ""
            )
        case .framing, .recording, .idle:
            return StateCopy(glyph: nil, line1: "", line2: "", code: "")
        case .paused:
            let until = context.pausedUntil.isEmpty ? "you resume" : context.pausedUntil
            return StateCopy(glyph: .pause, line1: "Paused until \(until)", line2: "Resume from your phone", code: "")
        case .nointernet:
            return StateCopy(glyph: .off, line1: "No internet. Buffering.", line2: "Footage is safe on this phone", code: "")
        case .nointernetLong:
            return StateCopy(glyph: .off, line1: "Still no internet.", line2: "Re-scan QR from your phone", code: "")
        case .reframe:
            return StateCopy(glyph: .frame, line1: "Camera moved.", line2: "Check your phone", code: "")
        case .hot:
            return StateCopy(glyph: .hot, line1: "Cooling down. Back soon.", line2: "Footage is safe", code: "")
        case .fault:
            return StateCopy(
                glyph: .fault,
                line1: Product.supportPhoneDisplay.isEmpty ? "Restart the camera app" : "Text us: \(Product.supportPhoneDisplay)",
                line2: "Code \(context.faultCode)",
                code: ""
            )
        }
    }
}
