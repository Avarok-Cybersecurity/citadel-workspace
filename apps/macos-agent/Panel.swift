import AppKit
import SwiftUI

/// The dropdown under the menu-bar item: the accounts on this Mac, each connected or ready to log
/// in. The pattern is certified.sh's tray (rMazing apps/macos/TrayPanel.swift): a transient
/// popover, SwiftUI inside, a solid backdrop painted under the popover's own frame so the arrow
/// takes the panel's colour too.
final class Panel {
    private let popover = NSPopover()
    let model: PanelModel

    init(model: PanelModel) {
        self.model = model
        popover.behavior = .transient
        popover.animates = true
        popover.appearance = NSAppearance(named: .vibrantDark)
        popover.contentViewController = PanelHost(model: model)
        model.onResize = { [weak self] in self?.resize() }
    }

    func toggle(relativeTo button: NSView) {
        if popover.isShown { popover.performClose(nil); return }
        resize()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.contentView?.setAccessibilityIdentifier(PanelMetrics.identifier)
        model.onOpen?()
    }

    func close() { popover.performClose(nil) }

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
    case openWorkspace
    case createWorkspace
    case restartAgent
    case toggleLogin
    case showLog
}

final class PanelModel: ObservableObject {
    @Published var accounts: [Account] = [] { didSet { onResize?() } }
    @Published var agent: AgentProcess.State = .starting
    @Published var search = ""
    /// Whether the account list has been read at least once, so "no accounts" is never shown
    /// merely because nothing has been asked yet.
    @Published var loaded = false
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
        let total = PanelMetrics.title + 1 + rows + 1 + PanelMetrics.footer + PanelMetrics.search
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
