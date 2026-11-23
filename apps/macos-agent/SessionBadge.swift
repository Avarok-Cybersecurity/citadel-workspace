import SwiftUI

extension SessionDot {
    var colour: Color {
        switch self {
        case .green: return .panelConnected
        case .yellow: return .panelAttention
        }
    }
}

/// A connected account's dot and what it means, in the dot's colour.
struct SessionBadge: View {
    let dot: SessionDot

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(dot.colour).frame(width: 8, height: 8)
            Text(dot.label).font(.system(size: 12, weight: .medium)).foregroundColor(dot.colour)
        }
        .accessibilityElement(children: .combine)
    }
}
