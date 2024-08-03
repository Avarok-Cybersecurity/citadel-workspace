use crate::{structs::ConnectionState, util::local_db::LocalDb};
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::util::RegistrationInfo;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ListKnownServersRequestTS {
    pub cid: String
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ListKnownServersResponseTS {
    pub servers: Vec<RegistrationInfo>
}


#[tauri::command]
pub async fn list_known_servers(
    _request: ListKnownServersRequestTS,
    _window: tauri::Window,
    state: State<'_, ConnectionState>,
) -> Result<ListKnownServersResponseTS, String> {

    println!("Listing known servers...");
    let db = LocalDb::connect("0".to_string(), &state);
    let addresses = db.list_known_servers().await.expect("failed to list known servers").server_addresses;

    println!("The addresses are: {:?}", addresses);

    let mut servers: Vec<RegistrationInfo> = Vec::with_capacity(std::mem::size_of::<RegistrationInfo>() * addresses.len());

    for addr in addresses{
        servers.push(
            db.get_registration(addr).await.expect("failed to get registration from address")
        )
    };


    Ok(ListKnownServersResponseTS{servers})
}