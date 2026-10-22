//! Frames the apps relay addresses to one session reach that session and no other.

use super::test_ihttp::{ALICE, BOB};
use super::test_manifests::*;
use crate::kernel::async_kernel::BroadcastAudience;

#[tokio::test]
async fn a_frame_for_one_session_reaches_that_session_only() {
    let kernel = workspace_serving(wasm(1, 4096)).await;
    let to_bob = BroadcastAudience::Session(BOB);
    assert!(kernel.may_receive_at(BOB, "bob", &to_bob).await);
    assert!(!kernel.may_receive_at(ALICE, "bob", &to_bob).await);
    assert!(!kernel.may_receive("bob", &to_bob).await);
}
