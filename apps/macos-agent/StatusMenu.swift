import AppKit

/// The menu-bar item: the agent's state in words, and the few things anyone needs to do with it.
final class StatusMenu: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let settings: AgentSettings
    private let log: LogFile
    private let agent: AgentProcess
    private let stateLine = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private let restartLine = NSMenuItem(title: "Restart Agent", action: #selector(restart), keyEquivalent: "")
    private let loginLine = NSMenuItem(title: "Start at Login", action: #selector(toggleLogin), keyEquivalent: "")

    init(settings: AgentSettings, log: LogFile, agent: AgentProcess) {
        self.settings = settings
        self.log = log
        self.agent = agent
        super.init()
        // A template image: macOS draws it light or dark to match the menu bar.
        let icon = Bundle.main.image(forResource: "tray-template")
        icon?.isTemplate = true
        item.button?.image = icon
        item.button?.toolTip = "Citadel Agent"

        let menu = NSMenu()
        menu.delegate = self
        stateLine.isEnabled = false
        menu.addItem(stateLine)
        menu.addItem(.separator())
        menu.addItem(entry("Open Citadel Workspace", #selector(openWorkspace), "o"))
        menu.addItem(restartLine)
        restartLine.target = self
        menu.addItem(.separator())
        loginLine.target = self
        menu.addItem(loginLine)
        menu.addItem(entry("Show Log", #selector(showLog), "l"))
        menu.addItem(.separator())
        menu.addItem(entry("Quit Citadel Agent", #selector(quit), "q"))
        item.menu = menu
    }

    func show(_ state: AgentProcess.State) {
        switch state {
        case .starting: stateLine.title = "Citadel Agent is starting…"
        case .running: stateLine.title = "Citadel Agent is running"
        case .external: stateLine.title = "Another Citadel agent is already running"
        case .failed(let why): stateLine.title = why
        }
        restartLine.isHidden = { if case .failed = state { return false } else { return true } }()
        item.button?.appearsDisabled = state != .running && state != .external
    }

    func menuWillOpen(_ menu: NSMenu) {
        loginLine.state = LoginItem.isEnabled ? .on : .off
    }

    private func entry(_ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let e = NSMenuItem(title: title, action: action, keyEquivalent: key)
        e.target = self
        return e
    }

    @objc private func openWorkspace() { NSWorkspace.shared.open(settings.workspaceURL) }
    @objc private func restart() { agent.restart() }
    @objc private func toggleLogin() { LoginItem.toggle(log: log) }
    @objc private func showLog() { NSWorkspace.shared.open(log.url) }
    @objc private func quit() { NSApp.terminate(nil) }
}
