use crate::types::{
    string_to_u64, ListKnownServersRequestTS, ListKnownServersResponseTS, RegistrationInfoTS,
};
use crate::{state::WorkspaceState, util::local_db::LocalDb};
use tauri::State;

#[tauri::command]
pub async fn list_known_servers(
    request: ListKnownServersRequestTS,
    _window: tauri::Window,
    state: State<'_, WorkspaceState>,
) -> Result<ListKnownServersResponseTS, String> {
    citadel_logging::info!(target: "citadel", "list_known_servers: Listing known servers {request:?}");
    let db = LocalDb::connect_global(&state);

    // Validate CID
    let _cid = string_to_u64(&request.cid); // Just for validation, not used in this function yet

    let addresses = match db.list_known_servers().await {
        Ok(result) => result.server_addresses,
        Err(e) => return Err(format!("Failed to list known servers: {}", e)),
    };

    citadel_logging::info!(target: "citadel", "list_known_servers: The addresses are: {:?}", addresses);

    let mut servers: Vec<RegistrationInfoTS> = Vec::with_capacity(addresses.len());

    for addr in addresses {
        match db.get_registration(addr.clone()).await {
            Ok(registration) => {
                // Convert from internal RegistrationInfo to our TS-friendly RegistrationInfoTS
                let ts_registration = RegistrationInfoTS {
                    server_address: registration.server_address,
                    server_password: registration.server_password,
                    security_level: registration.security_level,
                    security_mode: registration.security_mode,
                    encryption_algorithm: registration.encryption_algorithm,
                    kem_algorithm: registration.kem_algorithm,
                    sig_algorithm: registration.sig_algorithm,
                    full_name: registration.full_name,
                    username: registration.username,
                    profile_password: registration.profile_password,
                };
                servers.push(ts_registration);
            }
            Err(e) => {
                citadel_logging::warn!(target: "citadel", "Failed to get registration for address {}: {}", addr, e);
                // Skip this registration but continue with others
                continue;
            }
        }
    }

    Ok(ListKnownServersResponseTS { servers })
}
