use crate::state::WorkspaceState;
use crate::types::{SessionSecuritySettingsTS, GetRegistrationFailureTS, GetRegistrationSuccessTS};
use crate::util::local_db::LocalDb;
use tauri::State;
use std::collections::HashMap;
use crate::util::ConnectionPair;

/// Get registration information for a specific server
#[tauri::command]
pub async fn get_registration(
    server_address: String,
    username: String,
    state: State<'_, WorkspaceState>,
) -> Result<GetRegistrationSuccessTS, GetRegistrationFailureTS> {
    // Get the database instance
    let db = LocalDb::global(&state);
    
    // Try to retrieve the registration info
    match db.get_registration(&ConnectionPair { server_address, username }).await {
        Ok(registration) => { 
            // Convert internal SessionSecuritySettings to the TS version
            let settings = registration.static_security_settings;
            let crypto = settings.crypto_params; 
            // Convert header obfuscator settings map - placeholder for now
            // TODO: Properly handle HeaderObfuscatorSettings variants if necessary
            let header_obfuscator_settings_ts: HashMap<String, String> = HashMap::new();
            // Optionally log the variant: log::info!("Header Obfuscator Setting: {:?}", settings.header_obfuscator_settings);

            let session_security_settings_ts = SessionSecuritySettingsTS {
                security_level: format!("{:?}", settings.security_level),
                secrecy_mode: format!("{:?}", settings.secrecy_mode),
                encryption_algorithm: format!("{:?}", crypto.encryption_algorithm),
                kem_algorithm: format!("{:?}", crypto.kem_algorithm),
                sig_algorithm: format!("{:?}", crypto.sig_algorithm),
                header_obfuscator_settings: header_obfuscator_settings_ts,
            };

            // Construct the success response
            Ok(GetRegistrationSuccessTS {
                server_address: registration.server_address,
                username: registration.username,
                full_name: registration.full_name,
                profile_password: Some(registration.profile_password), 
                session_security_settings: session_security_settings_ts,
                server_password: registration.server_password, 
            })
        }
        Err(db_err) => { 
            Err(GetRegistrationFailureTS::from(db_err)) 
        }
    }
}
