// types.rs
//
// Central location for all data structure type definitions used in communication
// between the Rust backend and TypeScript frontend.

// Common type definitions for TypeScript-Rust interop
use citadel_internal_service_types::InternalServiceRequest;
use citadel_internal_service_types::{ConnectMode, SessionSecuritySettings, UdpMode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use uuid::Uuid;

//
// Response Types
//

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConnectSuccessTS {
    pub cid: String, // Using String for u64 values to avoid data loss in TypeScript
    pub request_id: Option<String>, // Using String for Uuid
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConnectFailureTS {
    pub cid: String,
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RegisterSuccessTS {
    pub cid: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RegisterFailureTS {
    pub cid: String,
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MessageSendSuccessTS {
    pub cid: String,
    pub peer_cid: Option<String>,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MessageSendFailureTS {
    pub cid: String,
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MessageNotificationTS {
    pub message: Vec<u8>, // Using Vec<u8> which will convert to Uint8Array in TS
    pub cid: String,
    pub peer_cid: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DisconnectSuccessTS {
    pub cid: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DisconnectFailureTS {
    pub cid: String,
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DisconnectNotificationTS {
    pub cid: String,
    pub peer_cid: Option<String>,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PeerConnectSuccessTS {
    pub cid: String,
    pub peer_cid: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PeerConnectFailureTS {
    pub cid: String,
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PeerDisconnectSuccessTS {
    pub cid: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PeerDisconnectFailureTS {
    pub cid: String,
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LocalDBGetKVSuccessTS {
    pub cid: String,
    pub peer_cid: Option<String>,
    pub key: String,
    pub value: Vec<u8>,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LocalDBGetKVFailureTS {
    pub cid: String,
    pub peer_cid: Option<String>,
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LocalDBSetKVSuccessTS {
    pub cid: String,
    pub peer_cid: Option<String>,
    pub key: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LocalDBSetKVFailureTS {
    pub cid: String,
    pub peer_cid: Option<String>,
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LocalDBClearAllKVSuccessTS {
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LocalDBClearAllKVFailureTS {
    pub request_id: Option<String>,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LocalDBDeleteKVSuccessTS {
    pub request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LocalDBDeleteKVFailureTS {
    pub request_id: Option<String>,
    pub message: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LocalDBGetAllKVRequestTS {
    pub cid: String,
    pub peer_cid: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LocalDBGetAllKVSuccessTS {
    pub request_id: Option<String>,
    pub pairs: Vec<KVPairTS>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LocalDBGetAllKVFailureTS {
    pub request_id: Option<String>,
    pub message: String,
}

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
pub struct PeerRegisterSuccessTS {
    pub request_id: Option<String>,
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
pub struct GetSessionSuccessTS {
    pub request_id: Option<String>,
    pub sessions: Vec<SessionInfoTS>,
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

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ListAllPeersFailureTS {
    pub cid: String,
    pub message: String,
    pub request_id: Option<String>,
}

//
// Request Types
//

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConnectRequestTS {
    pub username: String,
    pub password: Vec<u8>,               // Password as byte array
    pub connect_mode: u8,                // ConnectMode enum as u8
    pub udp_mode: u8,                    // UdpMode enum as u8
    pub keep_alive_timeout: Option<u64>, // Duration in milliseconds
    pub session_security_settings: SessionSecuritySettingsTS,
    pub server_password: Option<Vec<u8>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DisconnectRequestTS {
    pub cid: String,
    #[serde(rename = "peerCid")]
    pub peer_cid: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MessageRequestTS {
    pub message: Vec<u8>, // Message content as byte array (will be Uint8Array in TS)
    pub cid: String,      // Connection ID
    pub peer_cid: Option<String>, // Optional peer connection ID
    pub security_level: u8, // Security level as u8
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationRequestTS {
    pub workspace_identifier: String, // SocketAddr as string
    pub workspace_password: String,
    pub security_level: u8,
    pub security_mode: u8,
    pub encryption_algorithm: u8,
    pub kem_algorithm: u8,
    pub sig_algorithm: u8,
    pub full_name: String,
    pub username: String,
    pub profile_password: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SessionSecuritySettingsTS {
    pub security_level: u8,
    pub secrecy_mode: u8,
    pub encryption_algorithm: u8,
    pub kem_algorithm: u8,
    pub sig_algorithm: u8,
    pub header_obfuscator_settings: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ListKnownServersRequestTS {
    pub cid: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ListKnownServersResponseTS {
    pub servers: Vec<RegistrationInfoTS>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RegistrationInfoTS {
    pub server_address: String,
    pub server_password: Option<String>,
    pub security_level: u8,
    pub security_mode: u8,
    pub encryption_algorithm: u8,
    pub kem_algorithm: u8,
    pub sig_algorithm: u8,
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
pub struct PeerDisconnectRequestTS {
    pub cid: String,
    #[serde(rename = "peerCid")]
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

// Type conversion helper functions

// Convert from Typescript-friendly string representations to Rust native types
impl From<ConnectRequestTS> for InternalServiceRequest {
    fn from(ts: ConnectRequestTS) -> Self {
        let security = SessionSecuritySettings::from(ts.session_security_settings);

        // Convert u8 values to the correct enum types
        let connect_mode = match ts.connect_mode {
            // Use the actual variants available in the ConnectMode enum
            0 => ConnectMode::default(),
            _ => ConnectMode::default(),
        };

        // Similar approach for UdpMode
        let udp_mode = match ts.udp_mode {
            // Use the actual variants available in the UdpMode enum
            0 => UdpMode::default(),
            _ => UdpMode::default(),
        };

        InternalServiceRequest::Connect {
            username: ts.username,
            password: ts.password.into(), // Convert Vec<u8> to SecBuffer
            connect_mode,
            udp_mode,
            keep_alive_timeout: ts.keep_alive_timeout.map(Duration::from_millis), // Convert u64 to Duration
            session_security_settings: security,
            // Pass server_password as is for now - needs further investigation to determine correct type
            // This might need to be adjusted in a follow-up PR
            server_password: match ts.server_password {
                Some(pass) => Some(pass.into()),
                None => None,
            },
            request_id: Uuid::new_v4(),
        }
    }
}

impl From<SessionSecuritySettingsTS> for SessionSecuritySettings {
    fn from(_ts: SessionSecuritySettingsTS) -> Self {
        // TODO: Implement proper conversion
        SessionSecuritySettings::default()
    }
}

// Convert from string to u64 safely
pub fn string_to_u64(s: &str) -> u64 {
    s.parse().expect("Invalid CID")
}

// Convert from string to Uuid safely
pub fn string_to_uuid(s: &str) -> Uuid {
    Uuid::parse_str(s).expect("Invalid UUID")
}

// Rust tests to confirm type conversions are working correctly
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_string_to_u64() {
        assert_eq!(string_to_u64("123"), 123u64);
        assert_eq!(string_to_u64("invalid"), 0u64);
    }

    #[test]
    fn test_string_to_uuid() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let uuid = string_to_uuid(uuid_str);
        assert_eq!(uuid.to_string(), uuid_str);

        let nil_uuid = string_to_uuid("invalid");
        assert_eq!(nil_uuid, Uuid::nil());
    }
}
