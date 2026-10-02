import SwiftUI

/// "Citadel Agent X.Y.Z is available", above the agent's own line, with Restart to update when
/// the agent has it downloaded and verified, or Download when it can only link out.
struct UpdateRow: View {
    let update: AgentUpdate
    let perform: (PanelAction) -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "arrow.down.circle.fill").font(.system(size: 18)).foregroundColor(.panelAccent)
            VStack(alignment: .leading, spacing: 2) {
                Text("Citadel Agent \(update.latest) is available")
                    .font(.system(size: 13, weight: .medium)).foregroundColor(.panelText).lineLimit(1)
                Text(update.ready ? "Restarting signs every account out until it signs in again." : "You are on \(update.current).")
                    .font(.system(size: 11)).foregroundColor(.panelSecondary).lineLimit(2)
            }
            Spacer(minLength: 8)
            if update.ready {
                Button("Restart to update") { perform(.installUpdate) }
                    .buttonStyle(.borderedProminent).tint(.panelAccent).controlSize(.small)
            } else {
                Button("Download") { perform(.openURL(update.downloadURL)) }.controlSize(.small)
            }
        }
        .padding(.horizontal, PanelMetrics.padding)
        .frame(height: PanelMetrics.update)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Citadel Agent \(update.latest) is available")
    }
}
