//! The app's fixed parts: its toolbar, and what one worker's outcome tells the pool.

use citadel_app_sdk::ihttp::{Outcome, Via};
use citadel_app_sdk::types::calls::ToolbarItem;
use citadel_app_sdk::types::decode;
use compute_pool_core::wire::ChunkResults;

pub(crate) fn toolbar() -> Vec<ToolbarItem> {
    let item = |id: &str, label: &str| ToolbarItem {
        id: id.into(),
        label: label.into(),
        icon_name: None,
    };
    vec![
        item("run-primes", "Run: count primes"),
        item("run-sha", "Run: SHA-256 chains"),
        item("mode-prefer", "P2P, then relay"),
        item("mode-p2p", "P2P only"),
        item("mode-relay", "Relay only"),
    ]
}

/// Opens the pool's topic; the pool hears whether it is in (`joined`) or why not (and retries).

/// What one worker's outcome tells the pool.
pub(crate) fn answer_of(outcome: &Outcome, planned: Via) -> (Result<ChunkResults, String>, Via) {
    match outcome {
        Outcome::Ok(r) if r.head.status == 200 => (
            decode::<ChunkResults>(&r.body).map_err(|_| "unreadable answer".into()),
            r.via,
        ),
        Outcome::Ok(r) => (Err(format!("status {}", r.head.status)), r.via),
        Outcome::Failed(refused) => (Err(format!("{refused:?}")), planned),
        Outcome::Skipped => (Err("skipped".into()), planned),
    }
}
