import AppKit
import Foundation

// The updater's sequence against scripted steps, and its real steps against scratch copies.
// Built and run by scripts/test-macos-agent-updater.sh; never touches an installed app.
//
//   test-updater [<a signed, notarised Citadel Agent.app to copy> <its version>]

func fatal(_ title: String, _ detail: String) { fail("fatal: \(title): \(detail)") }

var failures = 0
func check(_ ok: Bool, _ what: String, file: String = #file, line: Int = #line) {
    if ok { print("ok   \(what)") } else { failures += 1; print("FAIL \(what) (line \(line))") }
}
func fail(_ what: String) { failures += 1; print("FAIL \(what)") }

/// Steps that record what they were asked to do; time moves only when `after` is called.
final class Script {
    var events: [String] = []
    var verifyFails = false
    var swapFails = false
    var healthyAfter: Int? = 2
    var probes = 0
    var clock = Date(timeIntervalSince1970: 0)
    var failure: (String, String)?

    func steps() -> AppUpdater.Steps {
        AppUpdater.Steps(
            extract: { [self] image, to in events.append("extract \(image.lastPathComponent) -> \(to.lastPathComponent)") },
            verify: { [self] _, version in
                events.append("verify \(version)")
                if verifyFails { throw UpdateSteps.Failure("not signed by the team") }
            },
            stopAgent: { [self] then in events.append("stop"); then() },
            restartAgent: { [self] in events.append("restart") },
            swap: { [self] a, b in
                events.append("swap \(a.lastPathComponent) \(b.lastPathComponent)")
                if swapFails { throw UpdateSteps.Failure("EXDEV") }
            },
            open: { [self] app, then in
                events.append("open \(app.lastPathComponent)")
                then(.success(AppUpdater.Launched(terminate: { [self] in events.append("terminate") })))
            },
            healthy: { [self] in probes += 1; return healthyAfter.map { probes > $0 } ?? false },
            remove: { [self] url in events.append("remove \(url.lastPathComponent)") },
            after: { [self] seconds, then in clock += seconds; then() },
            now: { [self] in clock },
            quit: { [self] in events.append("quit") },
            log: { _ in },
            background: { work, then in work(); then() }
        )
    }

    func run(_ build: (Script) -> Void = { _ in }) -> Script {
        build(self)
        let updater = AppUpdater(bundle: URL(fileURLWithPath: "/X/Citadel Agent.app"), steps: steps())
        updater.onFailure = { [self] version, why in failure = (version, why) }
        updater.install(image: URL(fileURLWithPath: "/c/Citadel-Agent.dmg"), version: "0.9.0")
        return self
    }
}

let staged = ".Citadel Agent.app.incoming"
let prelude = ["remove \(staged)", "extract Citadel-Agent.dmg -> \(staged)", "verify 0.9.0"]

let happy = Script().run()
check(happy.events == prelude + ["stop", "swap \(staged) Citadel Agent.app", "open Citadel Agent.app", "remove \(staged)", "quit"],
      "a new version that answers is kept, the old one removed, and this app quits")
check(happy.failure == nil, "nothing is reported for a good install")

let unsigned = Script().run { $0.verifyFails = true }
check(unsigned.events == prelude + ["remove \(staged)"], "a copy that fails verification stops before the agent is touched")
check(unsigned.failure?.1.contains("team") == true, "and the agent is told why")

let silent = Script().run { $0.healthyAfter = nil }
check(silent.events == prelude + ["stop", "swap \(staged) Citadel Agent.app", "open Citadel Agent.app", "terminate",
                                  "swap \(staged) Citadel Agent.app", "remove \(staged)", "restart"],
      "a new version whose agent never answers is terminated, swapped back, and this app's agent restarts")
check(silent.clock.timeIntervalSince1970 >= AppUpdater.healthyWithin, "only after the full wait")
check(silent.failure?.1.contains("did not answer") == true, "and the agent is told why")

