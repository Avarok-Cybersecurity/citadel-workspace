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
    fn key_name_from_identifier(identifier: Option<String>) -> String{
        format!("{}({})", std::any::type_name::<Self>(), identifier.or(Some("".to_owned())).unwrap() )
    }
}


#[derive(Serialize, Deserialize, Debug)]
pub struct RegistrationInfo {
    server_address: String,
    server_password: Option<String>,
    security_level: u8,
    security_mode: u8,
    encryption_algorithm: u8,
    kem_algorithm: u8,
    sig_algorithm: u8,
    full_name: String,
    username: String,
    profile_password: String,
    cid: u64,
}

impl RegistrationInfo {
    pub fn from_request(request: RegistrationRequestTS, cid: u64) -> Self {

        let server_password = match request.workspacePassword.trim().len() {
            0 => None,
            _ => Some(request.workspacePassword)
        };

        RegistrationInfo{
            server_address: request.workspaceIdentifier,
            server_password,
            security_level: request.securityLevel,
            security_mode: request.securityMode,
            encryption_algorithm: request.encryptionAlgorithm,
            kem_algorithm: request.kemAlgorithm,
            sig_algorithm: request.sigAlgorithm,
            full_name: request.fullName,
            username: request.username,
            profile_password: request.profilePassword,
            cid
        }
    }
}

impl KeyName for RegistrationInfo {
    fn identifier(&self) -> Option<String> {
       Some(self.server_address.clone())
    }
}

#[derive(Serialize, Deserialize, Debug)]
struct KnownServers{
    server_addresses: Vec<String>
}

impl KeyName for KnownServers{
    fn identifier(&self) -> Option<String> {
        None
    }
}
