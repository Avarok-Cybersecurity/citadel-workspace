//! The audit line for every relayed internal-HTTP stream that opens or closes (design E6), pure:
//! who called whom, for which app and install, on which plane, how many body bytes, for how
//! long, and why it ended.

use super::ihttp_relay_types::{CloseReason, Endpoint, RelayRecord};

/// The kernel only ever relays; P2P streams never reach it.
pub const VIA: &str = "relay";

fn party(e: &Endpoint) -> String {
    format!("{}#{}", e.username, e.cid)
}

fn reason(closed: Option<CloseReason>) -> String {
    match closed {
        None => "-".to_string(),
        Some(CloseReason::Ended) => "ended".to_string(),
        Some(CloseReason::Cancelled(why)) => format!("cancel:{why:?}"),
        Some(CloseReason::Timeout) => "timeout".to_string(),
        Some(CloseReason::Closed) => "closed".to_string(),
        Some(CloseReason::Session) => "session".to_string(),
    }
}

/// `[APPS-IHTTP] open|close from=… to=… app=… install=… via=relay stream=… bytes=… ms=… reason=…`
pub fn audit_line(record: &RelayRecord) -> String {
    let event = if record.closed.is_some() {
        "close"
    } else {
        "open"
    };
    format!(
        "[APPS-IHTTP] {event} from={} to={} app={} install={} via={VIA} stream={} bytes={} ms={} reason={}",
        party(&record.client),
        party(&record.server),
        record.server.app_id,
        record.server.install_id,
        record.stream,
        record.bytes,
        record.ms,
        reason(record.closed),
    )
}
