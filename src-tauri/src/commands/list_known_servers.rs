use crate::{structs::ConnectionState, util::local_db::LocalDb};
use serde::{Deserialize, Serialize};
use tauri::State;


#[derive(Serialize, Deserialize, Debug)]
pub struct KnownServersList {
    addresses: Vec<String>
}

#[tauri::command]
pub async fn list_known_servers(
    _window: tauri::Window,
    state: State<'_, ConnectionState>,
) -> Result<KnownServersList, String> {

    let db = LocalDb::connect("0".to_string(), &state);
    let addresses = db.list_known_servers().await?;

    Ok(KnownServersList{addresses})
}