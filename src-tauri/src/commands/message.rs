use crate::commands::send_to_internal_service;
use crate::structs::ConnectionState;
use citadel_internal_service_types::InternalServiceRequest::Message;
use tauri::State;
use uuid::Uuid;

#[derive(serde::Deserialize, serde::Serialize, Debug)]
pub struct CWMEssage {
    pub message: String,
}

impl CWMEssage {
    pub fn new(message: String) -> Self {
        Self { message }
    }
}

#[tauri::command]
pub async fn message(
    message: String,
    cid: String,
    peer_cid: Option<String>,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    println!("message: {:?}", message);
    println!("cid: {:?}", cid);
    println!("peer_cid: {:?}", peer_cid);
    let request_id = Uuid::new_v4();
    let request = Message {
        message: bincode2::serialize(&CWMEssage::new(message)).unwrap(),
        cid: cid.parse().unwrap(),
        peer_cid: if let Some(cid) = peer_cid {
            Some(cid.parse().unwrap())
        } else {
            None
        },
        security_level: Default::default(),
        request_id,
    };

    send_to_internal_service(request, state).await?;
    Ok(request_id.to_string())
}
