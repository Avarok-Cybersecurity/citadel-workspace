// use crate::commands::send_to_internal_service;
use citadel_internal_service_types::InternalServiceRequest;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::str::FromStr;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;


#[allow(non_snake_case)]
#[derive(Debug, Deserialize, Serialize)]
struct RegistrationRequestTS{
    workspaceIdentifier: Option<String>,
    workspacePassword: Option<String>,
    securityLevel: Option<usize>,
    securityMode: Option<usize>,
    encryptionAlgorithm: Option<usize>,
    kemAlgorithm: Option<usize>,
    sigAlgorithm: Option<usize>,
    fullName: Option<String>,
    username: Option<String>,
    profilePassword: Option<String>,
}


#[tauri::command]
pub async fn register(
    request: RegistrationRequestTS,
    _window: tauri::Window,
    state: State<'_, ConnectionState>,
) -> Result<String, String> {
    let server_addr = SocketAddr::from_str(&server_addr).map_err(|_| "Invalid server address")?;
    let request_id = Uuid::new_v4();
    let request = InternalServiceRequest::Register {
        request_id,
        server_addr,
        full_name,
        username: username.clone(),
        proposed_password: proposed_password.into_bytes().into(),
        connect_after_register: true,
        session_security_settings: Default::default(),
        server_password: None,
    };

    send_to_internal_service(request, state).await?;
    Ok(request_id.to_string())
}
