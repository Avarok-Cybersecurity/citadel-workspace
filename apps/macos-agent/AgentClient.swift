import Foundation

/// Reads the accounts on this Mac from the agent, over its own WebSocket control plane.
///
/// Two requests, both read-only and neither returning a secret: GetAccountInformation (every
/// account the agent stores, connected or not) and GetSessions (the ones with a live session).
/// Never LocalDBGetKV: the UI keeps remembered passwords there, and this reads nothing it does not
/// show.
///
/// The agent pushes nothing to a connection that owns no session, so this is polled: when the panel
/// opens, then every few seconds while it is open (Tray).
final class AgentClient {
    private let url: URL
    /// One serial queue for the socket's callbacks and the timeout, so they never race.
    private let queue = DispatchQueue(label: "net.avarok.citadel-agent.client")
    private lazy var session: URLSession = {
        let ops = OperationQueue()
        ops.underlyingQueue = queue
        ops.maxConcurrentOperationCount = 1
        return URLSession(configuration: .ephemeral, delegate: nil, delegateQueue: ops)
    }()

    /// wss://local.avarok.net:<port>/ -- the name the agent's certificate is for; it resolves to
    /// loopback.
    init(port: UInt16) {
        url = URL(string: "wss://local.avarok.net:\(port)/")!
    }

    /// Calls `done` on the main queue with the accounts, or nil when the agent could not be asked.
    func fetch(_ done: @escaping ([Account]?) -> Void) {
        let task = session.webSocketTask(with: url)
        task.maximumMessageSize = 4 * 1024 * 1024
        var accounts: [UInt64: (username: String, fullName: String)]?
        var connected: Set<UInt64>?
        var finished = false
        func finish(_ result: [Account]?) {
            guard !finished else { return }
            finished = true
            task.cancel(with: .normalClosure, reason: nil)
            DispatchQueue.main.async { done(result) }
        }
        func receive() {
            task.receive { result in
                guard case .success(let message) = result, let reply = AgentClient.decode(message) else {
                    finish(nil); return
                }
                switch reply {
                case .accepted:
                    AgentClient.send(task, "GetAccountInformation", ["cid": NSNull()])
                    AgentClient.send(task, "GetSessions", [:])
                case .accounts(let a): accounts = a
                case .sessions(let s): connected = s
                case .other: break
                }
                if let accounts, let connected {
                    finish(accounts.map { cid, a in
                        Account(cid: cid, username: a.username, fullName: a.fullName, workspaceHost: nil, connected: connected.contains(cid))
                    })
                } else {
                    receive()
                }
            }
        }
        queue.async {
            task.resume()
            receive()
        }
        queue.asyncAfter(deadline: .now() + 5) { finish(nil) }
    }

    private enum Reply {
        case accepted
        case accounts([UInt64: (username: String, fullName: String)])
        case sessions(Set<UInt64>)
        case other
    }

    /// `{"Request":{"<Variant>":{"request_id":"<uuid>", ...}}}`: serde's externally tagged form.
    private static func send(_ task: URLSessionWebSocketTask, _ variant: String, _ fields: [String: Any]) {
        var body = fields
        body["request_id"] = UUID().uuidString.lowercased()
        guard let data = try? JSONSerialization.data(withJSONObject: ["Request": [variant: body]]),
              let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    /// Only the three replies this asks for. Cids are JSON numbers in values and strings as map keys.
    private static func decode(_ message: URLSessionWebSocketTask.Message) -> Reply? {
        let data: Data
        switch message {
        case .string(let s): data = Data(s.utf8)
        case .data(let d): data = d
        @unknown default: return nil
        }
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let response = root["Response"] as? [String: Any],
              let (variant, value) = response.first else { return nil }
        let body = value as? [String: Any] ?? [:]
        switch variant {
        case "ServiceConnectionAccepted":
            return .accepted
        case "GetAccountInformationResponse":
            let map = body["accounts"] as? [String: Any] ?? [:]
            var out: [UInt64: (username: String, fullName: String)] = [:]
            for (key, entry) in map {
                guard let cid = UInt64(key), let e = entry as? [String: Any], let name = e["username"] as? String else { continue }
                out[cid] = (name, e["full_name"] as? String ?? "")
            }
            return .accounts(out)
        case "GetSessionsResponse":
            let list = body["sessions"] as? [[String: Any]] ?? []
            return .sessions(Set(list.compactMap { ($0["cid"] as? NSNumber)?.uint64Value }))
        default:
            return .other
        }
    }
}
