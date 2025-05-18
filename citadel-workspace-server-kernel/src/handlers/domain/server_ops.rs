use citadel_sdk::prelude::{NetworkError, Ratchet};
//, ResponseType}; // Comment out for now
// Import workspace types from structs module
use citadel_workspace_types::structs::{Domain, Office, Permission, Room, User, UserRole, Workspace};
use crate::handlers::domain::{permission_denied, DomainEntity, DomainOperations};
use std::sync::Arc;
use crate::kernel::transaction::{Transaction, TransactionManager};

/// Server-side implementation of domain operations
#[derive(Clone)]
pub struct ServerDomainOps<R: Ratchet> {
    pub(crate) tx_manager: Arc<TransactionManager>,
    _ratchet: std::marker::PhantomData<R>,
}

impl<R: Ratchet> ServerDomainOps<R> {
    /// Create a new instance of ServerDomainOps
    pub fn new(kernel: Arc<TransactionManager>) -> Self {
        Self { tx_manager: kernel, _ratchet: std::marker::PhantomData }
    }
}

impl<R: Ratchet> DomainOperations<R> for ServerDomainOps<R> {
    fn init(&self) -> Result<(), NetworkError> {
        // Nothing to initialize for the server implementation
        Ok(())
    }

    fn is_admin(&self, user_id: &str) -> bool {
        // Delegate to the kernel's admin check
        // TODO: Implement is_admin on WorkspaceServerKernel or here directly
        self.tx_manager.with_read_transaction(|tx| {
            let user = tx.get_user(user_id).ok_or_else(|| NetworkError::msg("User not found"))?;
            Ok(user.role == UserRole::Admin)
        }).unwrap_or(false)
    }

    fn get_user(&self, user_id: &str) -> Option<User> {
        // Use transaction manager to get user
        self.with_read_transaction(|tx| Ok(tx.get_user(user_id).cloned()))
            .unwrap_or(None)
    }

    fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>,
    {
        // Use the kernel's transaction manager
        self.tx_manager.with_read_transaction(f)
    }

    fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>,
    {
        // Use the kernel's transaction manager
        self.tx_manager.with_write_transaction(f)
    }

    fn check_entity_permission(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        // Delegate to the centralized permission checking system in the kernel
        self.tx_manager
            .check_entity_permission(user_id, entity_id, permission)
    }

    fn get_domain(&self, domain_id: &str) -> Option<Domain> {
        DomainOperations::with_read_transaction(self, |tx| Ok(tx.get_domain(domain_id).cloned()))
            .ok()
            .flatten()
    }

    fn add_user_to_domain(
        &self,
        user_id: &str,
        domain_id: &str,
        _role: UserRole,
    ) -> Result<(), NetworkError> {
        self.add_user_to_domain_inner(user_id, domain_id)
    }

    fn remove_user_from_domain(&self, user_id: &str, domain_id: &str) -> Result<(), NetworkError> {
        self.remove_user_from_domain_inner(user_id, domain_id)
    }

