//! Mock backend for testing
//!
//! This module provides a mock backend that stores data in memory for tests

use citadel_sdk::prelude::{BackendHandler, NetworkError};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Mock backend that stores data in memory
#[derive(Clone)]
pub struct MockBackend {
    storage: Arc<Mutex<HashMap<String, Vec<u8>>>>,
}

impl MockBackend {
    pub fn new() -> Self {
        Self {
            storage: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[async_trait::async_trait]
impl BackendHandler for MockBackend {
    async fn set(&self, key: &str, value: Vec<u8>) -> Result<(), NetworkError> {
        self.storage.lock().unwrap().insert(key.to_string(), value);
        Ok(())
    }
    
    async fn get(&self, key: &str) -> Result<Option<Vec<u8>>, NetworkError> {
        Ok(self.storage.lock().unwrap().get(key).cloned())
    }
    
    async fn delete(&self, key: &str) -> Result<(), NetworkError> {
        self.storage.lock().unwrap().remove(key);
        Ok(())
    }
    
    async fn list_keys(&self, prefix: &str) -> Result<Vec<String>, NetworkError> {
        Ok(self.storage
            .lock()
            .unwrap()
            .keys()
            .filter(|k| k.starts_with(prefix))
            .cloned()
            .collect())
    }
    
    async fn exists(&self, key: &str) -> Result<bool, NetworkError> {
        Ok(self.storage.lock().unwrap().contains_key(key))
    }
}