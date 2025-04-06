use serde::{Deserialize, Serialize};

use crate::types::RegistrationRequestTS;

pub mod local_db;
pub mod window_event_handler;

pub trait KeyName {
    /// An identifier used to differentiate between different instances
    /// of the same struct in the DB. If there will only ever be one
    /// instance of a particular struct, the identifier may be None.
    fn identifier(&self) -> Option<String>;

    fn key_name(&self) -> String {
        Self::key_name_from_identifier(self.identifier())
    }
    fn key_name_from_identifier(identifier: Option<String>) -> String {
        format!(
            "{}({})",
            std::any::type_name::<Self>(),
            identifier.unwrap_or("-no-unique-id".to_owned())
        )
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RegistrationInfo {
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

impl From<RegistrationRequestTS> for RegistrationInfo {
    fn from(value: RegistrationRequestTS) -> Self {
        let server_password = match value.workspace_password.trim().len() {
            0 => None,
            _ => Some(value.workspace_password),
        };

        Self {
            server_address: value.workspace_identifier,
            server_password,
            security_level: value.security_level,
            security_mode: value.security_mode,
            encryption_algorithm: value.encryption_algorithm,
            kem_algorithm: value.kem_algorithm,
            sig_algorithm: value.sig_algorithm,
            full_name: value.full_name,
            username: value.username,
            profile_password: value.profile_password,
        }
    }
}

impl KeyName for RegistrationInfo {
    fn identifier(&self) -> Option<String> {
        Some(self.server_address.clone() + &self.username)
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct KnownServers {
    pub server_addresses: Vec<String>,
}

impl KeyName for KnownServers {
    fn identifier(&self) -> Option<String> {
        None
    }
}
