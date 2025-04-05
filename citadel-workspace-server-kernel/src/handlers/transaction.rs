use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, User, UserRole};
use parking_lot::{RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::collections::HashMap;

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

    /// Get a user by ID
    fn get_user(&self, user_id: &str) -> Option<&User>;

    /// Get a mutable reference to a user (write transactions only)
    fn get_user_mut(&mut self, user_id: &str) -> Option<&mut User>;

    /// Get all users
    fn get_all_users(&self) -> &HashMap<String, User>;

    /// Check if a user has the admin role
    fn is_admin(&self, user_id: &str) -> bool;

    /// Check if a user is a member of a domain
    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError>;

    /// Insert a domain
    fn insert_domain(&mut self, domain_id: String, domain: Domain) -> Result<(), NetworkError>;

    /// Insert a user
    fn insert_user(&mut self, user_id: String, user: User) -> Result<(), NetworkError>;

    /// Update a domain
    fn update_domain(&mut self, domain_id: &str, new_domain: Domain) -> Result<(), NetworkError>;

    /// Update a user
    fn update_user(&mut self, user_id: &str, new_user: User) -> Result<(), NetworkError>;

    /// Remove a domain and return it
    fn remove_domain(&mut self, domain_id: &str) -> Result<Option<Domain>, NetworkError>;

    /// Remove a user and return it
    fn remove_user(&mut self, user_id: &str) -> Result<Option<User>, NetworkError>;

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

/// A read-only transaction
pub struct ReadTransaction<'a> {
    pub domains: RwLockReadGuard<'a, HashMap<String, Domain>>,
    pub users: RwLockReadGuard<'a, HashMap<String, User>>,
}

/// A writable transaction that can modify domains and users
pub struct WriteTransaction<'a> {
    pub domains: RwLockWriteGuard<'a, HashMap<String, Domain>>,
    pub users: RwLockWriteGuard<'a, HashMap<String, User>>,
    pub domain_changes: Vec<DomainChange>,
    pub user_changes: Vec<UserChange>,
}

/// Type of domain change in a transaction for rollback support
pub enum DomainChange {
    Insert(String),
    Update(String, Domain),
    Remove(String, Domain),
}

/// Type of user change in a transaction for rollback support
pub enum UserChange {
    Insert(String),
    Update(String, User),
    Remove(String, User),
}

/// Transaction manager for creating read and write transactions
#[derive(Default)]
pub struct TransactionManager {
    pub domains: RwLock<HashMap<String, Domain>>,
    pub users: RwLock<HashMap<String, User>>,
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

    fn get_user(&self, user_id: &str) -> Option<&User> {
        self.users.get(user_id)
    }

    fn get_user_mut(&mut self, _user_id: &str) -> Option<&mut User> {
        // ReadTransaction doesn't support mutable operations
        None
    }

    fn get_all_users(&self) -> &HashMap<String, User> {
        &self.users
    }

    fn is_admin(&self, user_id: &str) -> bool {
        if let Some(user) = self.get_user(user_id) {
            return user.role == UserRole::Admin;
        }
        false
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

    fn insert_domain(&mut self, _domain_id: String, _domain: Domain) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Cannot insert in a read transaction"))
    }

