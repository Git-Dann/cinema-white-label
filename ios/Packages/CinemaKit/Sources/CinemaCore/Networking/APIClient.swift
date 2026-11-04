import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Stable error codes from the backend (see backend/src/common/errors.ts).
public struct APIError: Error, Sendable, Hashable, LocalizedError {
    public enum Code: String, Sendable {
        case seatsUnavailable = "seats_unavailable"
        case holdExpired = "hold_expired"
        case holdNotActive = "hold_not_active"
        case screeningClosed = "screening_closed"
        case seatRules = "seat_rules"
        case paymentDeclined = "payment_declined"
        case validationFailed = "validation_failed"
        case notFound = "not_found"
        case unauthorised
        case forbidden
        case notModified = "not_modified"
        case network
        case decoding
        case unknown
    }

    public let status: Int
    public let code: Code
    public let rawCode: String
    public let message: String
    /// Seat ids attached to seat conflicts and rule violations.
    public let seatIds: [String]
    public let violations: [RuleMessage]

    public var errorDescription: String? { message }

    public init(status: Int, code: Code, rawCode: String? = nil, message: String, seatIds: [String] = [], violations: [RuleMessage] = []) {
        self.status = status; self.code = code; self.rawCode = rawCode ?? code.rawValue; self.message = message
        self.seatIds = seatIds; self.violations = violations
    }

    static func from(status: Int, data: Data) -> APIError {
        struct Envelope: Decodable {
            struct Body: Decodable {
                struct Details: Decodable { var seatIds: [String]?; var violations: [RuleMessage]? }
                var code: String; var message: String; var details: Details?
            }
            var error: Body
        }
        guard let env = try? JSONDecoder().decode(Envelope.self, from: data) else {
            return APIError(status: status, code: status == 401 ? .unauthorised : .unknown, message: "Something went wrong (\(status))")
        }
        return APIError(
            status: status,
            code: Code(rawValue: env.error.code) ?? .unknown,
            rawCode: env.error.code,
            message: env.error.message,
            seatIds: env.error.details?.seatIds ?? env.error.details?.violations?.flatMap(\.seatIds) ?? [],
            violations: env.error.details?.violations ?? []
        )
    }
}

/// Supplies the bearer token for customer requests (Keychain-backed on device).
public protocol TokenProvider: Sendable {
    func token() async throws -> String
    func invalidate() async
}

/// Thin, testable HTTP layer over URLSession. Views never call this directly;
/// feature models do.
public final class APIClient: Sendable {
    public let baseURL: URL
    public let tenantSlug: String
    private let session: URLSession
    private let tokens: (any TokenProvider)?

    public static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { dec in
            let s = try dec.singleValueContainer().decode(String.self)
            if let date = ISO8601.parse(s) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: dec.codingPath, debugDescription: "Invalid date \(s)"))
        }
        return d
    }()

    public init(baseURL: URL, tenantSlug: String, session: URLSession = .shared, tokens: (any TokenProvider)? = nil) {
        self.baseURL = baseURL
        self.tenantSlug = tenantSlug
        self.session = session
        self.tokens = tokens
    }

    public func tenantURL(_ path: String) -> URL {
        URL(string: "v1/t/\(tenantSlug)\(path)", relativeTo: baseURL)!.absoluteURL
    }

    public struct Response<T: Sendable>: Sendable { public let value: T?; public let etag: String? }

    public func send<T: Decodable & Sendable>(
        _ method: String,
        _ path: String,
        body: (any Encodable & Sendable)? = nil,
        authenticated: Bool = false,
        idempotencyKey: String? = nil,
        ifNoneMatch: String? = nil,
        as: T.Type = T.self
    ) async throws -> Response<T> {
        var request = URLRequest(url: tenantURL(path))
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        if let idempotencyKey { request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key") }
        if let ifNoneMatch { request.setValue(ifNoneMatch, forHTTPHeaderField: "If-None-Match") }
        if authenticated, let tokens { request.setValue("Bearer \(try await tokens.token())", forHTTPHeaderField: "Authorization") }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError(status: 0, code: .network, message: "You appear to be offline. Check your connection and try again.")
        }
        guard let http = response as? HTTPURLResponse else { throw APIError(status: 0, code: .network, message: "No response") }
        let etag = http.value(forHTTPHeaderField: "ETag")
        if http.statusCode == 304 { return Response(value: nil, etag: etag) }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401, authenticated { await tokens?.invalidate() }
            throw APIError.from(status: http.statusCode, data: data)
        }
        if T.self == EmptyResponse.self || data.isEmpty { return Response(value: EmptyResponse() as? T, etag: etag) }
        do {
            return Response(value: try Self.decoder.decode(T.self, from: data), etag: etag)
        } catch {
            throw APIError(status: http.statusCode, code: .decoding, message: "Unexpected response from the server")
        }
    }

    public func get<T: Decodable & Sendable>(_ path: String, authenticated: Bool = false, as type: T.Type = T.self) async throws -> T {
        guard let v = try await send("GET", path, authenticated: authenticated, as: type).value else { throw APIError(status: 304, code: .notModified, message: "Not modified") }
        return v
    }
}

public struct EmptyResponse: Codable, Sendable, Hashable { public init() {} }

enum ISO8601 {
    nonisolated(unsafe) private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    nonisolated(unsafe) private static let plain = ISO8601DateFormatter()
    private static let lock = NSLock()
    static func parse(_ s: String) -> Date? {
        lock.lock(); defer { lock.unlock() }
        return fractional.date(from: s) ?? plain.date(from: s)
    }
}
