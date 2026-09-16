import Foundation

enum ApiError: Error, CustomStringConvertible {
    case notConfigured
    case unauthorized
    case server(code: String, message: String, status: Int)
    case transport(Error)
    case badResponse(Int)
    case decoding(Error)

    var description: String {
        switch self {
        case .notConfigured: return "api base url missing"
        case .unauthorized: return "unauthorized"
        case .server(let code, let message, let status): return "\(status) \(code): \(message)"
        case .transport(let error): return "transport: \(error.localizedDescription)"
        case .badResponse(let status): return "bad response \(status)"
        case .decoding(let error): return "decoding: \(error.localizedDescription)"
        }
    }

    /// True when the failure means the network is down rather than the
    /// server rejecting the request.
    var isConnectivityFailure: Bool {
        switch self {
        case .transport: return true
        case .badResponse(let status): return status >= 500
        case .server(_, _, let status): return status >= 500
        case .notConfigured, .unauthorized, .decoding: return false
        }
    }
}

struct EmptyResponse: Decodable {}

/// All device routes from the Firebase contract. Reads the base URL from
/// Config.plist first, then Info.plist. Never logs the JWT, pair token, or
/// Wi-Fi password.
final class ApiClient {
    let baseURL: URL?
    let isMock: Bool

    /// Supplies the current device JWT for authenticated routes.
    var deviceJWT: () -> String? = { Keychain.string(for: .deviceJWT) }

    private let session: URLSession
    private let mock = MockApi()

    init(mock: Bool = LaunchArguments.mockApi) {
        baseURL = ApiClient.loadBaseURL().flatMap(URL.init(string:))
        isMock = mock
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 40
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration)
        if mock {
            Log.network.info("api running in mock mode")
        } else if baseURL == nil {
            Log.network.error("api base url not set, see README")
        }
    }

    var isConfigured: Bool { isMock || (baseURL != nil) }

    // MARK: Routes

    /// Fire and forget. Tells the owner app the QR was read.
    func pairReading(token: String) async {
        let body = PairReadingRequest(pairToken: token)
        _ = try? await send("POST", "/pair/reading", jsonBody: body, auth: false, as: OkResponse.self)
    }

    func pairClaim(_ request: PairClaimRequest) async throws -> PairClaimResponse {
        try await send("POST", "/pair/claim", jsonBody: request, auth: false, as: PairClaimResponse.self)
    }

    func heartbeat(_ request: HeartbeatRequest) async throws -> DeviceConfig {
        try await send("POST", "/device/heartbeat", jsonBody: request, as: DeviceConfig.self)
    }

    func config(since: String?, wait: Int) async throws -> DeviceConfig {
        var query: [URLQueryItem] = [URLQueryItem(name: "wait", value: String(max(0, min(25, wait))))]
        if let since { query.append(URLQueryItem(name: "since", value: since)) }
        return try await send("GET", "/device/config", query: query, timeout: TimeInterval(wait + 15), as: DeviceConfig.self)
    }

    func status(_ status: String, code: String?) async throws {
        _ = try await send("POST", "/device/status", jsonBody: StatusRequest(status: status, code: code), as: OkResponse.self)
    }

    func segmentUploadUrl(startTs: String, endTs: String, token: String) async throws -> UploadUrlResponse {
        try await send("POST", "/device/segment/upload-url", jsonBody: UploadUrlRequest(startTs: startTs, endTs: endTs), token: token, as: UploadUrlResponse.self)
    }

    func segmentComplete(_ request: SegmentCompleteRequest, token: String) async throws -> SegmentCompleteResponse {
        try await send("POST", "/device/segment/complete", jsonBody: request, token: token, as: SegmentCompleteResponse.self)
    }

    func preview(jpeg: Data, token: String) async throws {
        _ = try await send("POST", "/device/preview", rawBody: (jpeg, "image/jpeg"), token: token, as: EmptyResponse.self)
    }

    func thumb(jpeg: Data, token: String) async throws {
        _ = try await send("POST", "/device/thumb", rawBody: (jpeg, "image/jpeg"), token: token, as: EmptyResponse.self)
    }

    func cancelOutstandingRequests() {
        session.getAllTasks { tasks in tasks.forEach { $0.cancel() } }
    }

    // MARK: Core

    private func send<T: Decodable>(
        _ method: String,
        _ path: String,
        query: [URLQueryItem] = [],
        jsonBody: Encodable? = nil,
        rawBody: (Data, String)? = nil,
        auth: Bool = true,
        timeout: TimeInterval = 30,
        token: String? = nil,
        as type: T.Type
    ) async throws -> T {
        if isMock {
            return try await mock.respond(method: method, path: path, query: query, as: type)
        }
        guard let baseURL else { throw ApiError.notConfigured }
        guard var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw ApiError.notConfigured
        }
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw ApiError.notConfigured }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if auth {
            guard let jwt = token ?? deviceJWT(), !jwt.isEmpty else { throw ApiError.unauthorized }
            request.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        }
        if let jsonBody {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(AnyEncodable(jsonBody))
        } else if let rawBody {
            request.setValue(rawBody.1, forHTTPHeaderField: "Content-Type")
            request.httpBody = rawBody.0
        }

        try Task.checkCancellation()
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            Log.network.error("\(method, privacy: .public) \(path, privacy: .public) transport error")
            throw ApiError.transport(error)
        }
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else { throw ApiError.badResponse(0) }
        Log.network.debug("\(method, privacy: .public) \(path, privacy: .public) -> \(http.statusCode, privacy: .public)")

        if http.statusCode == 401 { throw ApiError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            if let envelope = try? JSONDecoder().decode(ApiErrorEnvelope.self, from: data) {
                throw ApiError.server(code: envelope.error.code, message: envelope.error.message, status: http.statusCode)
            }
            throw ApiError.badResponse(http.statusCode)
        }
        if T.self == EmptyResponse.self || data.isEmpty {
            if let empty = EmptyResponse() as? T { return empty }
            if let ok = OkResponse(ok: true) as? T { return ok }
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw ApiError.decoding(error)
        }
    }

    private static func loadBaseURL() -> String? {
        var baseURL: String?
        if let url = Bundle.main.url(forResource: "Config", withExtension: "plist"),
           let dictionary = NSDictionary(contentsOf: url) as? [String: Any] {
            if let value = dictionary["CS_API_BASE_URL"] as? String, !value.isEmpty { baseURL = value }
        }
        let info = Bundle.main.infoDictionary ?? [:]
        if baseURL == nil, let value = info["CS_API_BASE_URL"] as? String, !value.isEmpty, !value.contains("YOUR-PROJECT") {
            baseURL = value
        }
        return baseURL
    }
}

