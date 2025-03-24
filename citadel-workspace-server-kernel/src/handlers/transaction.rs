use crate::structs::{Domain, UserRole};
use citadel_sdk::prelude::NetworkError;
use parking_lot::{RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::collections::HashMap;
use std::ops::{Deref, DerefMut};

/// Transaction trait defines common functionality for both read and write transactions
pub trait Transaction {
    /// Get a domain by ID
    fn get_domain(&self, domain_id: &str) -> Option<&Domain>;

    /// Get a mutable reference to a domain (write transactions only)
    fn get_domain_mut(&mut self, domain_id: &str) -> Option<&mut Domain>;

    /// Get all domains
    fn get_all_domains(&self) -> &HashMap<String, Domain>;

    /// Get all domains (alias for get_all_domains)
    fn get_domains(&self) -> &HashMap<String, Domain> {
        self.get_all_domains()
    }

    /// Check if a user is a member of a domain
    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError>;

    /// Insert a domain
    fn insert(&mut self, domain_id: String, domain: Domain) -> Result<(), NetworkError>;

    /// Update a domain
    fn update(&mut self, domain_id: &str, new_domain: Domain) -> Result<(), NetworkError>;

    /// Remove a domain and return it
    fn remove(&mut self, domain_id: &str) -> Result<Option<Domain>, NetworkError>;

    /// Add a user to a domain
    fn add_user_to_domain(
        &mut self,
        user_id: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError>;

    /// Remove a user from a domain
    fn remove_user_from_domain(
        &mut self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError>;

    /// Commit changes (only applies to write transactions)
    fn commit(&self) -> Result<(), NetworkError> {
        Ok(()) // Default implementation, will be overridden for write transactions
    }
}

/// A read-only domain transaction
pub struct ReadTransaction<'a> {
    pub domains: RwLockReadGuard<'a, HashMap<String, Domain>>,
}

/// A writable domain transaction that can modify domains
pub struct WriteTransaction<'a> {
    pub domains: RwLockWriteGuard<'a, HashMap<String, Domain>>,
    pub changes: Vec<TransactionChange>,
}

/// Type of change in a transaction for rollback support
pub enum TransactionChange {
    Insert(String),
    Update(String, Domain),
    Remove(String, Domain),
}

/// Transaction manager for creating read and write transactions
#[derive(Default)]
pub struct TransactionManager {
    pub domains: RwLock<HashMap<String, Domain>>,
}

impl Transaction for ReadTransaction<'_> {
    fn get_domain(&self, domain_id: &str) -> Option<&Domain> {
        self.domains.get(domain_id)
    }

    fn get_domain_mut(&mut self, _domain_id: &str) -> Option<&mut Domain> {
        // ReadTransaction doesn't support mutable operations
        None
    }

    fn get_all_domains(&self) -> &HashMap<String, Domain> {
        &self.domains
    }

    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        if let Some(domain) = self.get_domain(domain_id) {
            match domain {
                Domain::Office { office } => Ok(office.members.contains(&user_id.to_string())),
                Domain::Room { room } => Ok(room.members.contains(&user_id.to_string())),
            }
        } else {
            Err(NetworkError::msg("Domain not found"))
        }
    }

    fn insert(&mut self, _domain_id: String, _domain: Domain) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Cannot insert in a read transaction"))
    }

    fn update(&mut self, _domain_id: &str, _new_domain: Domain) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Cannot update in a read transaction"))
    }

    fn remove(&mut self, _domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        Err(NetworkError::msg("Cannot remove in a read transaction"))
    }

    fn add_user_to_domain(
        &mut self,
        _user_id: &str,
        _domain_id: &str,
        _role: UserRole,
    ) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Cannot add user in a read transaction"))
    }

    fn remove_user_from_domain(
        &mut self,
        _user_id: &str,
        _domain_id: &str,
    ) -> Result<(), NetworkError> {
        Err(NetworkError::msg(
            "Cannot remove user in a read transaction",
        ))
    }
}

impl<'a> ReadTransaction<'a> {
    /// Create a new read transaction
    pub fn new(domains: RwLockReadGuard<'a, HashMap<String, Domain>>) -> Self {
        ReadTransaction { domains }
    }
}

