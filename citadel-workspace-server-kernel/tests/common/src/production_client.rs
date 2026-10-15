//! Talking to the production server over a real SDK channel.

use citadel_sdk::prelude::*;
use citadel_workspace_types::{
    WorkspaceProtocolPayload, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use futures::StreamExt;
use std::time::Duration;

/// Sends `request` until a response `accept` takes, retrying on `Error`:
/// enrolment runs on its own task after ConnectSuccess, so the first ask can
/// land before the record exists.
pub async fn ask<R: Ratchet, T>(
    tx: &mut PeerChannelSendHalf<R>,
    rx: &mut PeerChannelRecvHalf<R>,
    request: WorkspaceProtocolRequest,
    accept: impl Fn(WorkspaceProtocolResponse) -> Option<T>,
) -> Result<T, NetworkError> {
    for _ in 0..50 {
        let payload = WorkspaceProtocolPayload::Request(request.clone());
        tx.send(serde_json::to_vec(&payload).expect("encode"))
            .await?;
        while let Some(bytes) = rx.next().await {
            let Ok(WorkspaceProtocolPayload::Response(response)) =
                serde_json::from_slice::<WorkspaceProtocolPayload>(bytes.as_ref())
            else {
                continue;
            };
            if matches!(*response, WorkspaceProtocolResponse::Error(_)) {
                break;
            }
            if let Some(found) = accept(*response) {
                return Ok(found);
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(NetworkError::msg("the server never gave the wanted answer"))
}
