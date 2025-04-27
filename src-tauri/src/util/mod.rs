use std::{collections::HashSet, fmt::Display};

use crate::types::RegistrationRequestTS;
use citadel_internal_service_types::SessionSecuritySettings;
use serde::{Deserialize, Serialize};

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
    pub static_security_settings: SessionSecuritySettings,
    pub full_name: String,
    pub username: String,
    pub profile_password: String,
}

impl TryFrom<RegistrationRequestTS> for RegistrationInfo {
    type Error = String;

    fn try_from(value: RegistrationRequestTS) -> Result<Self, Self::Error> {
        let server_password = value.workspace_password.and_then(|pwd| {
            if pwd.trim().is_empty() {
                None // If the trimmed string is empty, result is None
            } else {
                Some(pwd) // Otherwise, keep the original (untrimmed) string
            }
        });

        // Convert the nested TS security settings to the Rust equivalent *first*
        let static_security_settings: SessionSecuritySettings =
            value.session_security_settings.try_into()?;

        Ok(RegistrationInfo {
            server_address: value.workspace_identifier,
            server_password,
            // Use the converted Rust struct here
            static_security_settings,
            full_name: value.full_name,
            username: value.username,
            profile_password: value.profile_password,
        })
    }
}

impl KeyName for RegistrationInfo {
    fn identifier(&self) -> Option<String> {
        Some(server_addr_and_username_to_key(
            &self.server_address,
            &self.username,
        ))
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct KnownServers {
    pub servers: HashSet<ConnectionPair>,
}

#[derive(Serialize, Deserialize, Debug, Hash, Eq, PartialEq)]
pub struct ConnectionPair {
    pub server_address: String,
    pub username: String,
}

impl KeyName for ConnectionPair {
    fn identifier(&self) -> Option<String> {
        Some(server_addr_and_username_to_key(
            &self.server_address,
            &self.username,
        ))
    }
}

impl KeyName for KnownServers {
    fn identifier(&self) -> Option<String> {
        None
    }
}

fn server_addr_and_username_to_key<T: Display, R: Display>(
    server_address: T,
    username: R,
) -> String {
    format!("{}@{}", username, server_address)
}
