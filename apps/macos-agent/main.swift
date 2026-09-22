import AppKit
import ServiceManagement

/// Citadel Agent.app: the agent, with a menu-bar item instead of a terminal window.
///
/// Opened once from Applications, it starts the agent, registers itself to start at login, and
/// from then on is simply there. Opened from the disk image instead, it offers to move itself into
/// Applications first, because a login item that points into a disk image stops working the moment
/// the image is ejected.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var agent: AgentProcess?
    private var tray: Tray?
    private let model = PanelModel()
    private var client: AgentClient?
    private var poll: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        if Installer.offerToMoveIfNeeded() { return }
        do {
            let settings = try AgentSettings(bundle: .main)
            let log = try LogFile()
            guard let executable = Bundle.main.url(forAuxiliaryExecutable: "citadel-agent") else {
                throw SettingsError.missing("the bundled citadel-agent executable")
            }
            let agent = AgentProcess(executable: executable, settings: settings, log: log)
            let tray = Tray(model: model)
            agent.onChange = { [weak self, weak tray] state in
                tray?.show(state)
                if state == .running || state == .external { self?.refresh() }
            }
            model.perform = { [weak agent] action in
                Actions.perform(action, settings: settings, log: log, agent: agent)
            }
            self.agent = agent
            self.tray = tray
            let client = AgentClient(port: settings.bindPort)
            self.client = client
            model.onOpen = { [weak self] in self?.refresh() }
            // Only while the panel is open: nothing else shows the list.
            poll = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
                guard let self, self.tray?.isPanelShown == true else { return }
                self.refresh()
            }
            LoginItem.registerOnFirstLaunch(log: log)
            agent.start()
            tray.show(agent.state)
        } catch {
            fatal("Citadel Agent cannot start", "\(error)")
        }
    }

    private func refresh() {
        guard model.agent == .running || model.agent == .external else { return }
        client?.fetch { [weak self] accounts in
            guard let self else { return }
            // A failed read keeps what was shown rather than claiming there are no accounts.
            if let accounts {
                self.model.accounts = accounts
                self.model.loaded = true
            }
        }
    }

    /// Quitting waits for the agent to stop, so it is never left running without the menu item.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let agent else { return .terminateNow }
        agent.stop { NSApp.reply(toApplicationShouldTerminate: true) }
        return .terminateLater
    }
}

enum Actions {
    static func perform(_ action: PanelAction, settings: AgentSettings, log: LogFile, agent: AgentProcess?) {
        switch action {
        case .openWorkspace: NSWorkspace.shared.open(settings.workspaceURL)
        case .createWorkspace: NSWorkspace.shared.open(settings.workspaceURL.appendingPathComponent("create"))
        case .openAccount(let account), .logIn(let account):
            guard let url = WorkspaceLink.forAccount(account, origin: settings.workspaceURL) else {
                log.write("no workspace link for \(account.id)")
                return
            }
            NSWorkspace.shared.open(url)
        case .restartAgent: agent?.restart()
        case .toggleLogin: LoginItem.toggle(log: log)
        case .showLog: NSWorkspace.shared.open(log.url)
        }
    }
}

enum WorkspaceLink {
    /// The site, for now. The page does not yet read an account from its URL, so a parameter here
    /// would only look like it selected one; `?account=` arrives with the page that honours it.
    static func forAccount(_ account: Account, origin: URL) -> URL? { origin }
}

enum LoginItem {
    private static let registeredKey = "registeredLoginItem"

    /// Once, not on every launch: someone who turns it off in System Settings has decided.
    static func registerOnFirstLaunch(log: LogFile) {
        guard !UserDefaults.standard.bool(forKey: registeredKey) else { return }
        do {
            try SMAppService.mainApp.register()
            UserDefaults.standard.set(true, forKey: registeredKey)
            log.write("registered to start at login")
        } catch {
            log.write("could not register to start at login: \(error)")
        }
    }

    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }

    static func toggle(log: LogFile) {
        do {
            if isEnabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
        } catch {
            log.write("start at login could not be changed: \(error)")
        }
    }
}

enum Installer {
    /// True when the app is about to relaunch from Applications (or quit), so launching stops here.
    static func offerToMoveIfNeeded() -> Bool {
        let here = Bundle.main.bundleURL
        let path = here.path
        let fromImage = path.hasPrefix("/Volumes/")
        // Gatekeeper runs a quarantined app from ~/Downloads at a randomised read-only path.
        let translocated = path.contains("/AppTranslocation/")
        guard fromImage || translocated else { return false }

        let alert = NSAlert()
        alert.messageText = "Move Citadel Agent to Applications?"
        alert.informativeText = "Citadel Agent runs in the menu bar and starts when you log in, which only works from the Applications folder."
        alert.addButton(withTitle: "Move to Applications")
        alert.addButton(withTitle: "Quit")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { NSApp.terminate(nil); return true }

        let target = URL(fileURLWithPath: "/Applications").appendingPathComponent(here.lastPathComponent)
        let ditto = Process()
        ditto.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        ditto.arguments = [path, target.path]
        do {
            if FileManager.default.fileExists(atPath: target.path) {
                try FileManager.default.trashItem(at: target, resultingItemURL: nil)
            }
            try ditto.run()
            ditto.waitUntilExit()
            guard ditto.terminationStatus == 0 else { throw SettingsError.invalid("copy to Applications", "ditto \(ditto.terminationStatus)") }
        } catch {
            fatal("Citadel Agent could not be moved", "Drag it from the disk image into the Applications folder instead.\n\n\(error)")
            return true
        }
        let config = NSWorkspace.OpenConfiguration()
        config.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: target, configuration: config) { _, _ in
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
        return true
    }
}

func fatal(_ title: String, _ detail: String) {
    let alert = NSAlert()
    alert.alertStyle = .critical
    alert.messageText = title
    alert.informativeText = detail
    NSApp.activate(ignoringOtherApps: true)
    alert.runModal()
    NSApp.terminate(nil)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
// SIGTERM (a `kill`, launchd on shutdown) skips applicationWillTerminate, which would leave the
// agent running without us and holding its port, so the next launch could only report "another
// agent is already running". Routed through the normal quit instead.
signal(SIGTERM, SIG_IGN)
let sigterm = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
// Handed to the run loop, not called here: terminating defers to the agent's exit, which is
// reported on the main queue, and this handler IS a main-queue block -- calling terminate inside
// it waits for a block queued behind itself.
sigterm.setEventHandler { RunLoop.main.perform { NSApp.terminate(nil) } }
sigterm.resume()
app.setActivationPolicy(.accessory)
app.run()
