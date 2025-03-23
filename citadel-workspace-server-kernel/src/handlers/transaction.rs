use std::collections::HashMap;
use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::ops::{Deref, DerefMut};
use citadel_sdk::prelude::NetworkError;

use crate::structs::Domain;

/// A read-only domain transaction
pub struct ReadTransaction<'a> {
    domains: RwLockReadGuard<'a, HashMap<String, Domain>>,
}

impl<'a> ReadTransaction<'a> {
    /// Create a new read transaction
    pub fn new(domains: RwLockReadGuard<'a, HashMap<String, Domain>>) -> Self {
        ReadTransaction { domains }
    }
    
    /// Check if a domain exists
    pub fn domain_exists(&self, domain_id: &str) -> bool {
        self.domains.contains_key(domain_id)
    }
    
    /// Get a domain by ID
    pub fn get_domain(&self, domain_id: &str) -> Option<&Domain> {
        self.domains.get(domain_id)
    }
    
    /// Get all domains
    pub fn get_all_domains(&self) -> &HashMap<String, Domain> {
        &self.domains
    }
    
    /// Check if a user is an admin
    pub fn is_admin(&self, user_id: &str) -> Result<bool, NetworkError> {
        // For now, just check if they're in the admin group
        // This could be enhanced with more sophisticated role-based checks
        Ok(user_id == "admin") // Simplified check - replace with actual admin check logic
    }
    
    /// Check if a user is a member of a domain
    pub fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        if let Some(domain) = self.get_domain(domain_id) {
            match domain {
                Domain::Office { office } => {
                    Ok(office.owner_id == user_id || office.members.contains(&user_id.to_string()))
                },
                Domain::Room { room } => {
                    // Check if user is a direct member of the room
                    if room.owner_id == user_id || room.members.contains(&user_id.to_string()) {
                        return Ok(true);
                    }
                    
                    // Check if user is a member of the office that contains this room
                    if let Some(office_domain) = self.get_domain(&room.office_id) {
                        if let Domain::Office { office } = office_domain {
                            return Ok(office.owner_id == user_id || office.members.contains(&user_id.to_string()));
                        }
                    }
                    
                    Ok(false)
                },
                _ => Ok(false),
            }
        } else {
            Err(NetworkError::msg("Domain not found"))
        }
    }
    
    /// Upgrade this transaction to a write transaction
    /// This can fail if another write transaction is active
    pub fn upgrade(self, domains_lock: &'a Arc<RwLock<HashMap<String, Domain>>>) 
        -> Result<WriteTransaction<'a>, NetworkError> 
    {
        // Drop the read lock first
        drop(self.domains);
        
        // Try to acquire the write lock
        match domains_lock.write() {
            Ok(write_guard) => Ok(WriteTransaction::new(write_guard)),
            Err(_) => Err(NetworkError::msg("Failed to acquire write lock for transaction upgrade")),
        }
    }
}

impl Deref for ReadTransaction<'_> {
    type Target = HashMap<String, Domain>;
    
    fn deref(&self) -> &Self::Target {
        &self.domains
    }
}

/// A read-write domain transaction
pub struct WriteTransaction<'a> {
    domains: RwLockWriteGuard<'a, HashMap<String, Domain>>,
    changes: Vec<TransactionChange>,
}

/// Record of transaction changes for potential rollback
enum TransactionChange {
    Insert(String),
    Update(String, Domain),
    Remove(String, Domain),
}

impl<'a> WriteTransaction<'a> {
    /// Create a new write transaction
    pub fn new(domains: RwLockWriteGuard<'a, HashMap<String, Domain>>) -> Self {
        WriteTransaction { 
            domains,
            changes: Vec::new(),
        }
    }
    
    /// Insert a new domain
    pub fn insert(&mut self, domain_id: String, domain: Domain) {
        self.changes.push(TransactionChange::Insert(domain_id.clone()));
        self.domains.insert(domain_id, domain);
    }
    
