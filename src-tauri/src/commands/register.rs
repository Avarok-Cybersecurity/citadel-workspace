// use crate::commands::send_to_internal_service;
use citadel_internal_service_types::{
    InternalServiceRequest, InternalServiceResponse, SessionSecuritySettings,
};
use citadel_types::crypto::{
    AlgorithmsExt, CryptoParameters, EncryptionAlgorithm, KemAlgorithm, SecrecyMode, SigAlgorithm,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::str::FromStr;
use tauri::State;
use uuid::Uuid;

use crate::state::WorkspaceState;
use crate::util::local_db::LocalDb;

use super::send_and_recv;

#[allow(non_snake_case)]
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RegistrationRequestTS {
    pub workspaceIdentifier: String,
    pub workspacePassword: String,
    pub securityLevel: u8,
    pub securityMode: u8,
    pub encryptionAlgorithm: u8,
    pub kemAlgorithm: u8,
    pub sigAlgorithm: u8,
    pub fullName: String,
    pub username: String,
    pub profilePassword: String,
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize, Serialize)]
pub struct RegistrationResponseTS {
    message: String,
    success: bool,
}

#[tauri::command]
pub async fn register(
    request: RegistrationRequestTS,
    state: State<'_, WorkspaceState>,
) -> Result<RegistrationResponseTS, String> {
    println!("Registering to {}...", request.workspaceIdentifier);

    let server_addr = SocketAddr::from_str(&request.workspaceIdentifier)
        .map_err(|_| format!("Invalid server address: {}", &request.workspaceIdentifier))?;
    let request_id = Uuid::new_v4();
    let request_copy = request.clone();

    let crypto_params = CryptoParameters {
        encryption_algorithm: EncryptionAlgorithm::from_u8(request.encryptionAlgorithm).unwrap(),
        kem_algorithm: KemAlgorithm::from_u8(request.kemAlgorithm).unwrap(),
        sig_algorithm: SigAlgorithm::from_u8(request.sigAlgorithm).unwrap(),
    };

    let security_settings = SessionSecuritySettings {
        security_level: request.securityLevel.into(),
        // secrecy_mode: request.securityMode.into(),
        secrecy_mode: SecrecyMode::try_from(request.securityMode).unwrap(),
        crypto_params,
        header_obfuscator_settings: Default::default(),
    };

    let server_password: Option<_> = match request.workspacePassword.trim().len() {
        0 => None,
        _ => Some(request.workspacePassword.into()),
    };

    let internal_request = InternalServiceRequest::Register {
        request_id,
        server_addr,
        full_name: request.fullName,
        username: request.username,
        proposed_password: request.profilePassword.into_bytes().into(),
        connect_after_register: true,
        session_security_settings: security_settings,
        server_password,
    };

    // Support all 4 types of responses to accomudate connect_after_register as true/false
    let response = match send_and_recv(internal_request, request_id, &state).await {
        InternalServiceResponse::RegisterSuccess(..)
        | InternalServiceResponse::ConnectSuccess(..) => {
            println!("Registration was successful");
            RegistrationResponseTS {
                message: "Successful registration".to_owned(),
                success: true,
            }
        }
        InternalServiceResponse::RegisterFailure(err) => {
            println!("Registration failed: {}", err.message);
            RegistrationResponseTS {
                message: err.message,
                success: false,
            }
        }
        InternalServiceResponse::ConnectFailure(err) => {
            println!("Registration failed: {}", err.message);
            RegistrationResponseTS {
                message: err.message,
                success: false,
            }
        }
        other => {
            panic!(
                "Internal service returned unexpected type '{}' during registration",
                std::any::type_name_of_val(&other)
            )
        }
    };

    if response.success {
        let db = LocalDb::connect_global(&state);
        let registration_info = request_copy.into();
        db.save_registration(&registration_info)
            .await
            .expect("failed to save registration");
    }

    Ok(response)
}
