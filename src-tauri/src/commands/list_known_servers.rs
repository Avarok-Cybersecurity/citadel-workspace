use crate::types::{
    ListKnownServersRequestTS, ListKnownServersResponseTS, RegistrationInfoTS,
    SessionSecuritySettingsTS,
};
use crate::{state::WorkspaceState, util::local_db::LocalDb};
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub async fn list_known_servers(
    request: ListKnownServersRequestTS,
    _window: tauri::Window,
    state: State<'_, WorkspaceState>,
) -> Result<ListKnownServersResponseTS, String> {
    citadel_logging::info!(target: "citadel", "list_known_servers: Listing known servers {request:?}");
    let db = LocalDb::global(&state);

    let addresses = match db.list_known_servers().await {
        Ok(result) => result.servers,
        Err(e) => return Err(format!("Failed to list known servers: {}", e)),
    };

    citadel_logging::info!(target: "citadel", "list_known_servers: The addresses are: {:?}", addresses);

    let mut servers: Vec<RegistrationInfoTS> = Vec::with_capacity(addresses.len());

    for addr in addresses {
        match db.get_registration(&addr).await {
            Ok(registration) => {
                // Convert from internal RegistrationInfo to our TS-friendly RegistrationInfoTS
                let ts_registration = RegistrationInfoTS {
                    server_address: registration.server_address,
                    server_password: registration.server_password,
                    full_name: registration.full_name,
                    username: registration.username,
                    profile_password: registration.profile_password,
                    session_security_settings: SessionSecuritySettingsTS {
                        security_level: format!(
                            "{:?}",
                            registration.static_security_settings.security_level
                        ),
                        secrecy_mode: format!(
                            "{:?}",
                            registration.static_security_settings.secrecy_mode
                        ),
                        encryption_algorithm: format!(
                            "{:?}",
                            registration
                                .static_security_settings
                                .crypto_params
                                .encryption_algorithm
                        ),
                        kem_algorithm: format!(
                            "{:?}",
                            registration
                                .static_security_settings
                                .crypto_params
                                .kem_algorithm
                        ),
                        sig_algorithm: format!(
                            "{:?}",
                            registration
                                .static_security_settings
                                .crypto_params
                                .sig_algorithm
                        ),
                        header_obfuscator_settings: HashMap::new(),
                    },
                };
                servers.push(ts_registration);
            }
            Err(e) => {
                citadel_logging::warn!(target: "citadel", "Failed to get registration for address {:?}: {}", addr, e);
                // Skip this registration but continue with others
                continue;
            }
        }
    }

    Ok(ListKnownServersResponseTS { servers })
}