impl Transaction for WriteTransaction<'_> {
    fn get_domain(&self, domain_id: &str) -> Option<&Domain> {
        self.domains.get(domain_id)
    }

    fn get_domain_mut(&mut self, domain_id: &str) -> Option<&mut Domain> {
        self.domains.get_mut(domain_id)
    }

    fn get_all_domains(&self) -> &HashMap<String, Domain> {
        &self.domains
    }

    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        if let Some(domain) = self.get_domain(domain_id) {
            match domain {
                Domain::Office { office } => Ok(office.owner_id == user_id),
                Domain::Room { room } => Ok(room.owner_id == user_id),
            }
        } else {
            Err(NetworkError::msg("Domain not found"))
        }
    }

    fn insert(&mut self, domain_id: String, domain: Domain) -> Result<(), NetworkError> {
        self.changes
            .push(TransactionChange::Insert(domain_id.clone()));
        self.domains.insert(domain_id, domain);
        Ok(())
    }

    fn update(&mut self, domain_id: &str, new_domain: Domain) -> Result<(), NetworkError> {
        if let Some(old_domain) = self.domains.get(domain_id).cloned() {
            self.changes
                .push(TransactionChange::Update(domain_id.to_string(), old_domain));
            self.domains.insert(domain_id.to_string(), new_domain);
            Ok(())
        } else {
            Err(NetworkError::msg("Domain not found"))
        }
    }

    fn remove(&mut self, domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        if let Some(domain) = self.domains.remove(domain_id) {
            self.changes.push(TransactionChange::Remove(
                domain_id.to_string(),
                domain.clone(),
            ));
            Ok(Some(domain))
        } else {
            Ok(None) // Domain not found but not an error
        }
    }

    fn add_user_to_domain(
        &mut self,
        user_id: &str,
        domain_id: &str,
        _role: UserRole,
    ) -> Result<(), NetworkError> {
        // Check if domain exists
        if !self.domains.contains_key(domain_id) {
            return Err(NetworkError::msg("Domain not found"));
        }

        // Clone the domain first to avoid borrow issues
        let mut domain_clone = self
            .domains
            .get(domain_id)
            .cloned()
            .ok_or_else(|| NetworkError::msg("Domain not found"))?;

        // Record the change for rollback
        self.changes.push(TransactionChange::Update(
            domain_id.to_string(),
            domain_clone.clone(),
        ));

        // Add user to domain based on its type
        match &mut domain_clone {
            Domain::Office { office } => {
                if !office.members.contains(&user_id.to_string()) {
                    // Add the user
                    office.members.push(user_id.to_string());
                }
            }
            Domain::Room { room } => {
                if !room.members.contains(&user_id.to_string()) {
                    // Add the user
                    room.members.push(user_id.to_string());
                }
            }
        }

        // Update the domain with the modified version
        self.domains.insert(domain_id.to_string(), domain_clone);

        Ok(())
    }

    fn remove_user_from_domain(
        &mut self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        // Check if domain exists
        if !self.domains.contains_key(domain_id) {
            return Err(NetworkError::msg("Domain not found"));
        }

        // Clone the domain first to avoid borrow issues
        let mut domain_clone = self
            .domains
            .get(domain_id)
            .cloned()
            .ok_or_else(|| NetworkError::msg("Domain not found"))?;

        // Record the change for rollback
        self.changes.push(TransactionChange::Update(
            domain_id.to_string(),
            domain_clone.clone(),
        ));

        // Remove user from domain based on its type
        match &mut domain_clone {
            Domain::Office { office } => {
                office.members.retain(|id| id != user_id);
            }
            Domain::Room { room } => {
                room.members.retain(|id| id != user_id);
            }
        }

        // Update the domain with the modified version
        self.domains.insert(domain_id.to_string(), domain_clone);

        Ok(())
    }

    fn commit(&self) -> Result<(), NetworkError> {
        // Changes are applied immediately due to the lock, so just drop the transaction
        Ok(())
    }
}

impl<'a> WriteTransaction<'a> {
    /// Create a new write transaction
    pub fn new(domains: RwLockWriteGuard<'a, HashMap<String, Domain>>) -> Self {
        WriteTransaction {
            domains,
            changes: Vec::new(),
        }
    }

    /// Roll back any changes made in this transaction
    pub fn rollback(mut self) {
        // Reverse through the changes to undo them in LIFO order
        for change in self.changes.drain(..).rev() {
            match change {
                TransactionChange::Insert(id) => {
                    self.domains.remove(&id);
                }
                TransactionChange::Update(id, old_domain) => {
                    self.domains.insert(id, old_domain);
                }
                TransactionChange::Remove(id, domain) => {
                    self.domains.insert(id, domain);
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

impl Deref for ReadTransaction<'_> {
    type Target = HashMap<String, Domain>;

    fn deref(&self) -> &Self::Target {
        &self.domains
    }
}

impl TransactionManager {
    /// Create a new read transaction
    pub fn read_transaction(&self) -> ReadTransaction {
        ReadTransaction::new(self.domains.read())
    }

    /// Create a new write transaction
    pub fn write_transaction(&self) -> WriteTransaction {
        WriteTransaction::new(self.domains.write())
    }

    /// Execute a function with a read transaction
    pub fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>,
    {
        f(&self.read_transaction())
    }

    /// Execute a function with a write transaction
    pub fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>,
    {
        let mut tx = self.write_transaction();
        match f(&mut tx) {
            Ok(result) => {
                tx.commit()?;
                Ok(result)
            }
            Err(e) => {
                // Automatically roll back on error
                tx.rollback();
                Err(e)
            }
        }
    }
}
