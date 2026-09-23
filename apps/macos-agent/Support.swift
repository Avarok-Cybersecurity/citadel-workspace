import Foundation

/// What the launcher runs, read from Info.plist, where the build writes it. Every key is required:
/// a missing one stops the app with a message rather than guessing an origin or a port.
struct AgentSettings {
    let workspaceURL: URL
    let bindHost: String
    let bindPort: UInt16
    let dataDirectory: URL
    /// Exactly three `host:port` STUN servers, as the agent's --stun-servers takes them.
    let stunServers: String

    init(bundle: Bundle) throws {
        func string(_ key: String) throws -> String {
            guard let v = bundle.object(forInfoDictionaryKey: key) as? String, !v.isEmpty else {
                throw SettingsError.missing(key)
            }
            return v
        }
        let origin = try string("CitadelWorkspaceOrigin")
        guard let url = URL(string: origin), url.scheme == "https", url.host != nil, url.path.isEmpty else {
            throw SettingsError.invalid("CitadelWorkspaceOrigin", origin)
        }
        let bind = try string("CitadelAgentBind")
        let parts = bind.split(separator: ":")
        guard parts.count == 2, let port = UInt16(parts[1]), parts[0] == "127.0.0.1" else {
            // Loopback only: the agent holds decrypted messages and an unauthenticated control plane.
            throw SettingsError.invalid("CitadelAgentBind", bind)
        }
        workspaceURL = url
        bindHost = String(parts[0])
        bindPort = port
        dataDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(try string("CitadelAgentDataDirectoryName"), isDirectory: true)
        stunServers = try string("CitadelAgentStunServers")
    }

    /// The same flags the README gives a terminal user, spelled out rather than left to defaults.
    var arguments: [String] {
        ["--bind", "\(bindHost):\(bindPort)",
         "--backend", "filesystem",
         "--data-dir", dataDirectory.path,
         "--allowed-origins", workspaceURL.absoluteString,
         "--stun-servers", stunServers]
    }
}

enum SettingsError: Error, CustomStringConvertible {
    case missing(String)
    case invalid(String, String)
    var description: String {
        switch self {
        case .missing(let k): return "Info.plist has no \(k)"
        case .invalid(let k, let v): return "Info.plist's \(k) is not usable: \(v)"
        }
    }
}

/// ~/Library/Logs/Citadel Agent/agent.log: where Console.app looks, and where "Show Log" opens.
final class LogFile {
    let url: URL
    let handle: FileHandle
    /// Beyond this the log starts over at launch; a crash loop left alone must not fill a disk.
    private static let limit: UInt64 = 10 * 1024 * 1024

    init() throws {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/Citadel Agent", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        url = dir.appendingPathComponent("agent.log")
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? UInt64) ?? 0
        if size > Self.limit || !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil)
        }
        handle = try FileHandle(forWritingTo: url)
        handle.seekToEndOfFile()
    }

    func write(_ line: String) {
        let stamp = ISO8601DateFormatter().string(from: Date())
        handle.write(Data("[launcher \(stamp)] \(line)\n".utf8))
    }
}

enum PortProbe {
    /// Whether something accepts a TCP connection on host:port right now.
    static func isListening(host: String, port: UInt16) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        guard inet_pton(AF_INET, host, &addr.sin_addr) == 1 else { return false }
        let result = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        return result == 0
    }
}
