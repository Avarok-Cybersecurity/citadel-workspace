import AppKit
import SwiftUI

/// The dropdown under the menu-bar item: the accounts on this Mac, each connected or ready to log
/// in. The pattern is certified.sh's tray (rMazing apps/macos/TrayPanel.swift): a transient
/// popover, SwiftUI inside, a solid backdrop painted under the popover's own frame so the arrow
/// takes the panel's colour too.
final class Panel: NSObject, NSPopoverDelegate {
    private let popover = NSPopover()
    /// Clicks in other apps, which a transient popover of a background app never hears; held only while shown.
    private var outsideClicks: Any?
    let model: PanelModel

    init(model: PanelModel) {
        self.model = model
        super.init()
        popover.behavior = .transient
        popover.animates = true
        popover.delegate = self
        popover.appearance = NSAppearance(named: .vibrantDark)
        popover.contentViewController = PanelHost(model: model)
        model.onResize = { [weak self] in self?.resize() }
    }

    func toggle(relativeTo button: NSView) {
        if popover.isShown { popover.performClose(nil); return }
        resize()
        // A transient popover closes on an outside click only while its app is active, and this
        // app is an accessory that never is unless asked.
        NSApp.activate(ignoringOtherApps: true)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
        watchOutsideClicks()
        popover.contentViewController?.view.window?.contentView?.setAccessibilityIdentifier(PanelMetrics.identifier)
        model.onOpen?()
    }

    func close() { popover.performClose(nil) }

    func popoverDidClose(_ notification: Notification) { stopWatchingOutsideClicks() }

    private func watchOutsideClicks() {
        guard outsideClicks == nil else { return }
        outsideClicks = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            self?.popover.performClose(nil)
        }
    }

    private func stopWatchingOutsideClicks() {
        outsideClicks.map(NSEvent.removeMonitor)
        outsideClicks = nil
    }

    var isShown: Bool { popover.isShown }

    private func resize() {
        popover.contentSize = NSSize(width: PanelMetrics.width, height: model.preferredHeight)
    }
}

/// One account the agent knows on this Mac.
struct Account: Identifiable, Equatable {
    /// The CID: permanent per account, so a row keeps its identity across polls.
    var id: UInt64 { cid }
    let cid: UInt64
    let username: String
    let fullName: String
    /// The workspace's host (acme.work.avarok.net). Nil until the agent records the name it was
    /// registered with; today it keeps only the resolved address, which for a tenant is Cloudflare's.
    let workspaceHost: String?
    let connected: Bool
}

enum PanelAction {
    case openAccount(Account)
    case logIn(Account)
    /// The account's notification settings in the workspace.
    case openSettings(Account)
    case setMuted(Account, Bool)
    case openWorkspace
    case createWorkspace
    case restartAgent
    case toggleLogin
    case showLog
    /// The workspace's /agent page, at #about and at #updates.
    case openAbout
    case checkForUpdates
    /// System Settings, at this app's notification switch.
    case openNotificationSettings
    /// "Restart to update": install the release the agent verified.
    case installUpdate
    case openURL(URL)
}

final class PanelModel: ObservableObject {
    @Published var accounts: [Account] = [] { didSet { onResize?() } }
    /// Unread counts and mutes, from the agent's notice stream; empty without one.
    @Published var rows: [UInt64: NoticeRow] = [:]
    @Published var agent: AgentProcess.State = .starting
    @Published var search = ""
    /// Whether the account list has been read at least once, so "no accounts" is never shown
    /// merely because nothing has been asked yet.
    @Published var loaded = false
    /// A newer agent release, when the agent has announced one.
    @Published var update: AgentUpdate? { didSet { onResize?() } }
    /// macOS has notifications denied for this app, so nothing the agent raises can be seen.
    @Published var notificationsOff = false { didSet { onResize?() } }
    var perform: (PanelAction) -> Void = { _ in }
    var onResize: (() -> Void)?
    var onOpen: (() -> Void)?

    /// Connected first, then by name; filtered by the search field.
    var shown: [Account] {
        let sorted = accounts.sorted {
            $0.connected != $1.connected ? $0.connected : $0.username.localizedCaseInsensitiveCompare($1.username) == .orderedAscending
        }
        let q = search.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return sorted }
        return sorted.filter { $0.username.localizedCaseInsensitiveContains(q) || ($0.workspaceHost?.localizedCaseInsensitiveContains(q) ?? false) || $0.fullName.localizedCaseInsensitiveContains(q) }
    }

    var preferredHeight: CGFloat {
        // Each row is followed by a 1 pt hairline; with no rows, the empty row is 1.5 rows tall.
        let rows = accounts.isEmpty ? PanelMetrics.row * 1.5 : CGFloat(accounts.count) * (PanelMetrics.row + 1)
        let update = (self.update == nil ? 0 : PanelMetrics.update + 1) + (notificationsOff ? PanelMetrics.notifications + 1 : 0)
        let total = PanelMetrics.title + 1 + rows + 1 + update + PanelMetrics.footer + PanelMetrics.search
        return min(total, PanelMetrics.maxHeight)
    }
}

enum PanelMetrics {
    static let identifier = "citadel-agent-panel"
    static let width: CGFloat = 380
    static let maxHeight: CGFloat = 560
    static let title: CGFloat = 60
    static let row: CGFloat = 72
    static let footer: CGFloat = 40
    static let update: CGFloat = 56
    static let notifications: CGFloat = 48
    static let search: CGFloat = 60
    static let padding: CGFloat = 16
    static let avatar: CGFloat = 40
}

/// The brand kit's dark ground and its on-dark purple (assets/brand/BRAND-GUIDELINES.md); the
/// connected green is the one colour the kit does not define, and is certified.sh's.
enum PanelColour {
    static let panel = NSColor(srgbRed: 0x1C / 255, green: 0x1D / 255, blue: 0x28 / 255, alpha: 1)
}

extension Color {
    static let panel = Color(PanelColour.panel)
    static let panelRow = Color(red: 0x26 / 255, green: 0x27 / 255, blue: 0x34 / 255)
    static let panelHairline = Color(red: 0x33 / 255, green: 0x34 / 255, blue: 0x44 / 255)
    static let panelAccent = Color(red: 0x9B / 255, green: 0x87 / 255, blue: 0xF5 / 255)
    static let panelConnected = Color(red: 0x12 / 255, green: 0xB9 / 255, blue: 0x81 / 255)
    static let panelText = Color.white.opacity(0.92)
    static let panelSecondary = Color(red: 0xB5 / 255, green: 0xA6 / 255, blue: 0xC9 / 255)
}

final class PanelHost: NSViewController {
    private let model: PanelModel
    private var backdrop: NSView?

    init(model: PanelModel) {
        self.model = model
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) { nil }

    override func loadView() {
        let hosting = NSHostingView(rootView: PanelView(model: model))
        hosting.setAccessibilityIdentifier(PanelMetrics.identifier)
        view = hosting
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        // Under the frame view's own drawing, so the arrow is the panel's colour too; the frame
        // clips it to the popover's shape.
        guard backdrop == nil, let frame = view.window?.contentView?.superview else { return }
        let fill = NSView(frame: frame.bounds)
        fill.autoresizingMask = [.width, .height]
        fill.wantsLayer = true
        fill.layer?.backgroundColor = PanelColour.panel.cgColor
        frame.addSubview(fill, positioned: .below, relativeTo: frame)
        backdrop = fill
    }
}
