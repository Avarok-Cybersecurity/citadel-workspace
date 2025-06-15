// use citadel_sdk::prelude::{BackendHandler, NetworkError, NodeRemote, ProtocolRemoteExt, Ratchet, SymmetricIdentifierHandle};
// use parking_lot::{RwLock, RwLockReadGuard, RwLockWriteGuard};
// use std::collections::{HashMap, HashSet};
// use std::sync::Arc;
// use std::marker::PhantomData;
// use serde::{Serialize, Deserialize};

// pub async fn generate_remote<R: Ratchet>(
//     node_remote: &NodeRemote<R>,
//     cid: u64,
//     peer_cid: Option<u64>,
// ) -> SymmetricIdentifierHandle<R> {
//     node_remote
//         .propose_target(cid, peer_cid.unwrap_or(0))
//         .await
//         .expect("Should not fail to find target")
//         .into_owned()
// }

// pub async fn set<R: Ratchet>(
//     handle: &SymmetricIdentifierHandle<R>,
//     key: impl Into<&str>,
//     value: impl Into<Vec<u8>>,
// ) -> Result<Option<Vec<u8>>, NetworkError> {
//     handle.set(key.into(), value.into()).await
// }
    
// pub async fn get<R: Ratchet>(
//     handle: &SymmetricIdentifierHandle<R>,
//     key: impl Into<&str>,
// ) -> Result<Option<String>, NetworkError> {
//     handle.get(key.into()).await.map(|v| v.map(|v| String::from_utf8_lossy(&v).to_string()))
// }

// /// A store that persists data to the backend using NodeRemote and SymmetricIdentifierHandle
// /// 
// /// This is designed to be a replacement for HashMap storage while using the backend
// /// infrastructure (which can be SQL, filesystem, etc.) for actual storage.
// /// 
// /// The in-memory cache mimics a HashMap for fast access during transactions,
// /// while the backend handle provides persistent storage.
// pub struct BackendStore<R: Ratchet, T: Serialize + for<'de> Deserialize<'de> + Clone + Send + Sync> {
//     /// In-memory cache of values, mirroring what's in the backend
//     cache: RwLock<HashMap<String, T>>,
//     /// Set of keys that have been modified but not yet committed
//     modified_keys: RwLock<HashSet<String>>,
//     /// Handle to the backend storage
//     handle: Arc<RwLock<Option<SymmetricIdentifierHandle<R>>>>,
//     /// Prefix for keys in the backend to avoid collisions between different stores
//     key_prefix: String,
//     /// Phantom data for the Ratchet type
//     _phantom: PhantomData<R>,
// }

// impl<R: Ratchet, T: Serialize + for<'de> Deserialize<'de> + Clone + Send + Sync> BackendStore<R, T> {
//     /// Create a new BackendStore with the given key prefix
//     pub fn new(key_prefix: String) -> Self {
//         Self {
//             cache: RwLock::new(HashMap::new()),
//             modified_keys: RwLock::new(HashSet::new()),
//             handle: Arc::new(RwLock::new(None)),
//             key_prefix,
//             _phantom: PhantomData,
//         }
//     }

//     /// Set the backend handle for this store
//     pub fn set_handle(&self, handle: SymmetricIdentifierHandle<R>) {
//         *self.handle.write() = Some(handle);
//     }

//     /// Get the full key for the backend by combining the prefix and key
//     fn get_full_key(&self, key: &str) -> String {
//         format!("{}.{}", self.key_prefix, key)
//     }

//     /// Insert a value into the store
//     pub fn insert(&self, key: String, value: T) -> Option<T> {
//         let mut cache = self.cache.write();
//         let mut modified = self.modified_keys.write();
//         modified.insert(key.clone());
//         cache.insert(key, value)
//     }

//     /// Get a reference to a value from the store
//     pub fn get(&self, key: &str) -> Option<T> {
//         self.cache.read().get(key).cloned()
//     }

//     /// Remove a value from the store
//     pub fn remove(&self, key: &str) -> Option<T> {
//         let mut cache = self.cache.write();
//         let mut modified = self.modified_keys.write();
//         modified.insert(key.to_string());
//         cache.remove(key)
//     }

//     /// Get a read-only view of the entire cache
//     pub fn read(&self) -> RwLockReadGuard<HashMap<String, T>> {
//         self.cache.read()
//     }

//     /// Get a mutable view of the entire cache
//     pub fn write(&self) -> RwLockWriteGuard<HashMap<String, T>> {
//         self.cache.write()
//     }

//     /// Initialize the cache from the backend
//     pub async fn initialize(&self) -> Result<(), NetworkError> {
//         // In a real implementation, this would load all data from the backend
//         // For now, we'll just ensure the handle exists
//         if self.handle.read().is_none() {
//             return Err(NetworkError::msg("Backend handle not set"));
//         }
        
//         // TODO: Implement loading all keys from backend
//         // This would require some way to list all keys with a certain prefix
//         Ok(())
//     }

//     /// Commit changes to the backend
//     pub async fn commit(&self) -> Result<(), NetworkError> {
//         let handle_guard = self.handle.read();
//         let handle = match &*handle_guard {
//             Some(h) => h,
//             None => return Err(NetworkError::msg("Backend handle not set")),
//         };

//         let cache = self.cache.read();
//         let modified_keys = self.modified_keys.read();

//         for key in modified_keys.iter() {
//             let full_key = self.get_full_key(key);
            
//             match cache.get(key) {
//                 Some(value) => {
//                     // Serialize the value
//                     let serialized = serde_json::to_vec(value)
//                         .map_err(|e| NetworkError::msg(format!("Failed to serialize: {}", e)))?;
                    
//                     // Set the value in the backend
//                     set(handle, &full_key, serialized).await?;
//                 }
//                 None => {
//                     // The key was modified but is not in the cache, so it was removed
//                     // We use an empty Vec as a tombstone to indicate deletion
//                     set(handle, &full_key, Vec::<u8>::new()).await?;
//                 }
//             }
//         }

//         // Clear the modified keys
//         self.modified_keys.write().clear();
        
//         Ok(())
//     }
// }

// /// Implementation of Default for BackendStore
// impl<R: Ratchet, T: Serialize + for<'de> Deserialize<'de> + Clone + Send + Sync> Default for BackendStore<R, T> {
//     fn default() -> Self {
//         Self::new(String::from("default"))
//     }
// }

// /// A convenience type for BackendStore that is wrapped in an Arc and RwLock
// /// 
// /// This type is meant to be a direct replacement for RwLock<HashMap<String, T>> in the TransactionManager
// pub type BackendStoreMap<R, T> = RwLock<BackendStore<R, T>>;

// /// Create a new shared backend store
// pub fn new_backend_store<R: Ratchet, T: Serialize + for<'de> Deserialize<'de> + Clone + Send + Sync>(
//     key_prefix: String
// ) -> BackendStoreMap<R, T> {
//     RwLock::new(BackendStore::new(key_prefix))
// }
