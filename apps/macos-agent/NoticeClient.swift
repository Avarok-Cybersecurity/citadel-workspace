import Foundation

/// One notice the agent decided to raise (agent kernel/notices). The text is already what the
/// account's preview setting allows; the target names the account, its server and what to open,
/// never any content.
struct Notice {
    let cid: UInt64
    let kind: String
    let title: String
    let body: String
    let account: String
    let serverHost: String?
    let open: String
}

/// What the agent says about one signed-in account, for its row in the panel.
struct NoticeRow: Equatable {
    let unread: Int
    let muted: Bool
}

/// The agent's notice plane: one long-lived socket, subscribed with the token this app put in the
/// agent's environment when it started it. Only that token opens it, because one subscriber hears
/// every account on this Mac. The token is held in memory and never written anywhere.
final class NoticeClient {
    private let url: URL
    private let log: LogFile
    private let queue = DispatchQueue(label: "net.avarok.citadel-agent.notices")
    private lazy var session: URLSession = {
        let ops = OperationQueue()
        ops.underlyingQueue = queue
        ops.maxConcurrentOperationCount = 1
        return URLSession(configuration: .ephemeral, delegate: nil, delegateQueue: ops)
    }()
    private var task: URLSessionWebSocketTask?
    private var token: String?
    var onNotice: ((Notice) -> Void)?
    var onRows: (([UInt64: NoticeRow]) -> Void)?
    /// A newer agent release (agent kernel/updates), from its announcement or a status answer.
    var onUpdate: ((AgentUpdate) -> Void)?
    /// The agent hands this app the verified disk image to install.
    var onInstall: ((_ image: URL, _ version: String) -> Void)?
    /// An install that failed, for whichever agent runs next: it is the one still installed.
    private var pendingReport: [String: Any]?

    init(port: UInt16, log: LogFile) {
        url = URL(string: "wss://local.avarok.net:\(port)/")!
        self.log = log
    }

    /// Subscribe with `token`; a new agent brings a new token, so this replaces any subscription.
    func start(token: String) {
        queue.async {
            self.task?.cancel(with: .normalClosure, reason: nil)
            self.token = token
            self.connect()
        }
    }

    func stop() {
        queue.async {
            self.token = nil
            self.task?.cancel(with: .normalClosure, reason: nil)
            self.task = nil
        }
    }

    func setMuted(_ cid: UInt64, _ muted: Bool) {
        queue.async {
            guard let task = self.task, let token = self.token else { return }
            NoticeClient.send(task, "NoticeSetMuted", ["token": token, "cid": NSNumber(value: cid), "muted": muted])
        }
    }

    /// "Restart to update": the agent hands the verified image back through `onInstall`.
    func applyUpdate() {
        queue.async { if let task = self.task { NoticeClient.send(task, "UpdateApply", [:]) } }
    }

    func reportInstall(version: String, error: String) {
        queue.async {
            self.pendingReport = ["version": version, "error": error]
            if let task = self.task, let token = self.token { self.flushReport(task, token) }
        }
    }

    private func flushReport(_ task: URLSessionWebSocketTask, _ token: String) {
        guard var report = pendingReport else { return }
        pendingReport = nil
        report["token"] = token
        NoticeClient.send(task, "UpdateInstallResult", report)
    }

    private func connect() {
        guard let token else { return }
        let task = session.webSocketTask(with: url)
        task.maximumMessageSize = 4 * 1024 * 1024
        self.task = task
        task.resume()
        receive(task, token)
    }

