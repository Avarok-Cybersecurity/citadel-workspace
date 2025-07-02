use crate::kernel::transaction::write::WriteTransaction;
use crate::kernel::transaction::{DomainChange, UserChange};
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::{Domain, UserRole};

impl WriteTransaction<'_> {
    /// Get a domain by ID - domain management implementation
    pub fn get_domain_internal(&self, domain_id: &str) -> Option<&Domain> {
        self.domains.get(domain_id)
    }

    /// Get a mutable reference to a domain - domain management implementation
    pub fn get_domain_mut_internal(&mut self, domain_id: &str) -> Option<&mut Domain> {
        // Track the change before returning the mutable reference
        if let Some(domain) = self.domains.get(domain_id) {
            self.domain_changes
                .push(DomainChange::Update(domain_id.to_string(), domain.clone()));
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
    pub fn insert_domain_internal(
        &mut self,
        domain_id: String,
        domain: Domain,
    ) -> Result<(), NetworkError> {
        self.domain_changes
            .push(DomainChange::Insert(domain_id.clone()));
        self.domains.insert(domain_id, domain);
        Ok(())
    }

    /// Update an existing domain - domain management implementation
    pub fn update_domain_internal(
        &mut self,
        domain_id: &str,
        new_domain: Domain,
    ) -> Result<(), NetworkError> {
        let old_domain = if let Some(old_domain) = self.domains.get(domain_id) {
            old_domain.clone()
        } else {
            return Err(NetworkError::msg(format!(
                "Domain with id {} not found",
                domain_id
            )));
        };

        self.domain_changes
            .push(DomainChange::Update(domain_id.to_string(), old_domain));

        self.domains.insert(domain_id.to_string(), new_domain);
        Ok(())
    }

    /// Remove a domain - domain management implementation
    pub fn remove_domain_internal(
        &mut self,
        domain_id: &str,
    ) -> Result<Option<Domain>, NetworkError> {
        if let Some(domain) = self.domains.get(domain_id) {
            self.domain_changes
                .push(DomainChange::Remove(domain_id.to_string(), domain.clone()));
            return Ok(self.domains.remove(domain_id));
        }
        Ok(None)
    }

    /// Check if a user is a member of a domain - domain management implementation
    pub fn is_member_of_domain_internal(
        &self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<bool, NetworkError> {
        let domain = self
            .get_domain_internal(domain_id)
            .ok_or_else(|| NetworkError::msg(format!("Domain with id {} not found", domain_id)))?;

        Ok(domain.members().iter().any(|m| m == user_id))
    }

    /// Add a user to a domain with a specific role - domain management implementation
    pub fn add_user_to_domain_internal(
        &mut self,
        user_id: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        println!(
            "[DEBUG] add_user_to_domain_internal: user_id={}, domain_id={}, role={:?}",
            user_id, domain_id, role
        );

        // Check if domain exists and clone it
        let domain = self
            .domains
            .get(domain_id)
            .ok_or_else(|| NetworkError::msg(format!("Domain with id {} not found", domain_id)))?
            .clone();

        println!("[DEBUG] Domain found: {:?}", domain);

        // Check if user exists and clone it
        let mut user = self
            .users
            .get(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User with id {} not found", user_id)))?
            .clone();

        // Update domain changes list for rollback support
        self.domain_changes
            .push(DomainChange::Update(domain_id.to_string(), domain.clone()));

        // Check if user is already a member
        let is_already_member = domain.members().iter().any(|m| m == user_id);
        if is_already_member {
            println!(
                "[DEBUG] User {} is already a member of domain {}, updating permissions only",
                user_id, domain_id
            );
        }

        println!(
            "[DEBUG] Current members before adding: {:?}",
            domain.members()
        );

        // Add user to domain as a member (only if not already a member)
        let mut new_domain = domain.clone();
        if !is_already_member {
            let mut members = new_domain.members().clone();
            members.push(user_id.to_string());
            new_domain.set_members(members);

            println!(
                "[DEBUG] New members after adding: {:?}",
                new_domain.members()
            );

            // Update the domain
            self.domains.insert(domain_id.to_string(), new_domain);
        } else {
            println!(
                "[DEBUG] Skipping member addition since user is already a member"
            );
        }

        // Update user changes list for rollback support
        self.user_changes
            .push(UserChange::Update(user_id.to_string(), user.clone()));

        // Grant role-based permissions to the user for this domain
        use crate::kernel::transaction::rbac::{retrieve_role_permissions, DomainType};

        // Determine domain type
        let domain_type = if domain.as_office().is_some() {
            DomainType::Office
        } else if domain.as_room().is_some() {
            DomainType::Room
        } else if domain.as_workspace().is_some() {
            DomainType::Workspace
        } else {
            return Err(NetworkError::msg(format!(
                "Unknown domain type for domain: {}",
                domain_id
            )));
        };

        // Get role-based permissions
        let permissions = retrieve_role_permissions(&role, &domain_type);

        // Add permissions to user
        for permission in permissions {
            user.add_permission(domain_id, permission);
        }

        println!(
            "[DEBUG] Granted permissions to user {} for domain {}: {:?}",
            user_id,
            domain_id,
            user.permissions.get(domain_id)
        );

        // Update the user with new permissions
        self.users.insert(user_id.to_string(), user);

        println!("[DEBUG] add_user_to_domain_internal completed successfully");
        Ok(())
    }

    /// Remove a user from a domain - domain management implementation
    pub fn remove_user_from_domain_internal(
        &mut self,
        user_id: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        // Check if domain exists and clone it
        let domain = self
            .domains
            .get(domain_id)
            .ok_or_else(|| NetworkError::msg(format!("Domain with id {} not found", domain_id)))?
            .clone();

        // Check if user exists and clone it
        let mut user = self
            .users
            .get(user_id)
            .ok_or_else(|| NetworkError::msg(format!("User with id {} not found", user_id)))?
            .clone();

        // Track the changes for rollback
        self.domain_changes
            .push(DomainChange::Update(domain_id.to_string(), domain.clone()));

        self.user_changes
            .push(UserChange::Update(user_id.to_string(), user.clone()));

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

        // Clear user's permissions for this domain
        user.permissions.remove(domain_id);

        // Update user with cleared permissions
        self.users.insert(user_id.to_string(), user);

        Ok(())
    }
}