    fn get_domain_entity<T>(&self, _user_id: &str, entity_id: &str) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        self.with_read_transaction(|tx| {
            // Get domain by ID
            let domain = tx.get_domain(entity_id).ok_or_else(|| {
                permission_denied(format!("Entity {} not found", entity_id))
            })?;

            // Convert to the requested type
            T::from_domain(domain.clone()).ok_or_else(|| {
                permission_denied("Entity is not of the requested type".to_string())
            })
        })
    }

    fn create_domain_entity<T>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        self.create_domain_entity_inner(user_id, parent_id, name, description, mdx_content)
    }

    fn delete_domain_entity<T>(&self, user_id: &str, entity_id: &str) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        self.delete_domain_entity_inner(user_id, entity_id)
    }

    fn update_domain_entity<T>(
        &self,
        user_id: &str,
        domain_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        self.update_domain_entity_inner::<T>(user_id, domain_id, name, description, mdx_content)
    }

    fn list_domain_entities<T>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        self.list_domain_entities_inner(user_id, parent_id)?
    }

    fn create_office(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.create_office_inner(user_id, name, description, mdx_content)
    }

    fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        self.create_room_inner(user_id, office_id, name, description, mdx_content)
    }

    fn get_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        // Check if user can access this office
        if !ServerDomainOps::can_access_domain(self, user_id, office_id)? {
            return Err(permission_denied(
                "User does not have permission to access this office",
            ));
        }

        // Get the office entity
        DomainOperations::get_domain_entity::<Office>(self, user_id, office_id)
    }

    fn get_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        self.get_room_inner(user_id, room_id)
    }

    fn delete_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        DomainOperations::delete_domain_entity::<Office>(self, user_id, office_id)
    }

    fn delete_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        DomainOperations::delete_domain_entity::<Room>(self, user_id, room_id)
    }

    fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.update_domain_entity::<Office>(user_id, office_id, name, description, mdx_content)
    }

    fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        self.update_domain_entity::<Room>(user_id, room_id, name, description, mdx_content)
    }

    fn list_offices(&self, user_id: &str) -> Result<Vec<Office>, NetworkError> {
        DomainOperations::list_domain_entities(self, user_id, None)
    }

    fn list_rooms(&self, user_id: &str, office_id: &str) -> Result<Vec<Room>, NetworkError> {
        self.list_rooms_inner(user_id, office_id)
    }

    /// Get the single workspace that exists in the system
    fn get_workspace(&self, user_id: &str, _workspace_id: &str) -> Result<Workspace, NetworkError> {
        self.get_workspace_inner(&user_id)
    }

    fn create_workspace(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
    ) -> Result<Workspace, NetworkError> {
        self.create_workspace_inner(user_id, name, description, metadata)
    }

    fn delete_workspace(
        &self,
        user_id: &str,
        _workspace_id: &str,
    ) -> Result<Workspace, NetworkError> {
        self.delete_workspace_inner(user_id)
    }

    fn update_workspace(
        &self,
        user_id: &str,
        _workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        metadata: Option<Vec<u8>>,
    ) -> Result<Workspace, NetworkError> {
        self.update_workspace_inner(user_id, name, description, metadata)
    }

    fn add_office_to_workspace(
        &self,
        user_id: &str,
        _workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        self.add_office_to_workspace_inner(user_id, &office_id)
    }

    fn remove_office_from_workspace(
        &self,
        user_id: &str,
        _workspace_id: &str, // Using fixed ID, so this is unused
        office_id: &str,
    ) -> Result<(), NetworkError> {
        self.remove_office_from_workspace_inner(user_id, office_id)
    }

    fn add_user_to_workspace(
        &self,
        user_id: &str,
        member_id: &str,
        _workspace_id: &str,
    ) -> Result<(), NetworkError> {
        self.add_user_to_workspace_inner(user_id, &member_id)
    }

    fn remove_user_from_workspace(
        &self,
        user_id: &str,
        member_id: &str,
        _workspace_id: &str,
    ) -> Result<(), NetworkError> {
        self.remove_user_from_workspace_inner(user_id, member_id)
    }

    fn load_workspace(&self, user_id: &str) -> Result<Workspace, NetworkError> {
        // Since there should only be one workspace in the system,
        // we'll just call get_workspace with an empty workspace_id
        // which will return the single workspace if it exists
        self.get_workspace(user_id, "")
    }

    fn list_workspaces(&self, user_id: &str) -> Result<Vec<Workspace>, NetworkError> {
        // Get the single workspace and return it as a list with one item
        match self.get_workspace(user_id, "") {
            Ok(workspace) => Ok(vec![workspace]),
            Err(_) => Ok(Vec::new()), // Return empty list if no workspace exists or not accessible
        }
    }

    fn list_offices_in_workspace(
        &self,
        user_id: &str,
        _workspace_id: &str,
    ) -> Result<Vec<Office>, NetworkError> {
        self.list_office_in_workspace_inner(&user_id)
    }
}

