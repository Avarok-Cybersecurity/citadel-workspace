import AppKit
import SwiftUI

struct PanelView: View {
    @ObservedObject var model: PanelModel

    var body: some View {
        VStack(spacing: 0) {
            TitleRow(model: model).frame(height: PanelMetrics.title)
            Hairline()
            ScrollView {
                LazyVStack(spacing: 0) {
                    if model.shown.isEmpty {
                        EmptyRow(model: model)
                    }
                    ForEach(model.shown) { account in
                        AccountRow(account: account, perform: model.perform)
                        Hairline()
                    }
                }
            }
            Hairline()
            AgentFooter(model: model).frame(height: PanelMetrics.footer)
            SearchField(text: $model.search).frame(height: PanelMetrics.search)
        }
        .background(Color.panel)
        .accessibilityIdentifier(PanelMetrics.identifier)
    }
}

/// The brand kit's horizontal lockup, centred; the overflow menu at the right.
struct TitleRow: View {
    @ObservedObject var model: PanelModel

    var body: some View {
        ZStack {
            // The artwork, not live text: the name is outlined in the kit and must not be retyped.
            if let lockup = NSImage(named: "lockup") {
                Image(nsImage: lockup).resizable().interpolation(.high).aspectRatio(contentMode: .fit)
                    .frame(height: 32).accessibilityLabel("Citadel Workspaces")
            }
            HStack {
                Spacer()
                Menu {
                    Button("Open Citadel Workspaces") { model.perform(.openWorkspace) }
                    Button("Create a Workspace…") { model.perform(.createWorkspace) }
                    Divider()
                    Button(LoginItem.isEnabled ? "Don't Start at Login" : "Start at Login") { model.perform(.toggleLogin) }
                    Button("Show Log") { model.perform(.showLog) }
                    Divider()
                    Button("Quit Citadel Agent") { NSApp.terminate(nil) }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.system(size: 18)).foregroundColor(.panelSecondary)
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .accessibilityLabel("More")
            }
            .padding(.horizontal, PanelMetrics.padding)
        }
    }
}

/// An account: its initials, its name and workspace, and either "Connected" or a Log in button.
/// The whole row opens the workspace as that account. No hover state: @State is a macro in this
/// SDK, and a plain swiftc build (build-macos-agent-app.sh) has no macro plugins.
struct AccountRow: View {
    let account: Account
    let perform: (PanelAction) -> Void

    var body: some View {
        HStack(spacing: 12) {
            Avatar(name: account.fullName.isEmpty ? account.username : account.fullName)
            VStack(alignment: .leading, spacing: 3) {
                Text(account.username).font(.system(size: 16)).foregroundColor(.panelText).lineLimit(1)
                Text(subtitle).font(.system(size: 12)).foregroundColor(.panelSecondary).lineLimit(1).truncationMode(.middle)
            }
            Spacer(minLength: 8)
            if account.connected {
                HStack(spacing: 6) {
                    Circle().fill(Color.panelConnected).frame(width: 8, height: 8)
                    Text("Connected").font(.system(size: 12, weight: .medium)).foregroundColor(.panelConnected)
                }
                .accessibilityElement(children: .combine)
            } else {
                Button("Log in") { perform(.logIn(account)) }
                    .buttonStyle(.borderedProminent)
                    .tint(.panelAccent)
                    .controlSize(.small)
                    // Each row's button otherwise reads the same "Log in"; name whose account it is.
                    .accessibilityLabel("Log in as \(account.username)")
            }
        }
        .padding(.horizontal, PanelMetrics.padding)
        .frame(height: PanelMetrics.row)
        .contentShape(Rectangle())
        .onTapGesture { perform(account.connected ? .openAccount(account) : .logIn(account)) }
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("\(account.username), \(subtitle), \(account.connected ? "connected" : "not logged in")")
    }

    /// The workspace when the agent knows it; otherwise the person's full name, then the state.
    private var subtitle: String {
        if let host = account.workspaceHost { return host }
        if !account.fullName.isEmpty, account.fullName != account.username { return account.fullName }
        return account.connected ? "Signed in" : "Signed out"
    }
}

struct Avatar: View {
    let name: String

    private var initials: String {
        let parts = name.split(whereSeparator: { $0 == " " || $0 == "." || $0 == "_" || $0 == "-" })
        let letters = parts.prefix(2).compactMap(\.first)
        return String(letters.isEmpty ? Array(name.prefix(1)) : letters).uppercased()
    }

    var body: some View {
        Text(initials)
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(.white)
            .frame(width: PanelMetrics.avatar, height: PanelMetrics.avatar)
            .background(Circle().fill(LinearGradient(colors: [Color.panelAccent, Color(red: 0x6E / 255, green: 0x59 / 255, blue: 0xA5 / 255)], startPoint: .topLeading, endPoint: .bottomTrailing)))
    }
}

struct EmptyRow: View {
    @ObservedObject var model: PanelModel

    var body: some View {
        VStack(spacing: 10) {
            if !model.loaded {
                ProgressView().controlSize(.small)
            } else if !model.search.isEmpty {
                Text("No account matches “\(model.search)”").foregroundColor(.panelSecondary)
            } else {
                Text("No accounts on this Mac yet").foregroundColor(.panelText)
                Button("Create or join a workspace") { model.perform(.createWorkspace) }
                    .buttonStyle(.borderedProminent).tint(.panelAccent).controlSize(.small)
            }
        }
        .font(.system(size: 14))
        .frame(maxWidth: .infinity)
        .frame(height: PanelMetrics.row * 1.5)
    }
}

/// The agent's own state, in one line, with Restart when it has given up.
struct AgentFooter: View {
    @ObservedObject var model: PanelModel

    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(colour).frame(width: 7, height: 7)
            Text(words).font(.system(size: 12)).foregroundColor(.panelSecondary).lineLimit(1)
            Spacer()
            if case .failed = model.agent {
                Button("Restart") { model.perform(.restartAgent) }.controlSize(.small)
            }
        }
        .padding(.horizontal, PanelMetrics.padding)
    }

    private var words: String {
        switch model.agent {
        case .starting: return "Starting the agent…"
        case .running: return "Agent running on this Mac"
        case .external: return "Using the agent already running on this Mac"
        case .failed(let why): return why
        }
    }

    private var colour: Color {
        switch model.agent {
        case .running, .external: return .panelConnected
        case .starting: return .panelSecondary
        case .failed: return .red
        }
    }
}

struct SearchField: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundColor(.panelSecondary)
            TextField("Search", text: $text).textFieldStyle(.plain).font(.system(size: 14)).foregroundColor(.panelText)
            if !text.isEmpty {
                Button { text = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundColor(.panelSecondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 32)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.panelRow))
        .padding(.horizontal, PanelMetrics.padding)
    }
}

struct Hairline: View {
    var body: some View { Rectangle().fill(Color.panelHairline).frame(height: 1) }
}