    fn insert_user(&mut self, _user_id: String, _user: User) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Cannot insert in a read transaction"))
    }

    fn update_domain(&mut self, _domain_id: &str, _new_domain: Domain) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Cannot update in a read transaction"))
    }

    fn update_user(&mut self, _user_id: &str, _new_user: User) -> Result<(), NetworkError> {
        Err(NetworkError::msg("Cannot update in a read transaction"))
    }

    fn remove_domain(&mut self, _domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        Err(NetworkError::msg("Cannot remove in a read transaction"))
    }

    fn remove_user(&mut self, _user_id: &str) -> Result<Option<User>, NetworkError> {
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
    pub fn new(
        domains: RwLockReadGuard<'a, HashMap<String, Domain>>,
        users: RwLockReadGuard<'a, HashMap<String, User>>,
    ) -> Self {
        ReadTransaction { domains, users }
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

    fn get_user(&self, user_id: &str) -> Option<&User> {
        self.users.get(user_id)
    }

    fn get_user_mut(&mut self, user_id: &str) -> Option<&mut User> {
        self.users.get_mut(user_id)
    }

    fn get_all_users(&self) -> &HashMap<String, User> {
        &self.users
    }

    fn is_admin(&self, user_id: &str) -> bool {
        if let Some(user) = self.get_user(user_id) {
            return user.role == UserRole::Admin;
        }
        false
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

    fn insert_domain(&mut self, domain_id: String, domain: Domain) -> Result<(), NetworkError> {
        self.domain_changes
            .push(DomainChange::Insert(domain_id.clone()));
        self.domains.insert(domain_id, domain);
        Ok(())
    }

    fn insert_user(&mut self, user_id: String, user: User) -> Result<(), NetworkError> {
        self.user_changes.push(UserChange::Insert(user_id.clone()));
        self.users.insert(user_id, user);
        Ok(())
    }

    fn update_domain(&mut self, domain_id: &str, new_domain: Domain) -> Result<(), NetworkError> {
        if let Some(old_domain) = self.domains.get(domain_id).cloned() {
            self.domain_changes
                .push(DomainChange::Update(domain_id.to_string(), old_domain));
            self.domains.insert(domain_id.to_string(), new_domain);
            Ok(())
        } else {
            Err(NetworkError::msg("Domain not found"))
        }
    }

    fn update_user(&mut self, user_id: &str, new_user: User) -> Result<(), NetworkError> {
        if let Some(old_user) = self.users.get(user_id).cloned() {
            self.user_changes
                .push(UserChange::Update(user_id.to_string(), old_user));
            self.users.insert(user_id.to_string(), new_user);
            Ok(())
        } else {
            Err(NetworkError::msg("User not found"))
        }
    }

    fn remove_domain(&mut self, domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        if let Some(domain) = self.domains.remove(domain_id) {
            self.domain_changes
                .push(DomainChange::Remove(domain_id.to_string(), domain.clone()));
            Ok(Some(domain))
        } else {
            Ok(None) // Domain not found but not an error
        }
    }

    fn remove_user(&mut self, user_id: &str) -> Result<Option<User>, NetworkError> {
        if let Some(user) = self.users.remove(user_id) {
            self.user_changes
                .push(UserChange::Remove(user_id.to_string(), user.clone()));
            Ok(Some(user))
        } else {
            Ok(None) // User not found but not an error
        }
    }

    fn add_user_to_domain(
        &mut self,
        user_id: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Check if domain exists
        let domain = self
            .get_domain(domain_id)
            .ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?
            .clone();

        // Check if user exists
        if let Some(mut user) = self.get_user(user_id).cloned() {
            // Update user's role if it differs
            if user.role != role {
                user.role = role;
                self.update_user(user_id, user)?;
            }
        } else {
            return Err(NetworkError::msg(format!("User {} not found", user_id)));
        }

        // Update domain with the user
        let updated_domain = match domain {
            Domain::Office { mut office } => {
                if !office.members.contains(&user_id.to_string()) {
                    office.members.push(user_id.to_string());
                }
                Domain::Office { office }
            }
            Domain::Room { mut room } => {
                if !room.members.contains(&user_id.to_string()) {
                    room.members.push(user_id.to_string());
                }
                Domain::Room { room }
            }
        };

        // Update the domain
        self.update_domain(domain_id, updated_domain)
    }

    fn remove_user_from_domain(
        &mut self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        // Check if domain exists
        let domain = self
            .get_domain(domain_id)
            .ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?
            .clone();

        // Update domain without the user
        let updated_domain = match domain {
            Domain::Office { mut office } => {
                office.members.retain(|id| id != user_id);
                Domain::Office { office }
            }
            Domain::Room { mut room } => {
                room.members.retain(|id| id != user_id);
                Domain::Room { room }
            }
        };

        // Update the domain
        self.update_domain(domain_id, updated_domain)
    }

    fn commit(&self) -> Result<(), NetworkError> {
        // Nothing to do here, changes are automatically committed when the transaction is dropped
        Ok(())
    }
}

impl<'a> WriteTransaction<'a> {
    /// Create a new write transaction
    pub fn new(
        domains: RwLockWriteGuard<'a, HashMap<String, Domain>>,
        users: RwLockWriteGuard<'a, HashMap<String, User>>,
    ) -> Self {
        WriteTransaction {
            domains,
            users,
            domain_changes: Vec::new(),
            user_changes: Vec::new(),
        }
    }

    /// Roll back any changes made in this transaction
    pub fn rollback(mut self) {
        // Rollback domain changes in reverse order
        for change in self.domain_changes.iter().rev() {
            match change {
                DomainChange::Insert(id) => {
                    let _ = self.domains.remove(id);
                }
                DomainChange::Update(id, old_domain) => {
                    let _ = self.domains.insert(id.clone(), old_domain.clone());
                }
                DomainChange::Remove(id, old_domain) => {
                    let _ = self.domains.insert(id.clone(), old_domain.clone());
                }
            }
        }

        // Rollback user changes in reverse order
        for change in self.user_changes.iter().rev() {
            match change {
                UserChange::Insert(id) => {
                    let _ = self.users.remove(id);
                }
                UserChange::Update(id, old_user) => {
                    let _ = self.users.insert(id.clone(), old_user.clone());
                }
                UserChange::Remove(id, old_user) => {
                    let _ = self.users.insert(id.clone(), old_user.clone());
                }
            }
        }
    }
}

impl TransactionManager {
    /// Create a new read transaction
    pub fn read_transaction(&self) -> ReadTransaction {
        ReadTransaction::new(self.domains.read(), self.users.read())
    }

    /// Create a new write transaction
    pub fn write_transaction(&self) -> WriteTransaction {
        WriteTransaction::new(self.domains.write(), self.users.write())
    }

    /// Execute a function with a read transaction
    pub fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>,
    {
        let tx = self.read_transaction();
        f(&tx)
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
