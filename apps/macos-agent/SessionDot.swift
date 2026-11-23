import Foundation

/// The dot beside an account's row, as the agent names it (`SessionInformation.dot`,
/// `SignedOutSession.dot`). The agent decides which; this app only draws it.
///
/// Yellow is an account whose resume credential has run out or was refused: it is, or soon will
/// be, signed out, and needs its user to sign in again.
enum SessionDot: String, Equatable {
    case green
    case yellow

    /// The dot for an account. An agent that names none (one older than the field) marks a
    /// connected account green, as this app always drew it, and a signed-out one not at all.
    static func of(named: String?, connected: Bool) -> SessionDot? {
        named.flatMap(SessionDot.init(rawValue:)) ?? (connected ? .green : nil)
    }

    /// What `GetSessionsResponse` names for each account: its sessions' dots, and the dots of
    /// the accounts it lists as signed out.
    static func named(inSessionsReply body: [String: Any]) -> [UInt64: String] {
        var out: [UInt64: String] = [:]
        for key in ["signed_out", "sessions"] {
            for entry in body[key] as? [[String: Any]] ?? [] {
                guard let cid = (entry["cid"] as? NSNumber)?.uint64Value, let dot = entry["dot"] as? String else { continue }
                out[cid] = dot
            }
        }
        return out
    }

    /// What the row says beside the dot of a connected account.
    var label: String {
        switch self {
        case .green: return "Connected"
        case .yellow: return "Sign in needed"
        }
    }
}
