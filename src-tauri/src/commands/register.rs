use crate::state::WorkspaceState;
use crate::types::{RegisterFailureTS, RegisterSuccessTS, RegistrationRequestTS};
use crate::util::RegistrationInfo;
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use citadel_types::crypto::{EncryptionAlgorithm, KemAlgorithm, SigAlgorithm};
use std::net::SocketAddr;
use std::str::FromStr;
use tauri::State;
use uuid::Uuid;

use super::send_and_recv;

#[tauri::command]
pub async fn register(
    request: RegistrationRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<RegisterSuccessTS, RegisterFailureTS> {
    let request_id = Uuid::new_v4();

    // Create registration info from the request
    let info = RegistrationInfo {
        server_address: request.workspace_identifier.clone(),
        server_password: if request.workspace_password.trim().is_empty() {
            None
        } else {
            Some(request.workspace_password.clone())
        },
        security_level: request.security_level,
        security_mode: request.security_mode,

        // Use default values for algorithm types for now since
        // the actual enum variants are not visible here
        encryption_algorithm: EncryptionAlgorithm::default() as u8,
        kem_algorithm: KemAlgorithm::default() as u8,
        sig_algorithm: SigAlgorithm::default() as u8,

        full_name: request.full_name.clone(),
        username: request.username.clone(),
        profile_password: request.profile_password.clone(),
    };

    // Convert to an internal service request
    // Parse the server address or use a fallback
    let server_addr = match SocketAddr::from_str(&info.server_address) {
        Ok(addr) => addr,
        Err(_) => {
            // Fallback to a default value or return an error
            return Err(RegisterFailureTS {
                cid: Default::default(),
                message: format!("Invalid server address: {}", info.server_address),
                request_id: Some(request_id.to_string()),
            });
        }
    };

    let payload = InternalServiceRequest::Register {
        request_id,
        server_addr,
        full_name: info.full_name,
        username: info.username,
        proposed_password: info.profile_password.into_bytes().into(),
        connect_after_register: true,
        session_security_settings: Default::default(), // Use default settings for now
        server_password: info.server_password.map(|p| p.into()),
    };

    // Send the registration request and wait for a response
    let response = send_and_recv(payload, request_id, &state).await;

    // Handle the response
    match response {
        InternalServiceResponse::RegisterSuccess(success) => {
            println!("Registration successful");
            Ok(RegisterSuccessTS {
                cid: success.cid.to_string(),
                request_id: success.request_id.map(|id| id.to_string()),
            })
        }
        InternalServiceResponse::RegisterFailure(failure) => {
            println!("Registration failed: {}", failure.message);
            Err(RegisterFailureTS {
                cid: Default::default(), // Using a default value since we don't have a CID yet
                message: failure.message,
                request_id: failure.request_id.map(|id| id.to_string()),
            })
        }
        other => {
            let error_msg = format!("Unexpected response from internal service: {:?}", other);
            println!("{}", error_msg);
            Err(RegisterFailureTS {
                cid: Default::default(),
                message: error_msg,
                request_id: Some(request_id.to_string()),
            })
        }
    }
}
