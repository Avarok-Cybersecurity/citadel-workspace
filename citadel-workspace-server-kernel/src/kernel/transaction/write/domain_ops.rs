use crate::kernel::transaction::{DomainChange, DomainType, Transaction};
use crate::kernel::transaction::write::WriteTransaction;
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, UserRole};

impl<'a> WriteTransaction<'a> {
    /// Get a domain by ID - domain management implementation
    pub fn get_domain_internal(&self, domain_id: &str) -> Option<&Domain> {
        self.domains.get(domain_id)
    }

    /// Get a mutable reference to a domain - domain management implementation
    pub fn get_domain_mut_internal(&mut self, domain_id: &str) -> Option<&mut Domain> {
        // Track the change before returning the mutable reference
        if let Some(domain) = self.domains.get(domain_id) {
            self.domain_changes.push(DomainChange::Update(
                domain_id.to_string(),
                domain.clone(),
            ));
        }
        self.domains.get_mut(domain_id)
    }

    /// Get all domains in the system - domain management implementation
    pub fn get_all_domains_internal(&self) -> Result<Vec<(String, Domain)>, NetworkError> {
        let domains = self
            .domains
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        Ok(domains)
    }

    /// Insert a new domain - domain management implementation
    pub fn insert_domain_internal(&mut self, domain_id: String, domain: Domain) -> Result<(), NetworkError> {
        self.domain_changes.push(DomainChange::Insert(domain_id.clone()));
        self.domains.insert(domain_id, domain);
        Ok(())
    }

    /// Update an existing domain - domain management implementation
    pub fn update_domain_internal(&mut self, domain_id: &str, new_domain: Domain) -> Result<(), NetworkError> {
        let old_domain = if let Some(old_domain) = self.domains.get(domain_id) {
            old_domain.clone()
        } else {
            return Err(NetworkError::msg(format!(
                "Domain with id {} not found",
                domain_id
            )));
        };

        self.domain_changes.push(DomainChange::Update(
            domain_id.to_string(),
            old_domain,
        ));

        self.domains.insert(domain_id.to_string(), new_domain);
        Ok(())
    }

    /// Remove a domain - domain management implementation
    pub fn remove_domain_internal(&mut self, domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        if let Some(domain) = self.domains.get(domain_id) {
            self.domain_changes.push(DomainChange::Remove(
                domain_id.to_string(), 
                domain.clone(),
            ));
            return Ok(self.domains.remove(domain_id));
        }
        Ok(None)
    }

    /// Check if a user is a member of a domain - domain management implementation
    pub fn is_member_of_domain_internal(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        let domain = self.get_domain_internal(domain_id).ok_or_else(|| {
            NetworkError::msg(format!("Domain with id {} not found", domain_id))
        })?;

        Ok(domain.members().iter().any(|m| m == user_id))
    }

    /// Add a user to a domain with a specific role - domain management implementation
    pub fn add_user_to_domain_internal(
        &mut self,
        user_id: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        // Check if domain exists
        let domain = self.domains.get(domain_id).ok_or_else(|| {
            NetworkError::msg(format!("Domain with id {} not found", domain_id))
        })?;

        // Check if user exists
        let user = self.users.get(user_id).ok_or_else(|| {
            NetworkError::msg(format!("User with id {} not found", user_id))
        })?;

        // Clone the domain before modifying
        let mut new_domain = domain.clone();
        
        // Update domain changes list for rollback support
        self.domain_changes.push(DomainChange::Update(
            domain_id.to_string(),
            domain.clone(),
        ));

        // Check if user is already a member
        if new_domain.members().iter().any(|m| m == user_id) {
            return Err(NetworkError::msg(format!(
                "User {} is already a member of domain {}",
                user_id, domain_id
            )));
        }

        // Add user to domain as a member
        let mut members = new_domain.members().clone();
        members.push(user_id.to_string());
        new_domain.set_members(members);
        
        // Update the domain
        self.domains.insert(domain_id.to_string(), new_domain);

        // Clone the user before modifying
        let mut new_user = user.clone();
        
        // Update user changes list for rollback support
        self.user_changes.push(UserChange::Update(
            user_id.to_string(), 
            user.clone(),
        ));

        // Update the user
        self.users.insert(user_id.to_string(), new_user);

        Ok(())
    }

    /// Remove a user from a domain - domain management implementation
    pub fn remove_user_from_domain_internal(
        &mut self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        // Check if domain exists
        let domain = self.domains.get(domain_id).ok_or_else(|| {
            NetworkError::msg(format!("Domain with id {} not found", domain_id))
        })?;

        // Check if user exists
        let user = self.users.get(user_id).ok_or_else(|| {
            NetworkError::msg(format!("User with id {} not found", user_id))
        })?;

        // Track the changes for rollback
        self.domain_changes.push(DomainChange::Update(
            domain_id.to_string(),
            domain.clone(),
        ));

        self.user_changes.push(UserChange::Update(
            user_id.to_string(),
            user.clone(),
        ));

        // Remove user from domain
        // Remove user from domain's member list
        let mut updated_domain = domain.clone();
        let mut members = updated_domain.members().clone();
        let initial_len = members.len();
        members.retain(|m| m != user_id);
        
        if members.len() == initial_len {
            // No member was removed
            return Err(NetworkError::msg(format!(
                "User {} is not a member of domain {}",
                user_id, domain_id
            )));
        }
        updated_domain.set_members(members);
        self.domains.insert(domain_id.to_string(), updated_domain);

        // Remove domain from user
        // Domain list is handled by the domain membership system
        self.users.insert(user_id.to_string(), user.clone());

        Ok(())
    }
}
