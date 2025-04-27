use std::collections::HashMap;

use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};
use serde::{de::DeserializeOwned, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::{commands::send_and_recv, state::WorkspaceState};

use super::{ConnectionPair, KeyName, KnownServers, RegistrationInfo};

pub struct LocalDb<'a> {
    cid: u64,
    state: &'a State<'a, WorkspaceState>,
}

impl<'a> LocalDb<'a> {
    pub fn global(state: &'a State<'a, WorkspaceState>) -> Self {
        LocalDb { cid: 0, state }
    }

    pub fn singular_user(cid: String, state: &'a State<'a, WorkspaceState>) -> Self {
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
            value: serde_json::to_vec(value).map_err(|e| e.to_string())?,
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
                let deserialized: T =
                    serde_json::from_slice(data.value.as_slice()).map_err(|e| e.to_string())?;
                println!("Successfully got value from key '{}'.", key);
                Ok(deserialized)
            }
            InternalServiceResponse::LocalDBGetKVFailure(err) => Err(err.message),
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
            InternalServiceResponse::LocalDBGetAllKVFailure(err) => Err(err.message),
            InternalServiceResponse::LocalDBGetAllKVSuccess(data) => Ok(data
                .map
                .into_iter()
                .map(|(k, v)| {
                    (
                        k,
                        serde_json::from_slice(&v).unwrap_or_else(|_| "#BAD DECODING!".to_owned()),
                    )
                })
                .collect()),
            unknown => {
                println!("Unexpected list_all_kv response:\n{:#?}", unknown);
                Err("Internal Error".to_owned())
            }
        }
    }

    pub async fn save_registration(&self, registration: &RegistrationInfo) -> Result<(), String> {
        let connection_pair = ConnectionPair {
            server_address: registration.server_address.clone(),
            username: registration.username.clone(),
        };

        self.set_kv(connection_pair.key_name(), &registration)
            .await?;

        let mut known_servers = self.list_known_servers().await?;

        known_servers.servers.insert(connection_pair);

        self.set_kv(KnownServers::key_name_from_identifier(None), &known_servers)
            .await?;

        Ok(())
    }

    pub async fn get_registration(
        &self,
        connection_pair: &ConnectionPair,
    ) -> Result<RegistrationInfo, String> {
        let registration: RegistrationInfo = self.get_kv(connection_pair.key_name()).await?;
        Ok(registration)
    }

    pub async fn list_known_servers(&self) -> Result<KnownServers, String> {
        let key = KnownServers::key_name_from_identifier(None);
        match self.get_kv(key.clone()).await {
            Ok(data) => Ok(data),

            Err(err) => {
                citadel_logging::error!(target: "citadel", "Error getting known servers: {err}");
                self.set_kv(
                    key,
                    &KnownServers {
                        servers: Default::default(),
                    },
                )
                .await?;
                Ok(KnownServers {
                    servers: Default::default(),
                })
            }
        }
    }
}
