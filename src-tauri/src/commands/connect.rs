use crate::util::RegistrationInfo;
use citadel_internal_service_types::InternalServiceRequest::Connect;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::send_and_recv;
use crate::structs::ConnectionState;
use citadel_internal_service_types::{InternalServiceResponse, SessionSecuritySettings};
use citadel_types::crypto::{
    AlgorithmsExt, CryptoParameters, EncryptionAlgorithm, KemAlgorithm, SigAlgorithm,
};
use uuid::Uuid;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[allow(non_snake_case)]
pub struct ConnectRequestTS {
    pub registrationInfo: RegistrationInfo,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConnectResponseTS {
    pub cid: Option<String>,
    pub success: bool,
    pub message: String,
}

#[tauri::command]
pub async fn connect(
    request: ConnectRequestTS,
    state: State<'_, ConnectionState>,
) -> Result<ConnectResponseTS, String> {
    println!(
        "Connecting to {}...",
        request.registrationInfo.server_address
    );

    let registration_info = request.registrationInfo;
    let request_id = Uuid::new_v4();

    let crypto_params = CryptoParameters {
        encryption_algorithm: EncryptionAlgorithm::from_u8(registration_info.encryption_algorithm)
            .unwrap(),
        kem_algorithm: KemAlgorithm::from_u8(registration_info.kem_algorithm).unwrap(),
        sig_algorithm: SigAlgorithm::from_u8(registration_info.sig_algorithm).unwrap(),
    };

    let security_settings = SessionSecuritySettings {
        security_level: registration_info.security_level.into(),
        secrecy_mode: registration_info.security_mode.into(),
        crypto_params,
    };

    let payload = Connect {
        username: registration_info.username,
        password: registration_info.profile_password.into_bytes().into(),
        connect_mode: Default::default(),
        udp_mode: Default::default(),
        keep_alive_timeout: Default::default(),
        session_security_settings: security_settings,
        request_id,
        server_password: registration_info
            .server_password
            .map(|pass| pass.into_bytes().into()),
    };

    let response = send_and_recv(payload, request_id, &state).await;

    match response {
        InternalServiceResponse::ConnectSuccess(r) => {
            println!("Connection successful");
            Ok(ConnectResponseTS {
                cid: Some(r.cid.to_string()),
                success: true,
                message: "Success".to_owned(),
            })
        }
        InternalServiceResponse::ConnectFailure(err) => {
            println!("Connection failure: {:#?}", err);
            Ok(ConnectResponseTS {
                cid: None,
                success: false,
                message: err.message,
            })
        }
        other => {
            panic!(
                "Internal service returned unexpected type '{}' during connection",
                std::any::type_name_of_val(&other)
            )
        }
    }
}
