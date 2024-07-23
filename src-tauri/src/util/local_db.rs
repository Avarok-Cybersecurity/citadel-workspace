use std::{collections::HashMap, vec};

use serde::{de::DeserializeOwned, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::{commands::send_and_recv, structs::ConnectionState};
use citadel_internal_service_types::{InternalServiceRequest, InternalServiceResponse};

use super::{KeyName, KnownServers, RegistrationInfo};

pub struct LocalDb<'a> {
    cid: u64,
    state: &'a State<'a, ConnectionState>
}

impl<'a> LocalDb<'a> {    

    pub fn connect(cid: String, state: &'a State<'a, ConnectionState>) -> Self{
        LocalDb{cid: cid.parse::<u64>().unwrap(), state}
    }

    async fn set_kv<T: Serialize>(&self, key: String, value: &T) -> Result<(), String>{
    
        let request_id = Uuid::new_v4();
        let payload = InternalServiceRequest::LocalDBSetKV { 
            request_id, 
            cid: self.cid, 
            peer_cid: None, 
            key: key, 
            value: serde_json::to_vec(value).map_err(|e| e.to_string())?
        };
    
        send_and_recv(payload, request_id, self.state).await?;

        Ok(())
    }

    async fn get_kv<T: DeserializeOwned>(&self, key: String) -> Result<T, String> {
        let request_id = Uuid::new_v4();
        let payload = InternalServiceRequest::LocalDBGetKV { 
            request_id, 
            cid: self.cid, 
            peer_cid: None, 
            key: key.clone() };

        match send_and_recv(payload, request_id, self.state).await? {
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

    async fn list_all_kv(&self) -> Result<HashMap<String, Vec<u8>>, String>{
        let request_id = Uuid::new_v4();
        let payload = InternalServiceRequest::LocalDBGetAllKV {
            request_id,
            cid: self.cid,
            peer_cid: None,
        };
    

        match send_and_recv(payload, request_id, self.state).await? {
            InternalServiceResponse::LocalDBGetAllKVFailure(err) => {
                Err(err.message)
            },
            InternalServiceResponse::LocalDBGetAllKVSuccess(data) => {
                Ok(data.map)
            },
            unknown => {
                println!("Unexpected list_all_kv response:\n{:#?}", unknown);
                Err("Internal Error".to_owned())
            }
        }
    }

    async fn has_key(&self, key: &str) -> Result<bool, String> {
        Ok(self.list_all_kv().await?.contains_key(key))
    }

    pub async fn save_registration(&self, registration: &RegistrationInfo) -> Result<(), String>{
        self.set_kv(registration.key_name(), &registration).await?;
        Ok(())
    }

    pub async fn get_registration(&self, server_address: String) -> Result<RegistrationInfo, String>{
        self.get_kv(RegistrationInfo::key_name_from_identifier(Some(server_address))).await?
    }

    pub async fn list_known_servers(&self) -> Result<Vec<String>, String>{

        let key = KnownServers::key_name_from_identifier(None);
        if self.has_key(&key).await? {
            Ok(self.get_kv(key).await?)
        }
        else {
            self.set_kv(key, &KnownServers{server_addresses: vec![]}).await?;
            Ok(vec![])
        }
    }

    pub async fn is_known_server(&self, address: &str) -> Result<bool, String>{
        Ok(self.list_known_servers().await?.contains(&address.to_string()))
    }

}


//     cid: String,
// peer_cid: Option<String>,
// key: String,
// value: Vec<u8>,
// state: State<'_, ConnectionState>,
// ) -> Result<String, String> {
// let request_id = Uuid::new_v4();
// let payload = LocalDBSetKV {
//     request_id,
//     cid: cid.parse::<u64>().unwrap(),
//     peer_cid: peer_cid.map(|pid| pid.parse::<u64>().unwrap()),
//     key,
//     value,
// };