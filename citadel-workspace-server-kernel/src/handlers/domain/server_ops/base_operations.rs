use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::handlers::domain::{DomainEntity, DomainOperations};
use crate::handlers::domain::{UpdateOperation, WorkspaceDBList};
use crate::kernel::transaction::Transaction;
use crate::kernel::transaction::TransactionManagerExt;
use bcrypt;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{
    Domain, Office, Permission, Room, User, UserRole, Workspace,
};
use std::collections::HashSet;

// Re-export the permission utility function
pub use super::permission_operations::permission_can_inherit_for_user;

impl<R: Ratchet + Send + Sync + 'static> DomainOperations<R> for DomainServerOperations<R> {
    fn init(&self) -> Result<(), NetworkError> {
        Ok(())
    }

    fn is_admin(&self, tx: &dyn Transaction, user_id: &str) -> Result<bool, NetworkError> {
        self.is_admin_impl(tx, user_id)
    }

    fn get_user(&self, user_id: &str) -> Option<User> {
        self.tx_manager
            .with_read_transaction(|tx| Ok(tx.get_user(user_id).cloned()))
            .unwrap_or(None)
    }

    fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>,
    {
        self.tx_manager
            .with_read_transaction(|tx| f(tx as &dyn Transaction))
    }

    fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>,
    {
        self.tx_manager
            .with_write_transaction(|tx| f(tx as &mut dyn Transaction))
    }

    fn check_entity_permission(
        &self,
        tx: &dyn Transaction,
        actor_user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        self.check_entity_permission_impl(tx, actor_user_id, entity_id, permission)
    }

    fn is_member_of_domain(
        &self,
        tx: &dyn Transaction,
        user_id: &str,
        domain_id: &str,
    ) -> Result<bool, NetworkError> {
        self.is_member_of_domain_impl(tx, user_id, domain_id)
    }

    fn get_domain(&self, domain_id: &str) -> Option<Domain> {
        self.get_domain_impl(domain_id)
    }

    fn add_user_to_domain(
        &self,
        admin_id: &str,
        user_id_to_add: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.add_user_to_domain_impl(admin_id, user_id_to_add, domain_id, role)
    }

    fn remove_user_from_domain(
        &self,
        admin_id: &str,
        user_id_to_remove: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        self.remove_user_from_domain_impl(admin_id, user_id_to_remove, domain_id)
    }

    fn get_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError> {
        self.get_domain_entity_impl(user_id, entity_id)
    }

    fn create_domain_entity<T: DomainEntity + 'static + serde::de::DeserializeOwned>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError> {
        self.create_domain_entity_impl(user_id, parent_id, name, description, mdx_content)
    }

    fn delete_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError> {
        self.delete_domain_entity_impl(user_id, entity_id)
    }

    fn update_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        domain_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError> {
        self.update_domain_entity_impl(user_id, domain_id, name, description, mdx_content)
    }

    fn list_domain_entities<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError> {
        self.list_domain_entities_impl(user_id, parent_id)
    }

    fn add_user_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.add_user_to_workspace_impl(user_id, workspace_id, member_id, role)
    }

    fn remove_user_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
    ) -> Result<(), NetworkError> {
        self.remove_user_from_workspace_impl(user_id, workspace_id, member_id)
    }

    fn update_workspace_member_role(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        role: UserRole,
        metadata: Option<Vec<u8>>,
    ) -> Result<(), NetworkError> {
        self.update_workspace_member_role_impl(actor_user_id, target_user_id, role, metadata)
    }

    fn update_member_permissions(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        domain_id: &str,
        permissions: Vec<Permission>,
        operation: UpdateOperation,
    ) -> Result<(), NetworkError> {
        self.update_member_permissions_impl(actor_user_id, target_user_id, domain_id, permissions, operation)
    }

    // Workspace operations
    fn get_workspace(&self, user_id: &str, workspace_id: &str) -> Result<Workspace, NetworkError> {
        self.get_workspace_impl(user_id, workspace_id)
    }

    fn get_workspace_details(&self, user_id: &str, ws_id: &str) -> Result<Workspace, NetworkError> {
        self.get_workspace_details_impl(user_id, ws_id)
    }

    fn create_workspace(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
        workspace_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.create_workspace_impl(user_id, name, description, metadata, workspace_password)
    }

    fn add_office_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        self.add_office_to_workspace_impl(user_id, workspace_id, office_id)
    }

    fn remove_office_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        self.remove_office_from_workspace_impl(user_id, workspace_id, office_id)
    }

    fn list_workspaces(&self, user_id: &str) -> Result<Vec<Workspace>, NetworkError> {
        self.list_workspaces_impl(user_id)
    }

    fn update_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        metadata: Option<Vec<u8>>,
        workspace_master_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.update_workspace_impl(user_id, workspace_id, name, description, metadata, workspace_master_password)
    }

    fn load_workspace(
        &self,
        user_id: &str,
        workspace_id_opt: Option<&str>,
    ) -> Result<Workspace, NetworkError> {
        self.load_workspace_impl(user_id, workspace_id_opt)
    }

    fn delete_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        workspace_password: String,
    ) -> Result<(), NetworkError> {
        self.delete_workspace_impl(user_id, workspace_id, workspace_password)
    }

    fn get_all_workspace_ids(&self) -> Result<WorkspaceDBList, NetworkError> {
        self.get_all_workspace_ids_impl()
    }

    fn list_offices_in_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Vec<Office>, NetworkError> {
        self.list_offices_in_workspace_impl(user_id, workspace_id)
    }

    // Office operations - delegating to office_operations module
    fn create_office(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.create_office_impl(user_id, workspace_id, name, description, mdx_content)
    }

    fn get_office(&self, user_id: &str, office_id: &str) -> Result<String, NetworkError> {
        self.get_office_impl(user_id, office_id)
    }

    fn delete_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        self.delete_office_impl(user_id, office_id)
    }

    fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.update_office_impl(user_id, office_id, name, description, mdx_content)
    }

    fn list_offices(
        &self,
        user_id: &str,
        workspace_id: Option<String>,
    ) -> Result<Vec<Office>, NetworkError> {
        self.list_offices_impl(user_id, workspace_id)
    }

    // Room operations - delegating to office_operations module (since create_room is there)
    fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        self.create_room_impl(user_id, office_id, name, description, mdx_content)
    }

    // TODO: Add remaining room operations
    fn get_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        // For now, return a simple implementation until room_operations module is complete
        self.with_read_transaction(|tx| {
            if let Some(room) = tx.get_room(room_id) {
                Ok(room.clone())
            } else {
                Err(NetworkError::msg(format!("Room '{}' not found", room_id)))
            }
        })
    }

    fn delete_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        // For now, return a simple implementation until room_operations module is complete
        self.with_write_transaction(|tx| {
            if let Some(room) = tx.get_room(room_id).cloned() {
                tx.remove_room(room_id)?;
                Ok(room)
            } else {
                Err(NetworkError::msg(format!("Room '{}' not found", room_id)))
            }
        })
    }

    fn update_room(
        &self,
        user_id: &str,
        room_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        // For now, return a simple implementation until room_operations module is complete
        self.with_write_transaction(|tx| {
            if let Some(mut room) = tx.get_room(room_id).cloned() {
                if let Some(name) = name {
                    room.name = name.to_string();
                }
                if let Some(description) = description {
                    room.description = description.to_string();
                }
                if let Some(mdx_content) = mdx_content {
                    room.mdx_content = mdx_content.to_string();
                }
                tx.insert_room(room_id.to_string(), room.clone())?;
                Ok(room)
            } else {
                Err(NetworkError::msg(format!("Room '{}' not found", room_id)))
            }
        })
    }

    fn list_rooms(
        &self,
        user_id: &str,
        office_id: Option<String>,
    ) -> Result<Vec<Room>, NetworkError> {
        self.with_read_transaction(|tx| {
            tx.list_rooms(user_id, office_id)
        })
    }
}

// Utility helper for custom role determination
impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    fn determine_custom_role_from_permissions(_user: &User) -> Option<UserRole> {
        // TODO: Implement custom role logic based on permissions
        None
    }
}
