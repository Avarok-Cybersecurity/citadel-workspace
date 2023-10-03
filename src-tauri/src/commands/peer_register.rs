use citadel_workspace_types::{InternalServiceRequest::PeerRegister, UserIdentifier};
use futures::SinkExt;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

#[tauri::command]
pub async fn peer_register(
    my_cid: String,
    peer_cid: String,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    let request_id = Uuid::new_v4();
    let payload = PeerRegister {
        request_id,
        cid: my_cid.parse::<u64>().unwrap(),
        peer_id: UserIdentifier::ID(peer_cid.parse::<u64>().unwrap()),
        connect_after_register: false,
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
        Err("Unable to Register to the peer".to_string())
    }
}
