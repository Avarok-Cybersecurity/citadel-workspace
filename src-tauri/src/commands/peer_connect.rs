use citadel_workspace_types::{InternalServiceRequest::PeerConnect, UserIdentifier};
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn peer_connect(
    peer_username: String,
    my_cid: String,
    my_username: String,
    peer_cid: String,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    let request_id = Uuid::new_v4();
    let payload = PeerConnect {
        request_id,
        cid: my_cid.parse::<u64>().unwrap(),
        username: my_username,
        peer_cid: peer_cid.parse().unwrap(),
        peer_username,
        udp_mode: Default::default(),
        session_security_settings: Default::default(),
    };

    if state
        .sink
        .lock()
        .await
        .as_mut()
        .unwrap()
        .send(bincode2::serialize(&payload).unwrap().into())
        .await
        .is_ok()
    {
        Ok(request_id.to_string())
    } else {
        Err("Unable to Connect to the peer".to_string())
    }
}
