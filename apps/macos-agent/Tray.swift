import AppKit

/// The menu-bar item. A left click opens the panel; a right click shows the same actions as a
/// plain menu, which is where a menu-bar item's menu has always been.
final class Tray: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let panel: Panel
    private let model: PanelModel

    init(model: PanelModel) {
        self.model = model
        panel = Panel(model: model)
        super.init()
        // A template image: macOS draws it light or dark to match the menu bar.
        let icon = Bundle.main.image(forResource: "tray-template")
        icon?.isTemplate = true
        item.button?.image = icon
        item.button?.toolTip = "Citadel Agent"
        item.button?.target = self
        item.button?.action = #selector(clicked)
        item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    var isPanelShown: Bool { panel.isShown }

    func show(_ state: AgentProcess.State) {
        model.agent = state
        item.button?.appearsDisabled = state != .running && state != .external
    }

    @objc private func clicked() {
        guard let button = item.button else { return }
        if NSApp.currentEvent?.type == .rightMouseUp {
            panel.close()
            let menu = NSMenu()
            menu.delegate = self
            item.menu = menu
            button.performClick(nil)
            item.menu = nil
        } else {
            panel.toggle(relativeTo: button)
        }
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        add(menu, "Open Citadel Workspaces", .openWorkspace)
        add(menu, "Create a Workspace…", .createWorkspace)
        menu.addItem(.separator())
        add(menu, "Start at Login", .toggleLogin).state = LoginItem.isEnabled ? .on : .off
        add(menu, "Show Log", .showLog)
        if case .failed = model.agent { add(menu, "Restart Agent", .restartAgent) }
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Citadel Agent", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    }

    @discardableResult
    private func add(_ menu: NSMenu, _ title: String, _ action: PanelAction) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: #selector(chosen(_:)), keyEquivalent: "")
        entry.target = self
        entry.representedObject = MenuAction(action)
        menu.addItem(entry)
        return entry
    }

    @objc private func chosen(_ sender: NSMenuItem) {
        (sender.representedObject as? MenuAction).map { model.perform($0.action) }
    }
}

/// NSMenuItem.representedObject takes an object; PanelAction is an enum.
private final class MenuAction {
    let action: PanelAction
    init(_ action: PanelAction) { self.action = action }
}
