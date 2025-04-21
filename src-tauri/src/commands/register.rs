use crate::state::WorkspaceState;
use crate::types::{RegisterFailureTS, RegistrationRequestTS, RegisterSuccessTS};
use crate::util::local_db::LocalDb;
use crate::util::RegistrationInfo;
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use log::error;
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

    // The TryFrom<RegistrationRequestTS> for RegistrationInfo should handle this conversion
    let info: RegistrationInfo = request.clone().try_into().map_err(|e| RegisterFailureTS {
        cid: "0".to_string(), // Placeholder CID needed for error
        message: e,
        request_id: Some(request_id.to_string()),
    })?;

    // Clone necessary fields before info is potentially moved in try_into
    let info_username_clone = info.username.clone();
    let info_full_name_clone = info.full_name.clone();

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
        full_name: info_full_name_clone, // Use the clone
        username: info_username_clone, // Use the clone
        proposed_password: info.profile_password.clone().into_bytes().into(),
        connect_after_register: true,
        session_security_settings: Default::default(), // Use default settings for now
        server_password: info.server_password.as_ref().map(|p| p.as_bytes().into()),
    };

    // Send the registration request and wait for a response
    let response = send_and_recv(payload, request_id, &state).await;

    // Handle the response
    match response {
        InternalServiceResponse::RegisterSuccess(success) => {
            println!("Registration successful");
            state.open_messenger_for(success.cid).await
                .map_err(|e| RegisterFailureTS {
                    cid: success.cid.to_string(),
                    message: e.to_string(),
                    request_id: Some(request_id.to_string()),
                })?;
            if let Err(err) = LocalDb::global(&state).save_registration(&info).await {
                error!(target: "citadel", "Registration OK but failed to save info: {:?} for CID: {}", err, success.cid);
                Err(RegisterFailureTS {
                    cid: success.cid.to_string(),
                    message: format!("Registration succeeded but failed to save info locally: {}", err),
                    request_id: Some(request_id.to_string()),
                })
            } else {
                Ok(RegisterSuccessTS {
                    cid: success.cid.to_string(),
                    request_id: Some(request_id.to_string()),
                })
            }
        }
        InternalServiceResponse::ConnectSuccess(success) => {
            // Also treat ConnectSuccess as a success case since connect_after_register is true
            println!("Registration and connection successful");
            state.open_messenger_for(success.cid).await
                .map_err(|e| RegisterFailureTS {
                    cid: success.cid.to_string(),
                    message: e.to_string(),
                    request_id: Some(request_id.to_string()),
                })?;
            if let Err(err) = LocalDb::global(&state).save_registration(&info).await {
                error!(target: "citadel", "Failed to save registration info to local DB after successful registration: {:?}", err);
            }

            Ok(RegisterSuccessTS {
                cid: success.cid.to_string(),
                request_id: Some(request_id.to_string()),
            })
        }
        InternalServiceResponse::RegisterFailure(failure) => {
            println!("Registration failed: {}", failure.message);
            Err(RegisterFailureTS {
                cid: failure.cid.to_string(),
                message: failure.message,
                request_id: Some(request_id.to_string()),
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