/// Wraps any Encodable so it can be passed through a generic function.
struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init(_ value: Encodable) {
        encodeClosure = { encoder in try value.encode(to: encoder) }
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}

/// Canned responses for `-CS_MOCK_API 1`. Keeps a little state so pairing
/// and config behave like a real backend.
final class MockApi {
    private let lock = NSLock()
    private var updatedAt = TimeFormat.iso8601(Date())

    func respond<T: Decodable>(method: String, path: String, query: [URLQueryItem], as type: T.Type) async throws -> T {
        try await Task.sleep(nanoseconds: 200_000_000)
        let now = Date()
        let json: [String: Any]
        switch (method, path) {
        case ("POST", "/pair/reading"), ("POST", "/device/status"):
            json = ["ok": true]
        case ("POST", "/pair/claim"):
            json = [
                "device_jwt": "mock-device-jwt",
                "device_id": "00000000-0000-4000-8000-000000000001",
                "shop": ["id": "shop-1", "name": "Fade Society", "type": "barbershop", "workstation": "chair 1"],
                "config": configJSON(now: now, framing: true),
            ]
        case ("POST", "/device/heartbeat"):
            json = configJSON(now: now, framing: false)
        case ("GET", "/device/config"):
            let wait = Int(query.first(where: { $0.name == "wait" })?.value ?? "0") ?? 0
            try await Task.sleep(nanoseconds: UInt64(max(0, min(25, wait))) * 1_000_000_000)
            json = configJSON(now: now, framing: false)
        case ("POST", "/device/segment/upload-url"):
            json = [
                "path": "segments/shop-1/device-1/\(Int(now.timeIntervalSince1970 * 1000)).mp4",
                "upload_url": "https://example.invalid/upload",
                "expires_at": TimeFormat.iso8601(now.addingTimeInterval(3600)),
            ]
        case ("POST", "/device/segment/complete"):
            json = ["segment_id": "seg-1", "job_id": "job-1"]
        case ("POST", "/device/preview"), ("POST", "/device/thumb"):
            if let empty = EmptyResponse() as? T { return empty }
            json = [:]
        default:
            throw ApiError.badResponse(404)
        }
        let data = try JSONSerialization.data(withJSONObject: json)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func configJSON(now: Date, framing: Bool) -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        return [
            "server_time": TimeFormat.iso8601(now),
            "updated_at": updatedAt,
            "hours": [
                "mon": ["open": "09:00", "close": "19:00"],
                "tue": ["open": "09:00", "close": "19:00"],
                "wed": ["open": "09:00", "close": "19:00"],
                "thu": ["open": "09:00", "close": "19:00"],
                "fri": ["open": "09:00", "close": "19:00"],
                "sat": ["open": "09:00", "close": "19:00"],
                "sun": NSNull(),
            ],
            "hours_confirmed": false,
            "timezone": TimeZone.current.identifier,
            "paused_until": NSNull(),
            "pause_mode": "none",
            "framing_until": framing ? TimeFormat.iso8601(now.addingTimeInterval(20)) : NSNull(),
            "reference_frame_url": NSNull(),
            "unpaired": false,
            "workstation": "chair 1",
        ]
    }
}
