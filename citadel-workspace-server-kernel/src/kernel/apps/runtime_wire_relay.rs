//! TEST: the relay half of the shared runtime-wire fixture: the stream-id bit only the relay
//! allocates, the advertisement window, and the address a response goes back to.

use super::ihttp_relay::{MAX_ADVERT_MS, RELAY_STREAM_BIT};
use citadel_workspace_types::apps_protocol::{IhttpAddress, IhttpFrom};
use serde_json::{json, Value};

pub(super) fn relay() -> Value {
    json!({
        "stream_bit": RELAY_STREAM_BIT.to_string(),
        "max_advert_ms": MAX_ADVERT_MS,
    })
}

/// A frame the relay pushed names its sender; a frame back on that stream is addressed to them.
pub(super) fn addressing() -> Value {
    let from = IhttpFrom {
        username: "alice".into(),
        cid: 10,
        app_id: "com.acme.notes".into(),
        install_id: "inst-a".into(),
    };
    let back = IhttpAddress::User {
        app_id: from.app_id.clone(),
        username: from.username.clone(),
    };
    json!([{
        "from": serde_json::to_value(&from).expect("json"),
        "reply_to": serde_json::to_value(&back).expect("json"),
    }])
}