    /// Update an existing domain
    pub fn update(&mut self, domain_id: &str, new_domain: Domain) -> Result<(), NetworkError> {
        if let Some(old_domain) = self.domains.get(domain_id).cloned() {
            self.changes.push(TransactionChange::Update(domain_id.to_string(), old_domain));
            self.domains.insert(domain_id.to_string(), new_domain);
            Ok(())
        } else {
            Err(NetworkError::msg("Domain not found"))
        }
    }
    
    /// Remove a domain
    pub fn remove(&mut self, domain_id: &str) -> Result<Domain, NetworkError> {
        if let Some(domain) = self.domains.remove(domain_id) {
            self.changes.push(TransactionChange::Remove(domain_id.to_string(), domain.clone()));
            Ok(domain)
        } else {
            Err(NetworkError::msg("Domain not found"))
        }
    }
    
    /// Check if a domain exists
    pub fn domain_exists(&self, domain_id: &str) -> bool {
        self.domains.contains_key(domain_id)
    }
    
    /// Get a domain by ID
    pub fn get_domain(&self, domain_id: &str) -> Option<&Domain> {
        self.domains.get(domain_id)
    }
    
    /// Get all domains
    pub fn get_all_domains(&self) -> &HashMap<String, Domain> {
        &self.domains
    }
    
    /// Check if a user is an admin
    pub fn is_admin(&self, user_id: &str) -> Result<bool, NetworkError> {
        // For now, just check if they're in the admin group
        // This could be enhanced with more sophisticated role-based checks
        Ok(user_id == "admin") // Simplified check - replace with actual admin check logic
    }
    
    /// Check if a user is a member of a domain
    pub fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        if let Some(domain) = self.domains.get(domain_id) {
            match domain {
                Domain::Office { office } => {
                    Ok(office.owner_id == user_id || office.members.contains(&user_id.to_string()))
                },
                Domain::Room { room } => {
                    // Check if user is a direct member of the room
                    if room.owner_id == user_id || room.members.contains(&user_id.to_string()) {
                        return Ok(true);
                    }
                    
                    // Check if user is a member of the office that contains this room
                    if let Some(office_domain) = self.domains.get(&room.office_id) {
                        if let Domain::Office { office } = office_domain {
                            return Ok(office.owner_id == user_id || office.members.contains(&user_id.to_string()));
                        }
                    }
                    
                    Ok(false)
                },
                _ => Ok(false),
            }
        } else {
            Err(NetworkError::msg("Domain not found"))
        }
    }
    
    /// Commit the transaction (does nothing, as changes are immediate)
    pub fn commit(self) {
        // Changes are applied immediately due to the lock, so just drop the transaction
        drop(self.domains);
    }
    
    /// Roll back any changes made in this transaction
    pub fn rollback(mut self) {
        // Reverse through the changes to undo them in LIFO order
        for change in self.changes.drain(..).rev() {
            match change {
                TransactionChange::Insert(id) => {
                    let _ = self.domains.remove(&id);
                },
                TransactionChange::Update(id, old_domain) => {
                    let _ = self.domains.insert(id, old_domain);
                },
                TransactionChange::Remove(id, domain) => {
                    let _ = self.domains.insert(id, domain);
                }
            }
        }
    }
}

impl Deref for WriteTransaction<'_> {
    type Target = HashMap<String, Domain>;
    
    fn deref(&self) -> &Self::Target {
        &self.domains
    }
}

impl DerefMut for WriteTransaction<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.domains
    }
}

/// Transaction manager for workspace kernel
pub trait TransactionManager {
    /// Begin a read transaction
    fn begin_read_transaction(&self) -> Result<ReadTransaction, NetworkError>;
    
    /// Begin a write transaction
    fn begin_write_transaction(&self) -> Result<WriteTransaction, NetworkError>;
    
    /// Execute a function within a read transaction
    fn with_read_transaction<F, R>(&self, f: F) -> Result<R, NetworkError>
    where
        F: FnOnce(ReadTransaction) -> Result<R, NetworkError>;
    
    /// Execute a function within a write transaction
    fn with_write_transaction<F, R>(&self, f: F) -> Result<R, NetworkError>
    where
        F: FnOnce(&mut WriteTransaction) -> Result<R, NetworkError>;
}
