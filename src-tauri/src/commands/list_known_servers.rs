use crate::{structs::ConnectionState, util::local_db::LocalDb};
use serde::{Deserialize, Serialize};
use tauri::State;


#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ListKnownServersRequestTS {
    pub cid: String
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ListKnownServersResponseTS {
    pub addresses: Vec<String>
}


#[tauri::command]
pub async fn list_known_servers(
    _request: ListKnownServersRequestTS,
    _window: tauri::Window,
    state: State<'_, ConnectionState>,
) -> Result<ListKnownServersResponseTS, String> {

    println!("Listing known servers...");
    let db = LocalDb::connect("0".to_string(), &state);
    let addresses = db.list_known_servers().await?.server_addresses;

    println!("The addresses are: {:?}", addresses);

    Ok(ListKnownServersResponseTS{addresses})
}