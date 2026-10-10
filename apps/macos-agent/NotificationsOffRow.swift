import SwiftUI

/// Shown only while macOS has notifications denied for this app: a quiet line and the way to the
/// switch, since nothing the agent raises can be seen until it is turned back on.
struct NotificationsOffRow: View {
    let perform: (PanelAction) -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "bell.slash").font(.system(size: 16)).foregroundColor(.panelSecondary)
            Text("Notifications are off").font(.system(size: 13)).foregroundColor(.panelSecondary).lineLimit(1)
            Spacer(minLength: 8)
            Button("Open Settings") { perform(.openNotificationSettings) }.controlSize(.small)
        }
        .padding(.horizontal, PanelMetrics.padding)
        .frame(height: PanelMetrics.notifications)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Notifications are off")
    }
}
