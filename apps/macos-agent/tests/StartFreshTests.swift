import AppKit
import Foundation

/// The launcher's start-fresh decision: the signal, the answer, the action. Pure: no dialog.
func testStartFresh() {
    func status(_ fields: [String: Any]) -> Data { try! JSONSerialization.data(withJSONObject: fields) }
    let signal: [String: Any] = [
        "v": 1, "signal": "start-fresh", "exit_code": 65, "data_dir": "/Users/a/.citadel-agent",
        "disposal": "trash", "title": "Citadel was updated", "message": "Start fresh?",
        "confirm": "Start fresh", "cancel": "Quit",
    ]
    let offer = StartFresh.offer(exitStatus: 65, file: status(signal))
    check(offer?.dataDirectory == "/Users/a/.citadel-agent" && offer?.confirm == "Start fresh",
          "the agent's signal is read as an offer for the directory it named")
    check(StartFresh.offer(exitStatus: 1, file: status(signal)) == nil, "an unknown exit is not the signal, even with a file")
    check(StartFresh.offer(exitStatus: 0, file: status(signal)) == nil, "a clean exit is not the signal")
    check(StartFresh.offer(exitStatus: 65, file: nil) == nil, "an exit status without the file is not the signal")
    check(StartFresh.offer(exitStatus: 65, file: Data("{".utf8)) == nil, "a half-written file is not the signal")
    var newer = signal; newer["v"] = 2
    check(StartFresh.offer(exitStatus: 65, file: status(newer)) == nil, "an unknown schema version is not read")
    var relative = signal; relative["data_dir"] = ".citadel-agent"
    check(StartFresh.offer(exitStatus: 65, file: status(relative)) == nil, "a relative directory is not offered")
    var missing = signal; missing.removeValue(forKey: "message")
    check(StartFresh.offer(exitStatus: 65, file: status(missing)) == nil, "an offer without its words is not shown")

    guard let offer else { return }
    check(StartFresh.action(for: offer, startFresh: true) == .relaunch(["--start-fresh-from", "/Users/a/.citadel-agent"]),
          "Start fresh relaunches with consent for exactly that directory")
    check(StartFresh.action(for: offer, startFresh: false) == .quit, "Quit quits and passes no consent")
    check(StartFresh.startsFresh(.alertSecondButtonReturn), "the Start fresh button starts fresh")
    check(!StartFresh.startsFresh(.alertFirstButtonReturn), "the default button (Quit) does not")
    check(!StartFresh.startsFresh(.abort), "Esc does not")
}

/// The alert as built for the person: Quit first (Return), Start fresh destructive with no key.
func testStartFreshAlert() {
    let offer = StartFreshOffer(dataDirectory: "/Users/a/.citadel-agent", title: "T", message: "M",
                                confirm: "Start fresh", cancel: "Quit")
    let buttons = AlertPrompt.alert(for: offer).buttons
    check(buttons.map(\.title) == ["Quit", "Start fresh"], "Quit is the first button, Start fresh the second")
    check(buttons.first?.keyEquivalent == "\r", "Return chooses Quit")
    check(buttons.last?.keyEquivalent == "" && buttons.last?.hasDestructiveAction == true,
          "Start fresh has no key and is marked destructive")
}
