import Foundation

/// Config as returned by claim, heartbeat, and the long poll.
struct DeviceConfig: Codable, Equatable {
    var serverTime: String?
    var updatedAt: String?
    var hours: WeeklyHours?
    var hoursConfirmed: Bool?
    var timezone: String?
    var pausedUntil: String?
    var pauseMode: String?
    var framingUntil: String?
    var referenceFrameUrl: String?
    var referenceFrameRevision: String?
    var unpaired: Bool?
    var workstation: String?

    enum CodingKeys: String, CodingKey {
        case serverTime = "server_time"
        case updatedAt = "updated_at"
        case hours
        case hoursConfirmed = "hours_confirmed"
        case timezone
        case pausedUntil = "paused_until"
        case pauseMode = "pause_mode"
        case framingUntil = "framing_until"
        case referenceFrameUrl = "reference_frame_url"
        case referenceFrameRevision = "reference_frame_revision"
        case unpaired
        case workstation
    }

    func hasNewReference(comparedTo previous: String?) -> Bool {
        guard let revision = referenceFrameRevision, !revision.isEmpty else { return false }
        return revision != previous
    }

    var pausedUntilDate: Date? { pausedUntil.flatMap(TimeFormat.parseISO8601) }
    var framingUntilDate: Date? { framingUntil.flatMap(TimeFormat.parseISO8601) }
    var serverTimeDate: Date? { serverTime.flatMap(TimeFormat.parseISO8601) }
    var isUnpaired: Bool { unpaired ?? false }
    var timeZone: TimeZone { TimeZone(identifier: timezone ?? "") ?? .current }

    /// Paused when pause_mode is anything but none and the pause has not
    /// expired yet.
    func isPaused(at now: Date) -> Bool {
        let mode = pauseMode ?? "none"
        guard mode != "none" else { return false }
        guard let until = pausedUntilDate else { return true }
        return until > now
    }

    func isFraming(at now: Date) -> Bool {
        guard let until = framingUntilDate else { return false }
        return until > now
    }
}

struct PairClaimRequest: Encodable {
    var pairToken: String
    var serial: String
    var model: String
    var appVersion: String

    enum CodingKeys: String, CodingKey {
        case pairToken = "pair_token"
        case serial, model
        case appVersion = "app_version"
    }
}

struct PairReadingRequest: Encodable {
    var pairToken: String

    enum CodingKeys: String, CodingKey {
        case pairToken = "pair_token"
    }
}

struct PairClaimResponse: Decodable {
    struct Shop: Decodable {
        var id: String?
        var name: String?
        var type: String?
        var workstation: String?
    }

    var deviceJwt: String
    var deviceId: String
    var shop: Shop?
    var config: DeviceConfig?

    enum CodingKeys: String, CodingKey {
        case deviceJwt = "device_jwt"
        case deviceId = "device_id"
        case shop, config
    }
}

struct HeartbeatRequest: Encodable {
    var battery: Int
    var thermal: String
    var wifi: String
    var storageFreeMb: Int
    var state: String
    var code: String?
    var appVersion: String
    var recordingSecondsToday: Int

    enum CodingKeys: String, CodingKey {
        case battery, thermal, wifi
        case storageFreeMb = "storage_free_mb"
        case state, code
        case appVersion = "app_version"
        case recordingSecondsToday = "recording_seconds_today"
    }
}

struct StatusRequest: Encodable {
    var status: String
    var code: String?
}

struct OkResponse: Decodable {
    var ok: Bool?
}

struct UploadUrlRequest: Encodable {
    var startTs: String
    var endTs: String

    enum CodingKeys: String, CodingKey {
        case startTs = "start_ts"
        case endTs = "end_ts"
    }
}

struct UploadUrlResponse: Decodable {
    var path: String
    var uploadUrl: String
    var expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case path
        case uploadUrl = "upload_url"
        case expiresAt = "expires_at"
    }
}

struct SegmentCompleteRequest: Encodable {
    var path: String
    var startTs: String
    var endTs: String
    var bytes: Int
    var width: Int
    var height: Int
    var fps: Int

    enum CodingKeys: String, CodingKey {
        case path
        case startTs = "start_ts"
        case endTs = "end_ts"
        case bytes, width, height, fps
    }
}

struct SegmentCompleteResponse: Decodable {
    var segmentId: String?
    var jobId: String?

    enum CodingKeys: String, CodingKey {
        case segmentId = "segment_id"
        case jobId = "job_id"
    }
}

/// The error envelope every route uses.
struct ApiErrorEnvelope: Decodable {
    struct Body: Decodable {
        var code: String
        var message: String
    }
    var error: Body
}

/// Fail closed for legacy media or incomplete credentials.
enum UploadAuthorization {
    static func permits(origin: String?, active: String?, token: String?) -> Bool {
        guard let origin, !origin.isEmpty, let token, !token.isEmpty else { return false }
        return origin == active
    }
}

/// Used on the writer serial queue. Each async encode captures its generation.
struct CaptureGeneration {
    private(set) var current = UUID()
    mutating func advance() { current = UUID() }
    func accepts(_ captured: UUID) -> Bool { captured == current }
}