    private func receive(_ task: URLSessionWebSocketTask, _ token: String) {
        task.receive { [weak self] result in
            guard let self, self.task === task else { return }
            guard case .success(let message) = result, let (variant, body) = NoticeClient.decode(message) else {
                // The socket ended while this agent still runs: subscribe again, once a second at most.
                self.log.write("notice stream ended; subscribing again")
                self.queue.asyncAfter(deadline: .now() + 1) { if self.task === task { self.connect() } }
                return
            }
            switch variant {
            case "ServiceConnectionAccepted":
                NoticeClient.send(task, "NoticeSubscribe", ["token": token])
                NoticeClient.send(task, "UpdateGetStatus", [:])
                self.flushReport(task, token)
            case "UpdateAvailable":
                if let update = AgentUpdate(body) { DispatchQueue.main.async { self.onUpdate?(update) } }
            case "UpdateStatus":
                if let update = (body["available"] as? [String: Any]).flatMap(AgentUpdate.init) {
                    DispatchQueue.main.async { self.onUpdate?(update) }
                }
            case "UpdateInstall":
                if let path = body["path"] as? String, let version = body["version"] as? String {
                    DispatchQueue.main.async { self.onInstall?(URL(fileURLWithPath: path), version) }
                }
            case "NativeNotice":
                if let notice = NoticeClient.notice(body) { DispatchQueue.main.async { self.onNotice?(notice) } }
            case "NoticeRows":
                let rows = NoticeClient.rows(body)
                DispatchQueue.main.async { self.onRows?(rows) }
            case "NoticeFailure":
                self.log.write("the agent refused the notice stream: \(body["message"] as? String ?? "no reason")")
            default:
                break
            }
            self.receive(task, token)
        }
    }

    /// `{"Request":{"<Variant>":{"request_id":"<uuid>", ...}}}`: serde's externally tagged form.
    private static func send(_ task: URLSessionWebSocketTask, _ variant: String, _ fields: [String: Any]) {
        var body = fields
        body["request_id"] = UUID().uuidString.lowercased()
        guard let data = try? JSONSerialization.data(withJSONObject: ["Request": [variant: body]]),
              let text = String(data: data, encoding: .utf8) else { return }
        task.send(.string(text)) { _ in }
    }

    private static func decode(_ message: URLSessionWebSocketTask.Message) -> (String, [String: Any])? {
        let data: Data
        switch message {
        case .string(let s): data = Data(s.utf8)
        case .data(let d): data = d
        @unknown default: return nil
        }
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let response = root["Response"] as? [String: Any],
              let (variant, value) = response.first else { return nil }
        return (variant, value as? [String: Any] ?? [:])
    }

    private static func notice(_ body: [String: Any]) -> Notice? {
        guard let cid = (body["cid"] as? NSNumber)?.uint64Value,
              let kind = body["kind"] as? String,
              let title = body["title"] as? String,
              let text = body["body"] as? String,
              let target = body["target"] as? [String: Any],
              let account = target["account"] as? String,
              let open = target["open"] as? String else { return nil }
        let host = (target["server_host"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return Notice(cid: cid, kind: kind, title: title, body: text, account: account, serverHost: host, open: open)
    }

    private static func rows(_ body: [String: Any]) -> [UInt64: NoticeRow] {
        var out: [UInt64: NoticeRow] = [:]
        for row in body["rows"] as? [[String: Any]] ?? [] {
            guard let cid = (row["cid"] as? NSNumber)?.uint64Value else { continue }
            out[cid] = NoticeRow(unread: (row["unread"] as? NSNumber)?.intValue ?? 0, muted: row["muted"] as? Bool ?? false)
        }
        return out
    }
}

extension AgentUpdate {
    /// From the agent's `UpdateAvailable`; nil for anything malformed or not on GitHub.
    init?(_ body: [String: Any]) {
        guard let current = body["current"] as? String, let latest = body["latest"] as? String,
              let notes = (body["notes_url"] as? String).flatMap(URL.init(string:)),
              let download = (body["download_url"] as? String).flatMap(URL.init(string:)),
              let ready = body["ready"] as? Bool,
              [notes, download].allSatisfy({ $0.scheme == "https" && $0.host == "github.com" }) else { return nil }
        self.init(current: current, latest: latest, notesURL: notes, downloadURL: download, ready: ready)
    }
}
