use crate::state::WorkspaceState;
use crate::types::RegistrationInfoTS;
use crate::util::local_db::LocalDb;
use tauri::State;

/// Get registration information for a specific server and cid
#[tauri::command]
pub async fn get_registration(
    server_address: String,
    cid: String,
    state: State<'_, WorkspaceState>,
) -> Result<RegistrationInfoTS, String> {    
    // Get the database instance
    let db = LocalDb::singular_user(cid, &state);
    
    // Try to retrieve the registration info
    match db.get_registration(server_address).await {
        Ok(registration) => {
            // Convert to TS-friendly struct
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
            
            Ok(ts_registration)
        },
        Err(e) => Err(format!("Failed to retrieve registration: {}", e)),
    }
}
