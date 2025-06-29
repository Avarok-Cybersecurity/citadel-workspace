use crate::handlers::domain::server_ops::DomainServerOperations;
use crate::handlers::domain::DomainEntity;
use crate::kernel::transaction::Transaction;
use crate::kernel::transaction::TransactionManagerExt;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Domain, UserRole};
use uuid::Uuid;

impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    pub fn get_domain_impl(&self, domain_id: &str) -> Option<Domain> {
        self.tx_manager
            .with_read_transaction(|tx| Ok(tx.get_domain(domain_id).cloned()))
            .unwrap_or(None)
    }

    pub fn add_user_to_domain_impl(
        &self,
        admin_id: &str,
        user_id_to_add: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            // Check if admin has permission to add users to this domain
            if !self.is_admin_impl(tx, admin_id)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have admin privileges to add users",
                    admin_id
                )));
            }

            // Check if the user exists
            if tx.get_user(user_id_to_add).is_none() {
                return Err(NetworkError::msg(format!(
                    "User '{}' not found",
                    user_id_to_add
                )));
            }

            // Add user to domain
            tx.add_user_to_domain(user_id_to_add, domain_id, role)?;
            Ok(())
        })
    }

    pub fn remove_user_from_domain_impl(
        &self,
        admin_id: &str,
        user_id_to_remove: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        self.with_write_transaction(|tx| {
            // Check if admin has permission to remove users from this domain
            if !self.is_admin_impl(tx, admin_id)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have admin privileges to remove users",
                    admin_id
                )));
            }

            // Check if the user exists
            if tx.get_user(user_id_to_remove).is_none() {
                return Err(NetworkError::msg(format!(
                    "User '{}' not found",
                    user_id_to_remove
                )));
            }

            // Remove user from domain
            tx.remove_user_from_domain(user_id_to_remove, domain_id)?;
            Ok(())
        })
    }

    pub fn get_domain_entity_impl<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError> {
        use citadel_workspace_types::structs::Permission;

        self.with_read_transaction(|tx| {
            // Check if user has permission to view this entity
            if !self.check_entity_permission_impl(tx, user_id, entity_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to view entity '{}'",
                    user_id, entity_id
                )));
            }

            // Get the entity based on its type
            if let Some(workspace) = tx.get_workspace(entity_id) {
                if let Ok(workspace_entity) = T::try_from_workspace(workspace.clone()) {
                    return Ok(workspace_entity);
                }
            }

            if let Some(office) = tx.get_office(entity_id) {
                if let Ok(office_entity) = T::try_from_office(office.clone()) {
                    return Ok(office_entity);
                }
            }

            if let Some(room) = tx.get_room(entity_id) {
                if let Ok(room_entity) = T::try_from_room(room.clone()) {
                    return Ok(room_entity);
                }
            }

            Err(NetworkError::msg(format!("Entity '{}' not found", entity_id)))
        })
    }

    pub fn create_domain_entity_impl<T: DomainEntity + 'static + serde::de::DeserializeOwned>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError> {
        use citadel_workspace_types::structs::Permission;

        self.with_write_transaction(|tx| {
            // Check if user has permission to create entities in the parent domain
            if let Some(parent_id) = parent_id {
                if !self.check_entity_permission_impl(tx, user_id, parent_id, Permission::ManageDomains)? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to create entities in domain '{}'",
                        user_id, parent_id
                    )));
                }
            }

            let entity_id = Uuid::new_v4().to_string();

            // Create the appropriate entity type
            if T::entity_type() == "workspace" {
                let workspace = citadel_workspace_types::structs::Workspace {
                    id: entity_id.clone(),
                    name: name.to_string(),
                    description: description.to_string(),
                    owner_id: user_id.to_string(),
                    members: vec![user_id.to_string()],
                    offices: Vec::new(),
                    metadata: Default::default(),
                    password_protected: false,
                };

                tx.insert_workspace(entity_id.clone(), workspace.clone())?;

                if let Ok(entity) = T::try_from_workspace(workspace) {
                    return Ok(entity);
                }
            } else if T::entity_type() == "office" {
                if let Some(parent_id) = parent_id {
                    let office = citadel_workspace_types::structs::Office {
                        id: entity_id.clone(),
                        name: name.to_string(),
                        description: description.to_string(),
                        workspace_id: parent_id.to_string(),
                        owner_id: user_id.to_string(),
                        members: vec![user_id.to_string()],
                        rooms: Vec::new(),
                        mdx_content: mdx_content.unwrap_or("").to_string(),
                    };

                    tx.insert_office(entity_id.clone(), office.clone())?;

                    if let Ok(entity) = T::try_from_office(office) {
                        return Ok(entity);
                    }
                }
            } else if T::entity_type() == "room" {
                if let Some(parent_id) = parent_id {
                    let room = citadel_workspace_types::structs::Room {
                        id: entity_id.clone(),
                        name: name.to_string(),
                        description: description.to_string(),
                        office_id: parent_id.to_string(),
                        owner_id: user_id.to_string(),
                        members: vec![user_id.to_string()],
                        mdx_content: mdx_content.unwrap_or("").to_string(),
                    };

                    tx.insert_room(entity_id.clone(), room.clone())?;

                    if let Ok(entity) = T::try_from_room(room) {
                        return Ok(entity);
                    }
                }
            }

            Err(NetworkError::msg("Failed to create domain entity"))
        })
    }

    pub fn delete_domain_entity_impl<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError> {
        use citadel_workspace_types::structs::Permission;

        self.with_write_transaction(|tx| {
            // Check if user has permission to delete this entity
            if !self.check_entity_permission_impl(tx, user_id, entity_id, Permission::ManageDomains)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to delete entity '{}'",
                    user_id, entity_id
                )));
            }

            // Get the entity before deletion
            let entity = self.get_domain_entity_impl::<T>(user_id, entity_id)?;

            // Remove the entity from the database
            if T::entity_type() == "workspace" {
                tx.remove_workspace(entity_id)?;
            } else if T::entity_type() == "office" {
                tx.remove_office(entity_id)?;
            } else if T::entity_type() == "room" {
                tx.remove_room(entity_id)?;
            }

            Ok(entity)
        })
    }

    pub fn update_domain_entity_impl<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        domain_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError> {
        use citadel_workspace_types::structs::Permission;

        self.with_write_transaction(|tx| {
            // Check if user has permission to update this entity
            if !self.check_entity_permission_impl(tx, user_id, domain_id, Permission::EditContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update entity '{}'",
                    user_id, domain_id
                )));
            }

            // Update the appropriate entity type
            if T::entity_type() == "workspace" {
                if let Some(mut workspace) = tx.get_workspace(domain_id).cloned() {
                    if let Some(name) = name {
                        workspace.name = name.to_string();
                    }
                    if let Some(description) = description {
                        workspace.description = description.to_string();
                    }

                    tx.insert_workspace(domain_id.to_string(), workspace.clone())?;

                    if let Ok(entity) = T::try_from_workspace(workspace) {
                        return Ok(entity);
                    }
                }
            } else if T::entity_type() == "office" {
                if let Some(mut office) = tx.get_office(domain_id).cloned() {
                    if let Some(name) = name {
                        office.name = name.to_string();
                    }
                    if let Some(description) = description {
                        office.description = description.to_string();
                    }
                    if let Some(mdx_content) = mdx_content {
                        office.mdx_content = mdx_content.to_string();
                    }

                    tx.insert_office(domain_id.to_string(), office.clone())?;

                    if let Ok(entity) = T::try_from_office(office) {
                        return Ok(entity);
                    }
                }
            } else if T::entity_type() == "room" {
                if let Some(mut room) = tx.get_room(domain_id).cloned() {
                    if let Some(name) = name {
                        room.name = name.to_string();
                    }
                    if let Some(description) = description {
                        room.description = description.to_string();
                    }
                    if let Some(mdx_content) = mdx_content {
                        room.mdx_content = mdx_content.to_string();
                    }

                    tx.insert_room(domain_id.to_string(), room.clone())?;

                    if let Ok(entity) = T::try_from_room(room) {
                        return Ok(entity);
                    }
                }
            }

            Err(NetworkError::msg(format!("Failed to update entity '{}'", domain_id)))
        })
    }

    pub fn list_domain_entities_impl<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError> {
        use citadel_workspace_types::structs::Permission;

        self.with_read_transaction(|tx| {
            let mut entities = Vec::new();

            // Check if user has permission to view entities in the parent domain
            if let Some(parent_id) = parent_id {
                if !self.check_entity_permission_impl(tx, user_id, parent_id, Permission::ViewContent)? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to view entities in domain '{}'",
                        user_id, parent_id
                    )));
                }
            }

            // List the appropriate entity type
            if T::entity_type() == "workspace" {
                let workspaces = tx.list_workspaces(user_id)?;
                for workspace in workspaces {
                    if let Ok(entity) = T::try_from_workspace(workspace) {
                        entities.push(entity);
                    }
                }
            } else if T::entity_type() == "office" {
                let offices = tx.list_offices(user_id, parent_id.map(|s| s.to_string()))?;
                for office in offices {
                    if let Ok(entity) = T::try_from_office(office) {
                        entities.push(entity);
                    }
                }
            } else if T::entity_type() == "room" {
                let rooms = tx.list_rooms(user_id, parent_id.map(|s| s.to_string()))?;
                for room in rooms {
                    if let Ok(entity) = T::try_from_room(room) {
                        entities.push(entity);
                    }
                }
            }

            Ok(entities)
        })
    }
} 