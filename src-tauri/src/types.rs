// types.rs
//
// Central location for all data structure type definitions used in communication
// between the Rust backend and TypeScript frontend.

// Common type definitions for TypeScript-Rust interop
use citadel_internal_service_types::{ConnectMode, InternalServiceRequest};
use citadel_types::crypto::{
    CryptoParameters, EncryptionAlgorithm, HeaderObfuscatorSettings, KemAlgorithm, 
    PreSharedKey, 
    SecrecyMode, SecurityLevel, SigAlgorithm, SecBuffer 
};
use citadel_types::proto::UdpMode as ProtoUdpMode;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::str::FromStr;
use std::time::Duration;

//
// Response Types
//

// Peer registration types
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerRegisterRequestTS {
    pub cid: String,
    pub peer_cid: String,
    pub username: String,
    pub password: Vec<u8>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListAllPeersFailureTS {
    pub cid: String,
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerDisconnectFailureTS {
    pub cid: String,
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerSessionInformationTS {
    pub cid: String,
    pub peer_cid: String,
    pub peer_username: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionInformationTS {
    pub cid: String,
    pub peer_connections: HashMap<String, PeerSessionInformationTS>, // Key is peer_cid (u64 as String)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GetSessionSuccessTS {
    pub request_id: Option<String>,
    pub sessions: Vec<SessionInformationTS>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalDBGetKVSuccessTS {
    pub cid: String,
    pub peer_cid: Option<String>,
    pub key: String,
    pub value: Vec<u8>,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalDBGetKVFailureTS {
    pub cid: String,
    pub peer_cid: Option<String>,
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalDBSetKVSuccessTS {
    pub cid: String,
    pub peer_cid: Option<String>,
    pub key: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalDBSetKVFailureTS {
    pub cid: String,
    pub peer_cid: Option<String>,
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalDBClearAllKVSuccessTS {
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalDBClearAllKVFailureTS {
    pub request_id: Option<String>,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalDBDeleteKVSuccessTS {
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalDBDeleteKVFailureTS {
    pub request_id: Option<String>,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalDBGetAllKVRequestTS {
    pub cid: String,
    pub peer_cid: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalDBGetAllKVSuccessTS {
    pub request_id: Option<String>,
    pub pairs: Vec<KVPairTS>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalDBGetAllKVFailureTS {
    pub request_id: Option<String>,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerRegisterFailureTS {
    pub request_id: Option<String>,
    pub message: String,
}

// List registered peers types
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListRegisteredPeersRequestTS {
    pub cid: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfoTS {
    pub cid: String,
    pub username: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListRegisteredPeersSuccessTS {
    pub request_id: Option<String>,
    pub peers: Vec<PeerInfoTS>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListRegisteredPeersFailureTS {
    pub request_id: Option<String>,
    pub message: String,
}

// Get Session types
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GetSessionRequestTS {}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfoTS {
    pub cid: String,
    pub username: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GetSessionFailureTS {
    pub request_id: Option<String>,
    pub message: String,
}

// PeerConnect Response type
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerConnectResponseTS {
    pub cid: String,
    pub peer_cid: String,
    pub request_id: Option<String>,
}

// List all peers types
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerInformationTS {
    pub cid: String,
    pub online_status: bool,
    pub name: Option<String>,
    pub username: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListAllPeersResponseTS {
    pub cid: String,
    pub peers: HashMap<String, PeerInformationTS>,
    pub request_id: Option<String>,
}

//
// Request Types
//

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequestTS {
    pub username: String,
    pub password: Vec<u8>,
    pub connect_mode: String, // Back to String
    pub udp_mode: String,     // Back to String
    pub keep_alive_timeout_ms: Option<u64>,
    pub session_security_settings: SessionSecuritySettingsTS,
    pub server_password: Option<Vec<u8>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DisconnectRequestTS {
    pub cid: String,
    pub peer_cid: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MessageRequestTS {
    pub message: Vec<u8>,
    pub cid: String,
    pub peer_cid: Option<String>,
    pub security_level: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationRequestTS {
    pub workspace_identifier: String,
    pub workspace_password: Option<String>, // Make this optional
    pub session_security_settings: SessionSecuritySettingsTS,
    pub full_name: String,
    pub username: String,
    pub profile_password: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionSecuritySettingsTS {
    pub security_level: String,
    pub secrecy_mode: String,
    pub encryption_algorithm: String,
    pub kem_algorithm: String,
    pub sig_algorithm: String,
    pub header_obfuscator_settings: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListKnownServersRequestTS {
    pub cid: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListKnownServersResponseTS {
    pub servers: Vec<RegistrationInfoTS>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationInfoTS {
    pub server_address: String,
    pub server_password: Option<String>,
    pub session_security_settings: SessionSecuritySettingsTS,
    pub full_name: String,
    pub username: String,
    pub profile_password: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PeerConnectRequestTS {
    pub cid: String,
    pub peer_cid: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerDisconnectRequestTS {
    pub cid: String,
    pub peer_cid: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ListAllPeersRequestTS {
    pub cid: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KVPairTS {
    pub key: String,
    pub value: String,
}

// Local DB types - needed by the commands
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalDBGetKVRequestTS {
    pub cid: String,
    pub peer_cid: Option<String>,
    pub key: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalDBSetKVRequestTS {
    pub cid: String,
    pub peer_cid: Option<String>,
    pub key: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalDBClearAllKVRequestTS {
    pub cid: String,
    pub peer_cid: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalDBDeleteKVRequestTS {
    pub cid: String,
    pub peer_cid: Option<String>,
    pub key: String,
}

// Add the new Success/Failure TS Struct Definitions here

// Connect Command Payloads
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectSuccessTS {
    pub cid: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectFailureTS {
    pub cid: String,
    pub peer_cid: Option<String>,
    pub message: String,
    pub request_id: Option<String>,
}

// Disconnect Command Payloads
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DisconnectSuccessTS {
    pub cid: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DisconnectFailureTS {
    pub cid: String,
    pub message: String,
    pub request_id: Option<String>,
}

// Message Command Payloads
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MessageSendSuccessTS {
    pub cid: String,
    pub peer_cid: Option<String>, // Note: Option<String>
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MessageSendFailureTS {
    pub cid: String,
    // Keeping the field for TS compatibility, but will be None from Rust where internal type lacks it
    pub peer_cid: Option<String>,
    pub message: String,
    pub request_id: Option<String>,
}

// Peer Connect Command Payloads
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerConnectSuccessTS {
    pub cid: String,
    pub peer_cid: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerConnectFailureTS {
    pub cid: String,
    pub peer_cid: Option<String>, // Field does not exist on internal type
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerDisconnectSuccessTS {
    pub cid: String,
    // Keeping the field for TS compatibility, but will be None from Rust where internal type lacks it
    // pub peer_cid: Option<String>, // Field does not exist on internal type
    pub request_id: Option<String>,
}

// Register Command Payloads
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RegisterSuccessTS {
    pub cid: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RegisterFailureTS {
    pub cid: String,
    pub message: String,
    pub request_id: Option<String>,
}

// Peer Register Command Payloads
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PeerRegisterSuccessTS {
    pub cid: String,
    pub implicated_cid: Option<String>,
    pub request_id: Option<String>,
}

// Type conversion helper functions

impl TryFrom<ConnectRequestTS> for InternalServiceRequest {
    type Error = String;

    fn try_from(ts_request: ConnectRequestTS) -> Result<Self, Self::Error> {
        let request_id = Uuid::new_v4();

        // Per user request, always default ConnectMode, ignoring the TS input
        let connect_mode = ConnectMode::Standard { force_login: true };

        // Use from_str for UdpMode, expecting "Disabled" or "Enabled" based on protocol_types.txt
        // EnumString derive is case-insensitive by default, but let's handle potential errors.
        let udp_mode = ProtoUdpMode::from_str(&ts_request.udp_mode).map_err(|e| {
            format!(
                "Invalid UdpMode string '{}'. Expected 'Disabled' or 'Enabled'. Error: {:?}",
                ts_request.udp_mode,
                e
            )
        })?;

        let keep_alive_timeout = ts_request.keep_alive_timeout_ms.map(Duration::from_millis);

        let session_security_settings: citadel_internal_service_types::SessionSecuritySettings = ts_request.session_security_settings.try_into()?;

        let server_password = match ts_request.server_password {
            Some(p_str) => Some(PreSharedKey::from(p_str)), // p_str is already Vec<u8> here
            None => None,
        };

        let password = ts_request.password.into();

        Ok(InternalServiceRequest::Connect {
            username: ts_request.username,
            password,
            connect_mode,
            udp_mode,
            keep_alive_timeout,
            session_security_settings,
            server_password,
            request_id,
        })
    }
}

impl TryFrom<PeerRegisterRequestTS> for InternalServiceRequest {
    type Error = String;

    fn try_from(ts_request: PeerRegisterRequestTS) -> Result<Self, Self::Error> {
        let cid = string_to_u64(&ts_request.cid).map_err(|e| format!("Invalid cid format: {}", e))?;
        let peer_cid = string_to_u64(&ts_request.peer_cid).map_err(|e| format!("Invalid peer_cid format: {}", e))?;

        Ok(InternalServiceRequest::PeerRegister {
            cid,
            peer_cid,
            request_id: Uuid::new_v4(),
            session_security_settings: Default::default(),
            connect_after_register: false,
            peer_session_password: None,
        })
    }
}

impl TryFrom<RegistrationRequestTS> for InternalServiceRequest {
    type Error = String;

    fn try_from(ts_request: RegistrationRequestTS) -> Result<Self, Self::Error> {
        // Convert SessionSecuritySettingsTS to SessionSecuritySettings
        let session_security_settings: citadel_internal_service_types::SessionSecuritySettings = ts_request.session_security_settings.try_into()?;

        // Parse server_address into SocketAddr
        let server_addr = SocketAddr::from_str(&ts_request.workspace_identifier)
            .map_err(|e| format!("Failed to parse server_address: {}", e))?;

        // Generate a new request ID
        let request_id = Uuid::new_v4();

        // Revert back to .map() now that workspace_password is Option<String>
        let server_password_opt = ts_request
            .workspace_password
            .map(|p_str| PreSharedKey::from(p_str.into_bytes()));

        Ok(InternalServiceRequest::Register {
            request_id,
            server_addr,
            full_name: ts_request.full_name,
            username: ts_request.username,
            proposed_password: SecBuffer::from(ts_request.profile_password.into_bytes()),
            connect_after_register: false, // Defaulting to false as before
            session_security_settings, // Already converted above
            server_password: server_password_opt,
        })
    }
}

// Utility functions
// Convert from Typescript-friendly string representations to Rust native types
pub fn string_to_u64(s: &str) -> Result<u64, String> {
    s.parse().map_err(|e| format!("Invalid u64 string '{}': {:?}", s, e))
}

pub fn string_to_uuid(s: &str) -> Result<Uuid, String> {
    Uuid::parse_str(s).map_err(|e| format!("Invalid UUID string '{}': {:?}", s, e))
}

// Convert SessionSecuritySettingsTS to the internal service version
impl TryFrom<SessionSecuritySettingsTS> for citadel_internal_service_types::SessionSecuritySettings {
    type Error = String;

    fn try_from(ts: SessionSecuritySettingsTS) -> Result<Self, Self::Error> {
        let security_level = SecurityLevel::from_str(&ts.security_level)
            .map_err(|e| format!("Invalid security_level '{}': {:?}", ts.security_level, e))?;

        let secrecy_mode = SecrecyMode::from_str(&ts.secrecy_mode)
            .map_err(|e| format!("Invalid secrecy_mode '{}': {:?}", ts.secrecy_mode, e))?;

        let encryption_algorithm = EncryptionAlgorithm::from_str(&ts.encryption_algorithm)
            .map_err(|e| format!("Invalid encryption_algorithm '{}': {:?}", ts.encryption_algorithm, e))?;

        let kem_algorithm = KemAlgorithm::from_str(&ts.kem_algorithm)
            .map_err(|e| format!("Invalid kem_algorithm '{}': {:?}", ts.kem_algorithm, e))?;

        let sig_algorithm = SigAlgorithm::from_str(&ts.sig_algorithm)
            .map_err(|e| format!("Invalid sig_algorithm '{}': {:?}", ts.sig_algorithm, e))?;

        // Assuming HeaderObfuscatorSettings parsing logic is still needed and correct
        let header_obfuscator_settings = match ts.header_obfuscator_settings.get("mode").map(|s| s.as_str()) {
            Some("disabled") => HeaderObfuscatorSettings::Disabled,
            Some("enabled") => HeaderObfuscatorSettings::Enabled,
            Some("enabled_with_key") => {
                let key_str = ts.header_obfuscator_settings.get("key").ok_or("Missing 'key' for enabled_with_key mode")?;
                let key = key_str.parse::<u128>().map_err(|e| format!("Invalid key value: {:?}", e))?;
                HeaderObfuscatorSettings::EnabledWithKey(key)
            }
            None => HeaderObfuscatorSettings::default(), // Default if mode is missing or consider error
            Some(other) => return Err(format!("Invalid mode '{}' in header_obfuscator_settings", other)),
        };

        // Construct the internal_service_types::SessionSecuritySettings variant
        Ok(citadel_internal_service_types::SessionSecuritySettings {
            security_level,
            secrecy_mode,
            crypto_params: CryptoParameters {
                encryption_algorithm,
                kem_algorithm,
                sig_algorithm,
            },
            header_obfuscator_settings,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*; // Import items from outer scope
    use citadel_internal_service_types::InternalServiceRequest;
    use std::collections::HashMap;

    #[test]
    fn test_string_to_u64_valid() {
        assert_eq!(string_to_u64("1234567890123456789").unwrap(), 1234567890123456789);
    }

    #[test]
    fn test_string_to_u64_invalid() {
        assert!(string_to_u64("not_a_number").is_err());
        assert!(string_to_u64("").is_err());
        assert!(string_to_u64("1234567890123456789012345").is_err()); // Too large
    }

    #[test]
    fn test_string_to_uuid_valid() {
        let uuid_str = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
        let expected_uuid = Uuid::parse_str(uuid_str).unwrap();
        assert_eq!(string_to_uuid(uuid_str).unwrap(), expected_uuid);
    }

    #[test]
    fn test_string_to_uuid_invalid() {
        assert!(string_to_uuid("not-a-uuid").is_err());
        assert!(string_to_uuid("").is_err());
    }

    #[test]
    fn test_peer_register_request_ts_try_into() {
        let ts_request = PeerRegisterRequestTS {
            cid: "123".to_string(),
            peer_cid: "456".to_string(),
            username: "test_user".to_string(),
            password: vec![1, 2, 3],
        };

        let result: Result<InternalServiceRequest, String> = ts_request.try_into();
        assert!(result.is_ok());

        if let Ok(InternalServiceRequest::PeerRegister { cid, peer_cid, request_id: _, session_security_settings: _, connect_after_register: _, peer_session_password: _ }) = result {
            assert_eq!(cid, 123);
            assert_eq!(peer_cid, 456);
        } else {
            panic!("Conversion did not result in InternalServiceRequest::PeerRegister");
        }
    }

    #[test]
    fn test_peer_register_request_ts_try_into_invalid_cid() {
        let ts_request = PeerRegisterRequestTS {
            cid: "abc".to_string(),
            peer_cid: "456".to_string(),
            username: "test_user".to_string(),
            password: vec![1, 2, 3],
        };

        let result: Result<InternalServiceRequest, String> = ts_request.try_into();
        assert!(result.is_err());
    }

    #[test]
    fn test_connect_request_ts_try_into() {
        let ts_request = ConnectRequestTS {
            username: "test_user".to_string(),
            password: vec![1, 2, 3],
            connect_mode: "standard".to_string(),
            udp_mode: "Disabled".to_string(), 
            keep_alive_timeout_ms: Some(1000),
            session_security_settings: SessionSecuritySettingsTS {
                security_level: "High".to_string(),
                secrecy_mode: "Perfect".to_string(),
                encryption_algorithm: "ChaCha20Poly_1305".to_string(), // Corrected
                kem_algorithm: "Kyber".to_string(), // Corrected
                sig_algorithm: "Falcon1024".to_string(),
                header_obfuscator_settings: HashMap::new(),
            },
            server_password: None,
        };

        let result: Result<InternalServiceRequest, String> = ts_request.try_into();
        assert!(result.is_ok());

        if let Ok(InternalServiceRequest::Connect { username, password, keep_alive_timeout, server_password, .. }) = result {
            assert_eq!(username, "test_user");
            assert_eq!(password, vec![1, 2, 3]);
            assert_eq!(keep_alive_timeout, Some(Duration::from_millis(1000)));
            assert_eq!(server_password, None);
        } else {
            panic!("Conversion did not result in InternalServiceRequest::Connect");
        }
    }

    #[test]
    fn test_connect_request_ts_try_into_invalid_udp_mode() {
        let ts_request = ConnectRequestTS {
            username: "test_user".to_string(),
            password: vec![1, 2, 3],
            connect_mode: "standard".to_string(),
            udp_mode: "invalid_mode".to_string(),
            keep_alive_timeout_ms: Some(1000),
            session_security_settings: SessionSecuritySettingsTS {
                security_level: "High".to_string(),
                secrecy_mode: "Perfect".to_string(),
                encryption_algorithm: "ChaCha20Poly_1305".to_string(), // Corrected
                kem_algorithm: "Kyber".to_string(), // Corrected
                sig_algorithm: "Falcon1024".to_string(),
                header_obfuscator_settings: HashMap::new(),
            },
            server_password: None,
        };

        let result: Result<InternalServiceRequest, String> = ts_request.try_into();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid UdpMode string"));
    }
}

// Define the request structure for connecting to a server
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GetRegistrationFailureTS {
    pub message: String,
}

// Allow converting String errors directly into GetRegistrationFailureTS
impl From<String> for GetRegistrationFailureTS {
    fn from(message: String) -> Self {
        Self { message }
    }
}

// Define the success response structure for getting registration information
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GetRegistrationSuccessTS {
    pub server_address: String,
    pub username: String,
    pub full_name: String,
    pub profile_password: Option<String>, // Assuming password might not always be present/needed
    pub session_security_settings: SessionSecuritySettingsTS,
    pub server_password: Option<String>, // Added based on RegistrationInfo
}
