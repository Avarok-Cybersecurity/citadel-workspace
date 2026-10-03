import AppKit
import Foundation
import Security

/// The real steps of an update (AppUpdater): disk images, code signatures, the bundle swap.
enum UpdateSteps {
    static let bundleIdentifier = "net.avarok.citadel-agent"
    static let appName = "Citadel Agent.app"

    struct Failure: Error, CustomStringConvertible {
        let description: String
        init(_ description: String) { self.description = description }
    }

    /// Where the agent downloads updates (citadel-workspace-internal-service's update_setup.rs:
    /// the user's cache directory, then citadel-agent/updates).
    static var downloads: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Caches/citadel-agent/updates", isDirectory: true)
    }

    /// Whether `image` is a disk image the agent downloaded: inside `downloads`, by that name.
    static func isAgentDownload(_ image: URL) -> Bool {
        let path = image.standardizedFileURL.resolvingSymlinksInPath().path
        let root = downloads.standardizedFileURL.resolvingSymlinksInPath().path + "/"
        return path.hasPrefix(root) && image.lastPathComponent == "Citadel-Agent.dmg"
    }

    /// The steps against this Mac: this app's bundle, its agent, its loopback socket.
    static func live(agent: AgentProcess, host: String, port: UInt16, log: LogFile) -> AppUpdater.Steps {
        let team = team(of: nil)
        return AppUpdater.Steps(
            extract: { try extract(image: $0, to: $1) },
            verify: { try verify(app: $0, version: $1, expectedTeam: team) },
            stopAgent: { agent.stop(then: $0) },
            restartAgent: { agent.restart() },
            swap: { try swap($0, $1) },
            open: { open($0, then: $1) },
            healthy: { PortProbe.isListening(host: host, port: port) },
            remove: { try? FileManager.default.removeItem(at: $0) },
            after: { DispatchQueue.main.asyncAfter(deadline: .now() + $0, execute: $1) },
            now: { Date() },
            quit: { NSApp.terminate(nil) },
            log: { log.write($0) },
            background: { work, then in DispatchQueue.global(qos: .utility).async { work(); DispatchQueue.main.async(execute: then) } }
        )
    }

    /// Runs `tool` and returns its exit status and everything it printed.
    @discardableResult
    static func run(_ tool: String, _ arguments: [String]) throws -> (status: Int32, output: String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: tool)
        p.arguments = arguments
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        try p.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (p.terminationStatus, String(decoding: data, as: UTF8.self))
    }

    /// Mounts `image` read-only where nothing else sees it, copies the app out, and detaches.
    static func extract(image: URL, to destination: URL) throws {
        let mountPoint = FileManager.default.temporaryDirectory.appendingPathComponent("citadel-update-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: mountPoint, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: mountPoint) }
        let attach = try run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mountPoint.path, image.path])
        guard attach.status == 0 else { throw Failure("the disk image did not mount: \(attach.output)") }
        defer { _ = try? run("/usr/bin/hdiutil", ["detach", "-force", mountPoint.path]) }
        let app = mountPoint.appendingPathComponent(appName)
        guard FileManager.default.fileExists(atPath: app.path) else { throw Failure("the disk image holds no \(appName)") }
        let copy = try run("/usr/bin/ditto", [app.path, destination.path])
        guard copy.status == 0 else { throw Failure("the app could not be copied out: \(copy.output)") }
    }

    /// The team that signed the code at `url`, or this running app's when `url` is nil.
    static func team(of url: URL?) -> String? {
        var code: SecStaticCode?
        if let url {
            guard SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess else { return nil }
        } else {
            var running: SecCode?
            guard SecCodeCopySelf([], &running) == errSecSuccess, let running,
                  SecCodeCopyStaticCode(running, [], &code) == errSecSuccess else { return nil }
        }
        guard let code else { return nil }
        var info: CFDictionary?
        let flags = SecCSFlags(rawValue: kSecCSSigningInformation)
        guard SecCodeCopySigningInformation(code, flags, &info) == errSecSuccess,
              let dict = info as? [String: Any] else { return nil }
        return dict[kSecCodeInfoTeamIdentifier as String] as? String
    }

    /// The app at `app` is this app, signed by this app's team, notarised, and is `version`.
    static func verify(app: URL, version: String, expectedTeam: String?) throws {
        guard let team = expectedTeam else {
            throw Failure("this copy of Citadel Agent is not signed by a team, so it cannot check an update's signature")
        }
        let requirementText = "identifier \"\(bundleIdentifier)\" and anchor apple generic and certificate leaf[subject.OU] = \"\(team)\""
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(requirementText as CFString, [], &requirement) == errSecSuccess else {
            throw Failure("the signing requirement did not parse")
        }
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(app as CFURL, [], &code) == errSecSuccess, let code else {
            throw Failure("the new app's code could not be read")
        }
        let flags = SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSStrictValidate | kSecCSCheckNestedCode)
        var error: Unmanaged<CFError>?
        guard SecStaticCodeCheckValidityWithErrors(code, flags, requirement, &error) == errSecSuccess else {
            let why = error.map { "\($0.takeRetainedValue())" } ?? "no reason given"
            throw Failure("the new app is not signed by \(team): \(why)")
        }
        let gatekeeper = try run("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose", app.path])
        guard gatekeeper.status == 0, gatekeeper.output.contains("source=Notarized Developer ID") else {
            throw Failure("Gatekeeper does not accept the new app as notarised: \(gatekeeper.output)")
        }
        let plist = NSDictionary(contentsOf: app.appendingPathComponent("Contents/Info.plist"))
        let shortVersion = plist?["CFBundleShortVersionString"] as? String
        guard shortVersion == version else {
            throw Failure("the new app says it is \(shortVersion ?? "no version"), the release is \(version)")
        }
        let agent = try run(app.appendingPathComponent("Contents/MacOS/citadel-agent").path, ["--version"])
        let printed = agent.output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard agent.status == 0, printed == "citadel-agent \(version)" else {
            throw Failure("the new app's agent says \"\(printed)\", the release is \(version)")
        }
    }

    /// Exchanges `a` and `b` in one call: at no moment is either path missing.
    static func swap(_ a: URL, _ b: URL) throws {
        guard renamex_np(a.path, b.path, UInt32(RENAME_SWAP)) == 0 else {
            throw Failure("the bundles could not be swapped: \(String(cString: strerror(errno)))")
        }
    }

    static func open(_ app: URL, then: @escaping (Result<AppUpdater.Launched, Error>) -> Void) {
        let config = NSWorkspace.OpenConfiguration()
        config.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: app, configuration: config) { running, error in
            let result: Result<AppUpdater.Launched, Error>
            if let running {
                result = .success(AppUpdater.Launched(terminate: { if !running.terminate() { running.forceTerminate() } }))
            } else {
                result = .failure(error ?? Failure("the new app did not open"))
            }
            DispatchQueue.main.async { then(result) }
        }
    }
}
