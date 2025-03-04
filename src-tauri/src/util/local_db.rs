use std::{collections::HashMap, vec};

use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use serde::{de::DeserializeOwned, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::{commands::send_and_recv, structs::ConnectionRouterState};

use super::{KeyName, KnownServers, RegistrationInfo};

pub struct LocalDb<'a> {
    cid: u64,
    state: &'a State<'a, ConnectionRouterState>,
}

impl<'a> LocalDb<'a> {
    pub fn connect_global(state: &'a State<'a, ConnectionRouterState>) -> Self {
        LocalDb { cid: 0, state }
    }

    pub fn connect(cid: String, state: &'a State<'a, ConnectionRouterState>) -> Self {
        LocalDb {
            cid: cid.parse::<u64>().unwrap(),
            state,
        }
    }

    async fn set_kv<T: Serialize>(&self, key: String, value: &T) -> Result<(), String> {
        let request_id = Uuid::new_v4();
        let payload = InternalServiceRequest::LocalDBSetKV {
            request_id,
            cid: self.cid,
            peer_cid: None,
            key,
            value: serde_json::to_vec(value).map_err(|e| e.to_string())?
        };

        send_and_recv(payload, request_id, self.state).await;
        Ok(())
    }

    async fn get_kv<T: DeserializeOwned>(&self, key: String) -> Result<T, String> {
        let request_id = Uuid::new_v4();
        let payload = InternalServiceRequest::LocalDBGetKV {
            request_id,
            cid: self.cid,
            peer_cid: None,
            key: key.clone(),
        };

         match send_and_recv(payload, request_id, self.state).await {
             InternalServiceResponse::LocalDBGetKVSuccess(data) => {
                 let deserialized: T = serde_json::from_slice(&data.value.as_slice()).map_err(|e| e.to_string())?;
                 println!("Successfully got value from key '{}'.", key);
                 Ok(deserialized)
             },
             InternalServiceResponse::LocalDBGetKVFailure(err) => {
                 Err(err.message)
             },
             unknown => {
                 println!("Unexpected get_kv response:\n{:#?}", unknown);
                 Err("Internal Error".to_owned())
             }
         }
    }

    async fn list_all_kv(&self) -> Result<HashMap<String, String>, String> {
         let request_id = Uuid::new_v4();
         let payload = InternalServiceRequest::LocalDBGetAllKV {
             request_id,
             cid: self.cid,
             peer_cid: None,
         };

         match send_and_recv(payload, request_id, self.state).await {
             InternalServiceResponse::LocalDBGetAllKVFailure(err) => {
                 Err(err.message)
             },
             InternalServiceResponse::LocalDBGetAllKVSuccess(data) => {
                 Ok(data.map.into_iter().map(|(k, v)| (k, serde_json::from_slice(&v).unwrap_or_else(|_| "#BAD DECODING!".to_owned()))).collect())
             },
             unknown => {
                 println!("Unexpected list_all_kv response:\n{:#?}", unknown);
                 Err("Internal Error".to_owned())
             }
        }
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
        match self.get_kv(key.clone()).await {
            Ok(data) => {
                Ok(data)
            }

            Err(err) => {
                citadel_logging::error!(target: "citadel", "Error getting known servers: {err}");
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
    }

    pub async fn _is_known_server(&self, address: &str) -> Result<bool, String> {
        Ok(self
            .list_known_servers()
            .await?
            .server_addresses
            .contains(&address.to_string()))
    }
}
