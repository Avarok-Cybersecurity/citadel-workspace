use std::{collections::HashMap, vec};

use serde::{de::DeserializeOwned, Serialize};
use tauri::State;

use crate::structs::ConnectionState;

use super::{KeyName, KnownServers, RegistrationInfo};

pub struct LocalDb<'a> {
    cid: u64,
    state: &'a State<'a, ConnectionState>,
}

impl<'a> LocalDb<'a> {
    pub fn connect_global(state: &'a State<'a, ConnectionState>) -> Self {
        LocalDb { cid: 0, state }
    }

    pub fn connect(cid: String, state: &'a State<'a, ConnectionState>) -> Self {
        LocalDb {
            cid: cid.parse::<u64>().unwrap(),
            state,
        }
    }

    async fn set_kv<T: Serialize>(&self, key: String, value: &T) -> Result<(), String> {
        assert!(self.cid == 0, "CID-Specific DB not yet implemented");

        // NOTE: Temporary in-memory db as hash map
        let mut db = self.state.tmp_db.lock().await;
        let value = serde_json::to_string(value).map_err(|err| err.to_string())?;
        db.insert(key, value);
        Ok(())

        // let request_id = Uuid::new_v4();
        // let payload = InternalServiceRequest::LocalDBSetKV {
        //     request_id,
        //     cid: self.cid,
        //     peer_cid: None,
        //     key: key,
        //     value: serde_json::to_vec(value).map_err(|e| e.to_string())?
        // };

        // send_and_recv(payload, request_id, self.state).await?;
    }

    async fn get_kv<T: DeserializeOwned>(&self, key: String) -> Result<T, String> {
        assert!(self.cid == 0, "CID-Specific DB not yet implemented");

        // NOTE: Temporary in-memory db as hash map
        let db = self.state.tmp_db.lock().await;
        let value = db.get(&key).ok_or("Key does not exist")?;

        serde_json::from_str(value).map_err(|err| {
            format!(
                "error deserializing saved key into {}: \n{}\n\nThe raw save is:\n{}",
                std::any::type_name::<T>(),
                err,
                value
            )
        })

        // let request_id = Uuid::new_v4();
        // let payload = InternalServiceRequest::LocalDBGetKV {
        //     request_id,
        //     cid: self.cid,
        //     peer_cid: None,
        //     key: key.clone() };

        // match send_and_recv(payload, request_id, self.state).await? {
        //     InternalServiceResponse::LocalDBGetKVSuccess(data) => {
        //         let deserialized: T = serde_json::from_slice(&data.value.as_slice()).map_err(|e| e.to_string())?;
        //         println!("Successfully got value from key '{}'.", key);
        //         Ok(deserialized)
        //     },
        //     InternalServiceResponse::LocalDBGetKVFailure(err) => {
        //         Err(err.message)
        //     },
        //     unknown => {
        //         println!("Unexpected get_kv response:\n{:#?}", unknown);
        //         Err("Internal Error".to_owned())
        //     }
        // }
    }

    async fn list_all_kv(&self) -> Result<HashMap<String, String>, String> {

        // NOTE: Temporary in-memory db as hash map
        let db = self.state.tmp_db.lock().await;
        let db_copy = db.clone();
        Ok(db_copy)

        // let request_id = Uuid::new_v4();
        // let payload = InternalServiceRequest::LocalDBGetAllKV {
        //     request_id,
        //     cid: self.cid,
        //     peer_cid: None,
        // };

        // match send_and_recv(payload, request_id, self.state).await? {
        //     InternalServiceResponse::LocalDBGetAllKVFailure(err) => {
        //         Err(err.message)
        //     },
        //     InternalServiceResponse::LocalDBGetAllKVSuccess(data) => {
        //         Ok(data.map)
        //     },
        //     unknown => {
        //         println!("Unexpected list_all_kv response:\n{:#?}", unknown);
        //         Err("Internal Error".to_owned())
        //     }
        // }
    }

    async fn has_key(&self, key: &str) -> Result<bool, String> {
        Ok(self.list_all_kv().await?.contains_key(key))
    }

    pub async fn save_registration(&self, registration: &RegistrationInfo) -> Result<(), String> {
        self.set_kv(registration.key_name(), &registration).await?;

        let mut known_servers = self.list_known_servers().await?;
        known_servers
            .server_addresses
            .push(registration.server_address.clone());
        self.set_kv(KnownServers::key_name_from_identifier(None), &known_servers)
            .await?;

        Ok(())
    }

    pub async fn get_registration(
        &self,
        server_address: String,
    ) -> Result<RegistrationInfo, String> {
        let registration: RegistrationInfo = self
            .get_kv(RegistrationInfo::key_name_from_identifier(Some(
                server_address,
            )))
            .await?;
        Ok(registration)
    }

    pub async fn list_known_servers(&self) -> Result<KnownServers, String> {
        let key = KnownServers::key_name_from_identifier(None);
        if self.has_key(&key).await? {
            Ok(self.get_kv(key).await?)
        } else {
            self.set_kv(
                key,
                &KnownServers {
                    server_addresses: vec![],
                },
            )
            .await?;
            Ok(KnownServers {
                server_addresses: vec![],
            })
        }
    }

    pub async fn _is_known_server(&self, address: &str) -> Result<bool, String> {
        Ok(self
            .list_known_servers()
            .await?
            .server_addresses
            .contains(&address.to_string()))
    }
}
