use serde::{Deserialize, Serialize};

use crate::commands::register::RegistrationRequestTS;

pub mod local_db;

// pub struct RegistrationRequestTS {
//     workspaceIdentifier: String,
//     workspacePassword: String,
//     securityLevel: u8,
//     securityMode: u8,
//     encryptionAlgorithm: u8,
//     kemAlgorithm: u8,
//     sigAlgorithm: u8,
//     fullName: String,
//     username: String,
//     profilePassword: String,
// }

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
            identifier.unwrap_or("".to_owned())
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
        let server_password = match value.workspacePassword.trim().len() {
            0 => None,
            _ => Some(value.workspacePassword),
        };

        Self {
            server_address: value.workspaceIdentifier,
            server_password,
            security_level: value.securityLevel,
            security_mode: value.securityMode,
            encryption_algorithm: value.encryptionAlgorithm,
            kem_algorithm: value.kemAlgorithm,
            sig_algorithm: value.sigAlgorithm,
            full_name: value.fullName,
            username: value.username,
            profile_password: value.profilePassword,
        }
    }
}

impl KeyName for RegistrationInfo {
    fn identifier(&self) -> Option<String> {
        Some(self.server_address.clone())
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
