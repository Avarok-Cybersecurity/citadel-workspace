import Foundation

/// Runs the agent binary bundled beside this launcher, and keeps it running.
///
/// The launcher adds nothing to the agent. It passes the arguments the README tells a terminal
/// user to type, restarts the agent when it exits, and stops restarting when it keeps failing
/// straight away, since restarting a crash loop forever only fills the log.
final class AgentProcess {
    enum State: Equatable {
        case starting
        case running
        /// Something else already answers on the agent's port: a terminal-run agent, usually.
        case external
        case failed(String)
    }

    private let executable: URL
    private let arguments: [String]
    private let endpoint: (host: String, port: UInt16)
    private let log: LogFile
    private var process: Process?
    private var quickExits = 0
    private var stopping = false
    var onChange: ((State) -> Void)?
    private(set) var state: State = .starting { didSet { if state != oldValue { onChange?(state) } } }

    /// A run shorter than this counts as failing to start rather than as a crash after work.
    private static let quickExit: TimeInterval = 5
    private static let maxQuickExits = 5

    init(executable: URL, settings: AgentSettings, log: LogFile) {
        self.executable = executable
        self.arguments = settings.arguments
        self.endpoint = (settings.bindHost, settings.bindPort)
        self.log = log
    }

    func start() {
        stopping = false
        if PortProbe.isListening(host: endpoint.host, port: endpoint.port) {
            state = .external
            log.write("an agent is already listening on \(endpoint.host):\(endpoint.port); not starting another")
            // Checked again later: when that agent stops, this one takes over.
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
                guard let self, !self.stopping, self.state == .external else { return }
                self.start()
            }
            return
        }
        launch()
    }

    /// After a failure the user has read about: the crash-loop count starts over.
    func restart() {
        quickExits = 0
        start()
    }

    /// Stops the agent, then calls `done` on the main queue: when it has exited, or after SIGKILL
    /// if it has not within five seconds. Never blocks: `waitUntilExit` inside AppKit's terminate
    /// callout waits on a run loop that cannot deliver the exit, and the app never quits.
    func stop(then done: @escaping () -> Void) {
        stopping = true
        guard let p = process, p.isRunning else { done(); return }
        var finished = false
        let finish = { [log] in
            if !finished { finished = true; log.write("agent stopped"); done() }
        }
        p.terminationHandler = { _ in DispatchQueue.main.async(execute: finish) }
        p.terminate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            if p.isRunning {
                self?.log.write("agent did not stop within 5s; killing it")
                kill(p.processIdentifier, SIGKILL)
            }
            finish()
        }
        process = nil
    }

    private func launch() {
        state = .starting
        let p = Process()
        p.executableURL = executable
        p.arguments = arguments
        p.standardOutput = log.handle
        p.standardError = log.handle
        let started = Date()
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.async { self?.exited(proc.terminationStatus, after: Date().timeIntervalSince(started)) }
        }
        do {
            try p.run()
        } catch {
            state = .failed("The agent could not be started: \(error.localizedDescription)")
            log.write("launch failed: \(error)")
            return
        }
        process = p
        log.write("agent started (pid \(p.processIdentifier))")
        waitUntilListening(attempt: 0)
    }

    private func waitUntilListening(attempt: Int) {
        guard let p = process, p.isRunning else { return }
        if PortProbe.isListening(host: endpoint.host, port: endpoint.port) {
            quickExits = 0
            state = .running
            return
        }
        guard attempt < 60 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.waitUntilListening(attempt: attempt + 1)
        }
    }

    private func exited(_ status: Int32, after duration: TimeInterval) {
        process = nil
        log.write("agent exited with status \(status) after \(Int(duration))s")
        guard !stopping else { return }
        quickExits = duration < Self.quickExit ? quickExits + 1 : 0
        if quickExits >= Self.maxQuickExits {
            state = .failed("The agent keeps stopping as soon as it starts. The log says why.")
            return
        }
        // 1, 2, 4, 8, 16 seconds: a crash after real work restarts at once, a failing start backs off.
        let delay = quickExits == 0 ? 1 : pow(2, Double(quickExits - 1))
        state = .starting
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, !self.stopping else { return }
            self.start()
        }
    }
}
