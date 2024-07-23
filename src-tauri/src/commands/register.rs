// use crate::commands::send_to_internal_service;
use citadel_internal_service_types::{
    InternalServiceRequest, InternalServiceResponse, SecBuffer, SessionSecuritySettings,
};
use citadel_types::crypto::{
    AlgorithmsExt, CryptoParameters, EncryptionAlgorithm, KemAlgorithm, SigAlgorithm,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::str::FromStr;
use tauri::State;
use uuid::Uuid;

use crate::structs::ConnectionState;

use super::send_and_recv;

#[allow(non_snake_case)]
#[derive(Debug, Deserialize, Serialize)]
pub struct RegistrationRequestTS {
    workspaceIdentifier: String,
    workspacePassword: String,
    securityLevel: u8,
    securityMode: u8,
    encryptionAlgorithm: u8,
    kemAlgorithm: u8,
    sigAlgorithm: u8,
    fullName: String,
    username: String,
    profilePassword: String,
}

#[allow(non_snake_case)]
#[derive(Debug, Deserialize, Serialize)]
pub struct RegistrationResponseTS {
    message: String,
    success: bool,
    cid: Option<String>
}

#[tauri::command]
pub async fn register(
    request: RegistrationRequestTS,
    _window: tauri::Window,
    state: State<'_, ConnectionState>,
) -> Result<RegistrationResponseTS, String> {
    let server_addr =
        SocketAddr::from_str(&request.workspaceIdentifier).expect("Invalid server address");
    let request_id = Uuid::new_v4();

    let crypto_params = CryptoParameters {
        encryption_algorithm: EncryptionAlgorithm::from_u8(request.encryptionAlgorithm).unwrap(),
        kem_algorithm: KemAlgorithm::from_u8(request.kemAlgorithm).unwrap(),
        sig_algorithm: SigAlgorithm::from_u8(request.sigAlgorithm).unwrap(),
    };

    let security_settings = SessionSecuritySettings {
        security_level: request.securityLevel.into(),
        secrecy_mode: request.securityMode.into(),
        crypto_params,
    };

    let server_password: Option<_> = match request.workspacePassword.trim().len() {
        0 => None,
        _ => Some(request.workspacePassword.into())
    };

    let internal_request = InternalServiceRequest::Register {
        request_id,
        server_addr,
        full_name: request.fullName,
        username: request.username,
        proposed_password: SecBuffer::empty(), // TODO @kyle-tennison: Proposed password is not prompted in current UI
        connect_after_register: true,
        session_security_settings: security_settings,
        server_password: server_password.into()
    };

    let response = send_and_recv(internal_request, request_id, state).await?;

    Ok(match response {
        InternalServiceResponse::RegisterSuccess(_) => {
            println!("Registration was successful, but no connection was made");
            RegistrationResponseTS {
                message: "Successful registration, but no connection".to_owned(),
                success: false,
                cid: None,
            }
        }
        InternalServiceResponse::RegisterFailure(err) => {
            println!("Registration failed: {}", err.message);
            RegistrationResponseTS {
                message: err.message,
                success: false,
                cid: None,
            }
        },
        InternalServiceResponse::ConnectSuccess(r) => {
            println!("Connection successful");
            RegistrationResponseTS {
                message: "Connected".to_owned(),
                success: true,
                cid: Some(r.cid.to_string())
            }
        },
        InternalServiceResponse::ConnectFailure(err) => {
            println!("Connection failed: {}", err.message);
            RegistrationResponseTS{
                message: err.message,
                success: false,
                cid: None
            }
        }
        unknown => {
            eprintln!(
                "Internal service responded with an illegal response type <{}>:\n{:#?}",
                std::any::type_name_of_val(&unknown),
                unknown
            );
            RegistrationResponseTS {
                message: "Internal Error".to_owned(),
                success: false,
                cid: None,
            }
        }
    })
}