let stuck = Script().run { $0.swapFails = true }
check(stuck.events == prelude + ["stop", "swap \(staged) Citadel Agent.app", "remove \(staged)", "restart"],
      "a swap that fails leaves the old app and restarts its agent")

// The real steps, on scratch directories only.
let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("citadel-updater-test-\(UUID().uuidString)")
try! FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)

let a = scratch.appendingPathComponent("A.app"), b = scratch.appendingPathComponent("B.app")
for (dir, name) in [(a, "a"), (b, "b")] {
    try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    try! Data(name.utf8).write(to: dir.appendingPathComponent("marker"))
}
do {
    try UpdateSteps.swap(a, b)
    let inA = try String(contentsOf: a.appendingPathComponent("marker"), encoding: .utf8)
    let inB = try String(contentsOf: b.appendingPathComponent("marker"), encoding: .utf8)
    check(inA == "b" && inB == "a", "renamex_np swaps two bundles in one call")
} catch { fail("swap: \(error)") }
check((try? UpdateSteps.swap(a, scratch.appendingPathComponent("missing.app"))) == nil, "a swap with nothing on one side fails")

let downloads = UpdateSteps.downloads
check(UpdateSteps.isAgentDownload(downloads.appendingPathComponent("0.9.0/Citadel-Agent.dmg")), "the agent's download is accepted")
check(!UpdateSteps.isAgentDownload(URL(fileURLWithPath: "/tmp/Citadel-Agent.dmg")), "an image anywhere else is not")
check(!UpdateSteps.isAgentDownload(downloads.appendingPathComponent("../../x/Citadel-Agent.dmg")), "nor one that climbs out")
check(!UpdateSteps.isAgentDownload(downloads.appendingPathComponent("0.9.0/Other.dmg")), "nor another name")

let args = CommandLine.arguments
if args.count == 3 {
    let source = URL(fileURLWithPath: args[1]), version = args[2]
    let content = scratch.appendingPathComponent("image"), app = content.appendingPathComponent(UpdateSteps.appName)
    try! FileManager.default.createDirectory(at: content, withIntermediateDirectories: true)
    let image = scratch.appendingPathComponent("Citadel-Agent.dmg")
    let copied = try! UpdateSteps.run("/usr/bin/ditto", [source.path, app.path])
    let made = try! UpdateSteps.run("/usr/bin/hdiutil", ["create", "-quiet", "-srcfolder", content.path, "-format", "UDZO", image.path])
    check(copied.status == 0 && made.status == 0, "a scratch disk image of the app")
    let out = scratch.appendingPathComponent("incoming.app")
    do { try UpdateSteps.extract(image: image, to: out) } catch { fail("extract: \(error)") }
    let team = UpdateSteps.team(of: out)
    check(team != nil, "the copied app names its team")
    check((try? UpdateSteps.verify(app: out, version: version, expectedTeam: team)) != nil, "a signed, notarised \(version) passes")
    check((try? UpdateSteps.verify(app: out, version: "99.0.0", expectedTeam: team)) == nil, "the wrong version fails")
    check((try? UpdateSteps.verify(app: out, version: version, expectedTeam: "ZZZZZZZZZZ")) == nil, "another team fails")
    check((try? UpdateSteps.verify(app: out, version: version, expectedTeam: nil)) == nil, "an unsigned launcher refuses to judge")
    let resource = out.appendingPathComponent("Contents/Resources/tray-template.png")
    if let handle = try? FileHandle(forWritingTo: resource) { handle.seekToEndOfFile(); handle.write(Data([0])); try? handle.close() }
    check((try? UpdateSteps.verify(app: out, version: version, expectedTeam: team)) == nil, "a tampered bundle fails")
} else {
    print("skip the real-app checks: no signed app given")
}

try? FileManager.default.removeItem(at: scratch)
print(failures == 0 ? "all passed" : "\(failures) failed")
exit(failures == 0 ? 0 : 1)
