import AppKit
import Foundation

/// What an agent that refused an earlier agent's data offers (the agent's src/fresh_start): read
/// from the status file it wrote, and only when it exited with the status that file names, so
/// this launcher keeps no copy of the number and reacts to no other exit.
struct StartFreshOffer: Equatable {
    let dataDirectory: String
    let title: String
    let message: String
    let confirm: String
    let cancel: String
}

/// The person's answer: the port, so the sequence is tested without a dialog.
protocol StartFreshPrompt {
    /// True only for an explicit Start fresh.
    func ask(_ offer: StartFreshOffer) -> Bool
}

enum StartFreshAction: Equatable {
    /// Start the agent again with these arguments added once: its consent to that directory.
    case relaunch([String])
    case quit
}

enum StartFresh {
    /// The environment variable the agent writes its status file to (fresh_start/status_file.rs).
    static let statusFileVariable = "CITADEL_AGENT_STATUS_FILE"
    private static let version = 1
    private static let signal = "start-fresh"

    /// The offer, when `file` is a version-1 start-fresh status naming `exitStatus`; nil otherwise.
    static func offer(exitStatus: Int32, file: Data?) -> StartFreshOffer? {
        guard let file,
              let json = try? JSONSerialization.jsonObject(with: file) as? [String: Any],
              json["v"] as? Int == version, json["signal"] as? String == signal,
              let code = json["exit_code"] as? Int, Int32(exactly: code) == exitStatus, code != 0,
              let dir = json["data_dir"] as? String, dir.hasPrefix("/"),
              let title = json["title"] as? String, let message = json["message"] as? String,
              let confirm = json["confirm"] as? String, let cancel = json["cancel"] as? String
        else { return nil }
        return StartFreshOffer(dataDirectory: dir, title: title, message: message, confirm: confirm, cancel: cancel)
    }

    static func action(for offer: StartFreshOffer, startFresh: Bool) -> StartFreshAction {
        startFresh ? .relaunch(["--start-fresh-from", offer.dataDirectory]) : .quit
    }

    /// Only the second button is Start fresh: the first (Quit) is the default, and Esc aborts.
    static func startsFresh(_ response: NSApplication.ModalResponse) -> Bool {
        response == .alertSecondButtonReturn
    }
}

/// The question as an NSAlert. Quit is the first button, so Return chooses it; Esc, which an
/// alert gives only to a button titled "Cancel", is caught and also means Quit.
struct AlertPrompt: StartFreshPrompt {
    func ask(_ offer: StartFreshOffer) -> Bool {
        let alert = Self.alert(for: offer)
        let escape = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.keyCode == 53 { NSApp.abortModal(); return nil }
            return event
        }
        defer { if let escape { NSEvent.removeMonitor(escape) } }
        NSApp.activate(ignoringOtherApps: true)
        return StartFresh.startsFresh(alert.runModal())
    }

    static func alert(for offer: StartFreshOffer) -> NSAlert {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = offer.title
        alert.informativeText = offer.message
        alert.addButton(withTitle: offer.cancel)
        let startFresh = alert.addButton(withTitle: offer.confirm)
        startFresh.hasDestructiveAction = true
        startFresh.keyEquivalent = ""
        return alert
    }
}
