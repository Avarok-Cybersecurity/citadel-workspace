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

/// Determines if a permission can be inherited from parent domains based on the user's role
fn permission_can_inherit_for_user(permission: Permission, user_role: &UserRole) -> bool {
    match user_role {
        UserRole::Admin | UserRole::Owner => matches!(
            permission,
            Permission::ViewContent
                | Permission::ReadMessages
                | Permission::All
                | Permission::ManageDomains
                | Permission::AddUsers
                | Permission::RemoveUsers
                | Permission::CreateOffice
                | Permission::CreateRoom
                | Permission::AddOffice
                | Permission::AddRoom
                | Permission::EditContent
                | Permission::EditMdx
                | Permission::SendMessages
                | Permission::UploadFiles
                | Permission::DownloadFiles
                | Permission::DeleteOffice
                | Permission::DeleteRoom
                | Permission::DeleteWorkspace
                | Permission::UpdateOffice
                | Permission::UpdateRoom
                | Permission::UpdateWorkspace
        ),
        _ => match permission {
            Permission::ViewContent => true,
            Permission::ReadMessages => true,
            Permission::All => false,
            Permission::ManageDomains => false,
            Permission::AddUsers => false,
            Permission::RemoveUsers => false,
            Permission::CreateOffice => true,
            Permission::CreateRoom => true,
            Permission::AddOffice => true,
            Permission::AddRoom => true,
            Permission::SendMessages => false,
            Permission::EditContent => false,
            Permission::EditMdx => false,
            Permission::UploadFiles => false,
            Permission::DownloadFiles => false,
            _ => false,
        },
    }
}

impl<R: Ratchet + Send + Sync + 'static> DomainOperations<R> for DomainServerOperations<R> {
    fn init(&self) -> Result<(), NetworkError> {
        Ok(())
    }

    fn is_admin(&self, tx: &dyn Transaction, user_id: &str) -> Result<bool, NetworkError> {
        let _user = tx.get_user(user_id).ok_or_else(|| {
            NetworkError::msg(format!("User '{}' not found in is_admin", user_id))
        })?;
        Ok(_user.role == UserRole::Admin)
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
        use crate::kernel::transaction::rbac::{retrieve_role_permissions, DomainType};
        use crate::WORKSPACE_ROOT_ID;

        if let Some(user) = tx.get_user(actor_user_id) {
            if user.role == UserRole::Admin {
                return Ok(true);
            }

            if user.has_permission(entity_id, permission) {
                return Ok(true);
            }

            if entity_id == WORKSPACE_ROOT_ID {
                if let Some(workspace_domain) = tx.get_domain(WORKSPACE_ROOT_ID) {
                    let is_workspace_member = workspace_domain
                        .members()
                        .iter()
                        .any(|member_id| member_id == actor_user_id);
                    if is_workspace_member {
                        let role_permissions =
                            retrieve_role_permissions(&user.role, &DomainType::Workspace);
                        let role_permissions_set: HashSet<Permission> =
                            role_permissions.into_iter().collect();
                        return Ok(Permission::has_permission(
                            &role_permissions_set,
                            &permission,
                        ));
                    } else {
                        return Ok(false);
                    }
                } else {
                    return Ok(false);
                }
            }

            if let Some(domain) = tx.get_domain(entity_id) {
                let domain_type = if domain.as_office().is_some() {
                    DomainType::Office
                } else if domain.as_room().is_some() {
                    DomainType::Room
                } else if domain.as_workspace().is_some() {
                    DomainType::Workspace
                } else {
                    return Err(NetworkError::msg(format!(
                        "Unknown domain type for domain: {}",
                        entity_id
                    )));
                };

                let is_member = domain
                    .members()
                    .iter()
                    .any(|member_id| member_id == actor_user_id);

                if is_member {
                    let role_permissions = retrieve_role_permissions(&user.role, &domain_type);
                    let role_permissions_set: HashSet<Permission> =
                        role_permissions.into_iter().collect();
                    return Ok(Permission::has_permission(
                        &role_permissions_set,
                        &permission,
                    ));
                }

                let parent_id = domain.parent_id();
                let can_inherit = permission_can_inherit_for_user(permission, &user.role);
                if !parent_id.is_empty() && can_inherit {
                    return self.check_entity_permission(tx, actor_user_id, parent_id, permission);
                }
            }
        } else {
            return Err(NetworkError::msg(format!(
                "User '{}' not found",
                actor_user_id
            )));
        }

        Ok(false)
    }

    fn is_member_of_domain(
        &self,
        tx: &dyn Transaction,
        user_id: &str,
        domain_id: &str,
    ) -> Result<bool, NetworkError> {
        if let Some(domain) = tx.get_domain(domain_id) {
            let is_direct_member = domain
                .members()
                .iter()
                .any(|member_id| member_id == user_id);
            if is_direct_member {
                return Ok(true);
            }

            let parent_id = domain.parent_id();
            if !parent_id.is_empty() {
                return self.is_member_of_domain(tx, user_id, parent_id);
            }
        }

        Ok(false)
    }

    fn get_domain(&self, domain_id: &str) -> Option<Domain> {
        self.tx_manager
            .with_read_transaction(|tx| Ok(tx.get_domain(domain_id).cloned()))
            .unwrap_or(None)
    }

    fn add_user_to_domain(
        &self,
        admin_id: &str,
        user_id_to_add: &str,
        domain_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if !self.check_entity_permission(tx, admin_id, domain_id, Permission::AddUsers)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to add users to domain '{}'",
                    admin_id, domain_id
                )));
            }

            if tx.get_user(user_id_to_add).is_none() {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not exist",
                    user_id_to_add
                )));
            }

            tx.add_user_to_domain(user_id_to_add, domain_id, role)?;
            Ok(())
        })
    }

    fn remove_user_from_domain(
        &self,
        admin_id: &str,
        user_id_to_remove: &str,
        domain_id: &str,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if !self.check_entity_permission(tx, admin_id, domain_id, Permission::RemoveUsers)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to remove users from domain '{}'",
                    admin_id, domain_id
                )));
            }

            if !self.is_member_of_domain(tx, user_id_to_remove, domain_id)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' is not a member of domain '{}'",
                    user_id_to_remove, domain_id
                )));
            }

            tx.remove_user_from_domain(user_id_to_remove, domain_id)?;
            Ok(())
        })
    }

    // Generic domain entity operations: these functions serve as the base for specialized entity operations
    fn get_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // Determine the appropriate permission based on the entity type
            let permission = match tx.get_domain(entity_id) {
                Some(Domain::Workspace { .. }) => Permission::ViewContent,
                Some(Domain::Office { .. }) => Permission::ViewContent,
                Some(Domain::Room { .. }) => Permission::ViewContent,
                None => {
                    return Err(NetworkError::msg(format!(
                        "Entity '{}' not found",
                        entity_id
                    )))
                }
            };

            // Check if user has permission to access this entity
            if !self.check_entity_permission(tx, user_id, entity_id, permission)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to access {}",
                    user_id, entity_id
                )));
            }

            // Get the entity
            // Using get_domain for domain entities
            let domain = tx
                .get_domain(entity_id)
                .ok_or_else(|| NetworkError::msg(format!("Entity '{}' not found", entity_id)))?;

            // Convert domain to the requested type
            let entity = T::from_domain(domain.clone()).ok_or_else(|| {
                NetworkError::msg(format!(
                    "Entity '{}' is not of type {}",
                    entity_id,
                    std::any::type_name::<T>()
                ))
            })?;

            Ok(entity.clone())
        })
    }

    fn create_domain_entity<T: DomainEntity + 'static + serde::de::DeserializeOwned>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // If parent_id is provided, check if parent exists and user has permission to create entities in it
            if let Some(parent) = parent_id {
                if !self.check_entity_permission(tx, user_id, parent, Permission::CreateRoom)? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to create entities in '{}'",
                        user_id, parent
                    )));
                }
            }

            let id = uuid::Uuid::new_v4().to_string();

            let entity = T::create(
                id.clone(),
                parent_id.map(|p| p.to_string()),
                name,
                description,
            );

            // Convert to Domain and add to storage
            let domain = entity.clone().into_domain();

            // Update domain with MDX content if provided
            let domain = match (domain, mdx_content) {
                (Domain::Workspace { workspace }, Some(_content)) => {
                    Domain::Workspace { workspace }
                }
                (Domain::Office { mut office }, Some(content)) => {
                    office.mdx_content = content.to_string();
                    Domain::Office { office }
                }
                (Domain::Room { mut room }, Some(content)) => {
                    room.mdx_content = content.to_string();
                    Domain::Room { room }
                }
                (domain, _) => domain,
            };

            // Add domain to storage
            tx.insert_domain(id.clone(), domain.clone())?;

            // Convert back to the requested type and return
            let entity = T::from_domain(domain).ok_or_else(|| {
                NetworkError::msg(format!(
                    "Failed to convert domain back to type {}",
                    std::any::type_name::<T>()
                ))
            })?;

            Ok(entity)
        })
    }

    fn delete_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
    ) -> Result<T, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if user has permission to delete this entity
            let permission = match tx.get_domain(entity_id) {
                Some(Domain::Workspace { .. }) => Permission::DeleteWorkspace,
                Some(Domain::Office { .. }) => Permission::DeleteOffice,
                Some(Domain::Room { .. }) => Permission::DeleteRoom,
                None => {
                    return Err(NetworkError::msg(format!(
                        "Entity '{}' not found",
                        entity_id
                    )))
                }
            };

            if !self.check_entity_permission(tx, user_id, entity_id, permission)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to delete {}",
                    user_id, entity_id
                )));
            }

            // Get the entity before deleting
            let domain = tx
                .get_domain(entity_id)
                .ok_or_else(|| NetworkError::msg(format!("Entity '{}' not found", entity_id)))?;

            // Convert domain to the requested type
            let entity = T::from_domain(domain.clone()).ok_or_else(|| {
                NetworkError::msg(format!(
                    "Entity '{}' is not of type {}",
                    entity_id,
                    std::any::type_name::<T>()
                ))
            })?;

            // Remove the entity
            tx.remove_domain(entity_id)?;

            Ok(entity)
        })
    }

    fn update_domain_entity<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        domain_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<T, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if user has permission to update this entity
            let permission = match tx.get_domain(domain_id) {
                Some(Domain::Workspace { .. }) => Permission::UpdateWorkspace,
                Some(Domain::Office { .. }) => Permission::UpdateOffice,
                Some(Domain::Room { .. }) => Permission::UpdateRoom,
                None => {
                    return Err(NetworkError::msg(format!(
                        "Entity '{}' not found",
                        domain_id
                    )))
                }
            };

            if !self.check_entity_permission(tx, user_id, domain_id, permission)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update {}",
                    user_id, domain_id
                )));
            }

            // Get the entity
            let domain = tx
                .get_domain(domain_id)
                .ok_or_else(|| NetworkError::msg(format!("Entity '{}' not found", domain_id)))?;

            // Update the domain with provided values
            let updated_domain = match domain.clone() {
                Domain::Workspace { mut workspace } => {
                    if let Some(n) = name {
                        workspace.name = n.to_string();
                    }
                    if let Some(d) = description {
                        workspace.description = d.to_string();
                    }
                    Domain::Workspace { workspace }
                }
                Domain::Office { mut office } => {
                    if let Some(n) = name {
                        office.name = n.to_string();
                    }
                    if let Some(d) = description {
                        office.description = d.to_string();
                    }
                    if let Some(m) = mdx_content {
                        office.mdx_content = m.to_string();
                    }
                    Domain::Office { office }
                }
                Domain::Room { mut room } => {
                    if let Some(n) = name {
                        room.name = n.to_string();
                    }
                    if let Some(d) = description {
                        room.description = d.to_string();
                    }
                    if let Some(m) = mdx_content {
                        room.mdx_content = m.to_string();
                    }
                    Domain::Room { room }
                }
            };

            // Update domain in storage
            tx.update_domain(domain_id, updated_domain.clone())?;

            // Convert back to the requested type
            let entity = T::from_domain(updated_domain).ok_or_else(|| {
                NetworkError::msg(format!(
                    "Failed to convert domain back to type {}",
                    std::any::type_name::<T>()
                ))
            })?;

            Ok(entity)
        })
    }

    fn list_domain_entities<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            // If parent_id is provided, check if user has permission to list entities in it
            if let Some(parent) = parent_id {
                if !self.check_entity_permission(tx, user_id, parent, Permission::All)? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to list entities in '{}'",
                        user_id, parent
                    )));
                }
            }

            // Get all domains
            let domains = tx.get_all_domains()?;

            // Filter domains based on parent_id
            let filtered_domains =
                domains
                    .into_iter()
                    .filter(|(_, domain)| match (domain, parent_id) {
                        (Domain::Workspace { .. }, None) => true,
                        (Domain::Office { office }, Some(parent)) => office.workspace_id == parent,
                        (Domain::Room { room }, Some(parent)) => room.office_id == parent,
                        _ => false,
                    });

            // Convert each domain to the requested type and collect
            let mut entities = Vec::new();
            for (_id, domain) in filtered_domains {
                if let Some(entity) = T::from_domain(domain.clone()) {
                    entities.push(entity);
                }
            }

            Ok(entities)
        })
    }

    fn add_user_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
        role: UserRole,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if admin has permission to add users
            if !self.check_entity_permission(tx, user_id, workspace_id, Permission::AddUsers)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to add users to workspace '{}'",
                    user_id, workspace_id
                )));
            }

            // Check if user exists
            let _user = tx
                .get_user(member_id)
                .ok_or_else(|| NetworkError::msg(format!("User '{}' not found", member_id)))?;

            // Check if workspace exists
            let _workspace = tx.get_workspace(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;

            // Add user to workspace with specified role
            tx.add_user_to_domain(member_id, workspace_id, role)?;
            Ok(())
        })
    }

    fn remove_user_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        member_id: &str,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Check if admin has permission to remove users
            if !self.check_entity_permission(tx, user_id, workspace_id, Permission::RemoveUsers)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to remove users from workspace '{}'",
                    user_id, workspace_id
                )));
            }

            // Prevent removing the owner
            if let Some(workspace) = tx.get_workspace(workspace_id) {
                if workspace.owner_id == member_id {
                    return Err(NetworkError::msg(
                        "Cannot remove workspace owner from workspace",
                    ));
                }
            } else {
                return Err(NetworkError::msg(format!(
                    "Workspace '{}' not found",
                    workspace_id
                )));
            }

            // Remove user from workspace
            tx.remove_user_from_domain(member_id, workspace_id)?;
            Ok(())
        })
    }

    fn update_workspace_member_role(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        role: UserRole,
        _metadata: Option<Vec<u8>>,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            // Only admins can update roles
            if !self.is_admin(tx, actor_user_id)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update roles",
                    actor_user_id
                )));
            }

            // Check if target user exists
            let target_user = tx
                .get_user(target_user_id)
                .ok_or_else(|| NetworkError::msg(format!("User '{}' not found", target_user_id)))?;

            // Cannot change role of workspace admin unless you're also an admin
            if target_user.role == UserRole::Admin && role != UserRole::Admin {
                let actor_is_admin = if let Some(actor) = tx.get_user(actor_user_id) {
                    actor.role == UserRole::Admin
                } else {
                    false
                };

                if !actor_is_admin {
                    return Err(NetworkError::msg(
                        "Cannot demote an admin unless you are also an admin",
                    ));
                }
            }

            // Update the user's role
            // Get the user, modify it, and update
            let mut user = tx
                .get_user_mut(target_user_id)
                .ok_or_else(|| NetworkError::msg(format!("User '{}' not found", target_user_id)))?
                .clone();

            user.role = role;
            tx.update_user(target_user_id, user)?;
            Ok(())
        })
    }

    fn update_member_permissions(
        &self,
        actor_user_id: &str,
        target_user_id: &str,
        domain_id: &str,
        permissions: Vec<Permission>,
        operation: UpdateOperation,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if !self.check_entity_permission(tx, actor_user_id, domain_id, Permission::AddUsers)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update permissions in domain '{}'",
                    actor_user_id, domain_id
                )));
            }

            if tx.get_user(target_user_id).is_none() {
                return Err(NetworkError::msg(format!(
                    "Target user '{}' not found",
                    target_user_id
                )));
            }

            if tx.get_domain(domain_id).is_none() {
                return Err(NetworkError::msg(format!(
                    "Domain '{}' not found",
                    domain_id
                )));
            }

            let mut user = tx
                .get_user_mut(target_user_id)
                .ok_or_else(|| NetworkError::msg(format!("User '{}' not found", target_user_id)))?
                .clone();

            match operation {
                UpdateOperation::Add => {
                    for permission in permissions {
                        user.add_permission(domain_id, permission);
                    }
                }
                UpdateOperation::Remove => {
                    for permission in permissions {
                        user.revoke_permission(domain_id, permission);
                    }
                }
                UpdateOperation::Set => {
                    user.clear_permissions(domain_id);
                    for permission in permissions {
                        user.add_permission(domain_id, permission);
                    }
                }
            }

            if let Some(new_role) = Self::determine_custom_role_from_permissions(&user) {
                user.role = new_role;
            }

            tx.update_user(target_user_id, user)?;

            Ok(())
        })
    }

    fn create_room(
        &self,
        user_id: &str,
        office_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Room, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if !self.check_entity_permission(tx, user_id, office_id, Permission::CreateRoom)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to create rooms in office '{}'",
                    user_id, office_id
                )));
            }

            let office_domain = tx
                .get_domain(office_id)
                .ok_or_else(|| NetworkError::msg(format!("Office '{}' not found", office_id)))?;

            if let Domain::Office { office } = office_domain.clone() {
                let room_id = uuid::Uuid::new_v4().to_string();

                let room = Room {
                    id: room_id.clone(),
                    owner_id: user_id.to_string(),
                    office_id: office_id.to_string(),
                    name: name.to_string(),
                    description: description.to_string(),
                    members: Vec::new(),
                    mdx_content: mdx_content.unwrap_or("").to_string(),
                    metadata: Vec::new(),
                };

                tx.insert_domain(room_id.clone(), Domain::Room { room: room.clone() })?;

                let mut updated_office = office.clone();
                updated_office.rooms.push(room_id.clone());
                tx.update_domain(
                    office_id,
                    Domain::Office {
                        office: updated_office,
                    },
                )?;

                Ok(room)
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not an office",
                    office_id
                )))
            }
        })
    }

    fn get_office(&self, user_id: &str, office_id: &str) -> Result<String, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            if !self.check_entity_permission(tx, user_id, office_id, Permission::ViewContent)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to access office '{}'",
                    user_id, office_id
                )));
            }

            let domain = tx
                .get_domain(office_id)
                .ok_or_else(|| NetworkError::msg(format!("Office '{}' not found", office_id)))?;

            if let Domain::Office { office } = domain {
                serde_json::to_string(office)
                    .map_err(|e| NetworkError::msg(format!("Failed to serialize office: {}", e)))
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not an office",
                    office_id
                )))
            }
        })
    }

    fn get_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            if !self.check_entity_permission(tx, user_id, room_id, Permission::All)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to access room '{}'",
                    user_id, room_id
                )));
            }

            let domain = tx
                .get_domain(room_id)
                .ok_or_else(|| NetworkError::msg(format!("Room '{}' not found", room_id)))?;

            if let Domain::Room { room } = domain {
                Ok(room.clone())
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not a room",
                    room_id
                )))
            }
        })
    }

    fn delete_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if !self.check_entity_permission(tx, user_id, office_id, Permission::DeleteOffice)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to delete office '{}'",
                    user_id, office_id
                )));
            }

            let domain = tx
                .get_domain(office_id)
                .ok_or_else(|| NetworkError::msg(format!("Office '{}' not found", office_id)))?;

            if let Domain::Office { office } = domain.clone() {
                let workspace_id = office.workspace_id.clone();

                if let Some(Domain::Workspace { mut workspace }) =
                    tx.get_domain(&workspace_id).cloned()
                {
                    workspace.offices.retain(|id| id != &office_id.to_string());
                    tx.update_domain(&workspace_id, Domain::Workspace { workspace })?;
                }

                for room_id in office.rooms.iter() {
                    tx.remove_domain(room_id)?;
                }

                tx.remove_domain(office_id)?;

                Ok(office)
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not an office",
                    office_id
                )))
            }
        })
    }

    fn delete_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if !self.check_entity_permission(tx, user_id, room_id, Permission::DeleteRoom)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to delete room '{}'",
                    user_id, room_id
                )));
            }

            let domain = tx
                .get_domain(room_id)
                .ok_or_else(|| NetworkError::msg(format!("Room '{}' not found", room_id)))?;

            if let Domain::Room { room } = domain.clone() {
                let office_id = room.office_id.clone();

                if let Some(Domain::Office { mut office }) = tx.get_domain(&office_id).cloned() {
                    office.rooms.retain(|id| id != &room_id.to_string());
                    tx.update_domain(&office_id, Domain::Office { office })?;
                }

                tx.remove_domain(room_id)?;

                Ok(room)
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not a room",
                    room_id
                )))
            }
        })
    }

    fn get_workspace(&self, user_id: &str, workspace_id: &str) -> Result<Workspace, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            if !self.check_entity_permission(tx, user_id, workspace_id, Permission::All)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to access workspace '{}'",
                    user_id, workspace_id
                )));
            }

            let domain = tx.get_domain(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;

            if let Domain::Workspace { workspace } = domain {
                Ok(workspace.clone())
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not a workspace",
                    workspace_id
                )))
            }
        })
    }

    fn get_workspace_details(&self, user_id: &str, ws_id: &str) -> Result<Workspace, NetworkError> {
        self.get_workspace(user_id, ws_id)
    }

    fn create_workspace(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
        workspace_password: String,
    ) -> Result<Workspace, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            let all_domains = tx.get_all_domains()?;
            for (_id, domain) in all_domains {
                if let Domain::Workspace { .. } = domain {
                    return Err(NetworkError::msg(
                        "A root workspace already exists. Cannot create another one.",
                    ));
                }
            }

            let workspace_id = uuid::Uuid::new_v4().to_string();

            let workspace = Workspace {
                id: workspace_id.clone(),
                owner_id: user_id.to_string(),
                name: name.to_string(),
                description: description.to_string(),
                members: Vec::new(),
                offices: Vec::new(),
                metadata: metadata.unwrap_or_default(),
                password_protected: !workspace_password.is_empty(),
            };

            tx.insert_domain(
                workspace_id.clone(),
                Domain::Workspace {
                    workspace: workspace.clone(),
                },
            )?;

            tx.add_user_to_domain(user_id, &workspace_id, UserRole::Admin)?;

            Ok(workspace)
        })
    }

    fn add_office_to_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if !self.check_entity_permission(
                tx,
                user_id,
                workspace_id,
                Permission::UpdateWorkspace,
            )? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to add offices to workspace '{}'",
                    user_id, workspace_id
                )));
            }

            let office_domain = tx
                .get_domain(office_id)
                .ok_or_else(|| NetworkError::msg(format!("Office '{}' not found", office_id)))?;

            let workspace_domain = tx.get_domain(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;

            if let Domain::Office { mut office } = office_domain.clone() {
                if let Domain::Workspace { mut workspace } = workspace_domain.clone() {
                    office.workspace_id = workspace_id.to_string();
                    tx.update_domain(office_id, Domain::Office { office })?;

                    if !workspace.offices.contains(&office_id.to_string()) {
                        workspace.offices.push(office_id.to_string());
                        tx.update_domain(workspace_id, Domain::Workspace { workspace })?;
                    }

                    Ok(())
                } else {
                    Err(NetworkError::msg(format!(
                        "Entity '{}' is not a workspace",
                        workspace_id
                    )))
                }
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not an office",
                    office_id
                )))
            }
        })
    }

    fn remove_office_from_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if !self.check_entity_permission(
                tx,
                user_id,
                workspace_id,
                Permission::UpdateWorkspace,
            )? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to remove offices from workspace '{}'",
                    user_id, workspace_id
                )));
            }

            let workspace_domain = tx.get_domain(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;

            let office_domain = tx
                .get_domain(office_id)
                .ok_or_else(|| NetworkError::msg(format!("Office '{}' not found", office_id)))?;

            if let Domain::Office { office } = &office_domain {
                if office.workspace_id != workspace_id {
                    return Err(NetworkError::msg(format!(
                        "Office '{}' does not belong to workspace '{}'",
                        office_id, workspace_id
                    )));
                }
            } else {
                return Err(NetworkError::msg(format!(
                    "Entity '{}' is not an office",
                    office_id
                )));
            }

            if let Domain::Workspace { mut workspace } = workspace_domain.clone() {
                workspace.offices.retain(|id| id != office_id);
                tx.update_domain(workspace_id, Domain::Workspace { workspace })?;

                Ok(())
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not a workspace",
                    workspace_id
                )))
            }
        })
    }

    fn list_workspaces(&self, user_id: &str) -> Result<Vec<Workspace>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            let domains = tx.get_all_domains()?;

            let mut workspaces = Vec::new();
            for (_id, domain) in domains {
                if let Domain::Workspace { workspace } = domain {
                    if self.check_entity_permission(tx, user_id, &workspace.id, Permission::All)? {
                        workspaces.push(workspace);
                    }
                }
            }

            Ok(workspaces)
        })
    }

    fn update_office(
        &self,
        user_id: &str,
        office_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if !self.check_entity_permission(tx, user_id, office_id, Permission::UpdateOffice)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update office '{}'",
                    user_id, office_id
                )));
            }

            let domain = tx
                .get_domain(office_id)
                .ok_or_else(|| NetworkError::msg(format!("Office '{}' not found", office_id)))?;

            if let Domain::Office { mut office } = domain.clone() {
                if let Some(n) = name {
                    office.name = n.to_string();
                }
                if let Some(d) = description {
                    office.description = d.to_string();
                }
                if let Some(m) = mdx_content {
                    office.mdx_content = m.to_string();
                }

                let updated_domain = Domain::Office {
                    office: office.clone(),
                };
                tx.update_domain(office_id, updated_domain)?;

                Ok(office)
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not an office",
                    office_id
                )))
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
        self.tx_manager.with_write_transaction(|tx| {
            if !self.check_entity_permission(tx, user_id, room_id, Permission::UpdateRoom)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update room '{}'",
                    user_id, room_id
                )));
            }

            let domain = tx
                .get_domain(room_id)
                .ok_or_else(|| NetworkError::msg(format!("Room '{}' not found", room_id)))?;

            if let Domain::Room { mut room } = domain.clone() {
                if let Some(n) = name {
                    room.name = n.to_string();
                }
                if let Some(d) = description {
                    room.description = d.to_string();
                }
                if let Some(m) = mdx_content {
                    room.mdx_content = m.to_string();
                }

                let updated_domain = Domain::Room { room: room.clone() };
                tx.update_domain(room_id, updated_domain)?;

                Ok(room)
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not a room",
                    room_id
                )))
            }
        })
    }

    fn list_offices(
        &self,
        user_id: &str,
        workspace_id: Option<String>,
    ) -> Result<Vec<Office>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            if let Some(ws_id) = &workspace_id {
                if !self.check_entity_permission(tx, user_id, ws_id, Permission::ViewContent)? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to list offices in workspace '{}'",
                        user_id, ws_id
                    )));
                }
            }

            let domains = tx.get_all_domains()?;

            let mut offices = Vec::new();
            for (_id, domain) in domains {
                if let Domain::Office { office } = domain {
                    if let Some(ws_id) = &workspace_id {
                        if office.workspace_id == *ws_id {
                            offices.push(office);
                        }
                    } else if self.check_entity_permission(
                        tx,
                        user_id,
                        &office.id,
                        Permission::ViewContent,
                    )? {
                        offices.push(office);
                    }
                }
            }

            Ok(offices)
        })
    }

    fn list_rooms(
        &self,
        user_id: &str,
        office_id: Option<String>,
    ) -> Result<Vec<Room>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            if let Some(o_id) = &office_id {
                if !self.check_entity_permission(tx, user_id, o_id, Permission::ViewContent)? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to list rooms in office '{}'",
                        user_id, o_id
                    )));
                }
            }

            let domains = tx.get_all_domains()?;

            let mut rooms = Vec::new();
            for (_id, domain) in domains {
                if let Domain::Room { room } = domain {
                    if let Some(o_id) = &office_id {
                        if room.office_id == *o_id {
                            rooms.push(room);
                        }
                    } else if self.check_entity_permission(
                        tx,
                        user_id,
                        &room.id,
                        Permission::ViewContent,
                    )? {
                        rooms.push(room);
                    }
                }
            }

            Ok(rooms)
        })
    }

    fn create_office(
        &self,
        user_id: &str,
        workspace_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if tx.get_user(user_id).is_none() {
                return Err(NetworkError::msg(format!("User '{}' not found", user_id)));
            }

            let _workspace = tx.get_workspace(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;

            if !self.check_entity_permission(tx, user_id, workspace_id, Permission::CreateOffice)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to add offices to workspace '{}'",
                    user_id, workspace_id
                )));
            }

            let office_id = uuid::Uuid::new_v4().to_string();

            let office = Office {
                id: office_id.clone(),
                name: name.to_string(),
                description: description.to_string(),
                workspace_id: workspace_id.to_string(),
                owner_id: user_id.to_string(),
                members: Vec::new(),
                rooms: Vec::new(),
                mdx_content: mdx_content.unwrap_or_default().to_string(),
                metadata: Vec::new(),
            };

            tx.insert_domain(
                office_id.clone(),
                Domain::Office {
                    office: office.clone(),
                },
            )?;

            if let Some(workspace) = tx.get_workspace_mut(workspace_id) {
                workspace.offices.push(office_id.clone());
                let workspace_clone = workspace.clone();
                tx.update_workspace(workspace_id, workspace_clone.clone())?;
                tx.update_domain(
                    workspace_id,
                    Domain::Workspace {
                        workspace: workspace_clone,
                    },
                )?;
            } else {
                return Err(NetworkError::msg(format!(
                    "Workspace '{}' not found",
                    workspace_id
                )));
            }

            if let Some(user) = tx.get_user_mut(user_id) {
                let user_clone = user.clone();
                tx.add_user_to_domain(user_id, &office_id, UserRole::Owner)?;
                tx.update_user(user_id, user_clone)?;
            } else {
                return Err(NetworkError::msg(format!("User '{}' not found", user_id)));
            }

            Ok(office)
        })
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
        self.tx_manager.with_write_transaction(|tx| {
            if tx.get_user(user_id).is_none() {
                return Err(NetworkError::msg(format!("User '{}' not found", user_id)));
            }

            let domain = tx.get_domain(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;

            if !self.check_entity_permission(
                tx,
                user_id,
                workspace_id,
                Permission::UpdateWorkspace,
            )? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to update workspace '{}'",
                    user_id, workspace_id
                )));
            }

            let stored_password_hash = tx
                .workspace_password(workspace_id)
                .ok_or_else(|| NetworkError::msg("Workspace password not found"))?;

            let password_valid = bcrypt::verify(&workspace_master_password, &stored_password_hash)
                .map_err(|_| NetworkError::msg("Password verification failed"))?;

            if !password_valid {
                return Err(NetworkError::msg("Incorrect workspace master password"));
            }

            if let Domain::Workspace { mut workspace } = domain.clone() {
                if let Some(n) = name {
                    workspace.name = n.to_string();
                }
                if let Some(d) = description {
                    workspace.description = d.to_string();
                }
                if let Some(m) = metadata {
                    workspace.metadata = m;
                }
                workspace.password_protected = !workspace_master_password.is_empty();
                tx.set_workspace_password(workspace_id, &workspace_master_password)?;

                let updated_domain = Domain::Workspace {
                    workspace: workspace.clone(),
                };
                tx.update_domain(workspace_id, updated_domain)?;

                tx.update_workspace(workspace_id, workspace.clone())?;

                Ok(workspace)
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not a workspace",
                    workspace_id
                )))
            }
        })
    }

    fn load_workspace(
        &self,
        user_id: &str,
        workspace_id_opt: Option<&str>,
    ) -> Result<Workspace, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            if let Some(workspace_id) = workspace_id_opt {
                if !self.check_entity_permission(tx, user_id, workspace_id, Permission::All)? {
                    return Err(NetworkError::msg(format!(
                        "User '{}' does not have permission to access workspace '{}'",
                        user_id, workspace_id
                    )));
                }

                let domain = tx.get_domain(workspace_id).ok_or_else(|| {
                    NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
                })?;

                if let Domain::Workspace { workspace } = domain {
                    Ok(workspace.clone())
                } else {
                    Err(NetworkError::msg(format!(
                        "Entity '{}' is not a workspace",
                        workspace_id
                    )))
                }
            } else {
                let domains = tx.get_all_domains()?;

                for (_id, domain) in domains {
                    if let Domain::Workspace { workspace } = domain {
                        if workspace.members.contains(&user_id.to_string())
                            || workspace.owner_id == user_id
                        {
                            return Ok(workspace.clone());
                        }
                    }
                }

                Err(NetworkError::msg(format!(
                    "No workspace found for user '{}'",
                    user_id
                )))
            }
        })
    }

    fn delete_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
        _workspace_password: String,
    ) -> Result<(), NetworkError> {
        self.tx_manager.with_write_transaction(|tx| {
            if workspace_id == crate::WORKSPACE_ROOT_ID {
                return Err(NetworkError::msg("Cannot delete the root workspace"));
            }

            if tx.get_user(user_id).is_none() {
                return Err(NetworkError::msg(format!("User '{}' not found", user_id)));
            }

            if !self.check_entity_permission(
                tx,
                user_id,
                workspace_id,
                Permission::DeleteWorkspace,
            )? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to delete workspace '{}'",
                    user_id, workspace_id
                )));
            }

            tx.remove_workspace(workspace_id)?;

            Ok(())
        })
    }

    fn get_all_workspace_ids(&self) -> Result<WorkspaceDBList, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            let all_domains = tx.get_all_domains()?;
            let mut workspace_ids = Vec::new();

            for (_id, domain) in all_domains {
                if let Domain::Workspace { workspace } = domain {
                    workspace_ids.push(workspace.id.clone());
                }
            }

            let list = WorkspaceDBList {
                workspaces: workspace_ids,
            };
            Ok(list)
        })
    }

    fn list_offices_in_workspace(
        &self,
        user_id: &str,
        workspace_id: &str,
    ) -> Result<Vec<Office>, NetworkError> {
        self.tx_manager.with_read_transaction(|tx| {
            if tx.get_user(user_id).is_none() {
                return Err(NetworkError::msg(format!("User '{}' not found", user_id)));
            }

            let workspace_domain = tx.get_domain(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;

            if let Domain::Workspace { workspace: _ } = workspace_domain {
                // Continue
            } else {
                return Err(NetworkError::msg(format!(
                    "Entity '{}' is not a workspace",
                    workspace_id
                )));
            }

            if !self.check_entity_permission(tx, user_id, workspace_id, Permission::All)? {
                return Err(NetworkError::msg(format!(
                    "User '{}' does not have permission to view workspace '{}'",
                    user_id, workspace_id
                )));
            }

            let workspace_domain = tx.get_domain(workspace_id).ok_or_else(|| {
                NetworkError::msg(format!("Workspace '{}' not found", workspace_id))
            })?;

            if let Domain::Workspace { workspace } = workspace_domain {
                let mut offices = Vec::new();

                for office_id in &workspace.offices {
                    if let Some(Domain::Office { office }) = tx.get_domain(office_id) {
                        offices.push(office.clone());
                    }
                }

                Ok(offices)
            } else {
                Err(NetworkError::msg(format!(
                    "Entity '{}' is not a workspace",
                    workspace_id
                )))
            }
        })
    }
}

impl<R: Ratchet + Send + Sync + 'static> DomainServerOperations<R> {
    /// Determine if a user should be promoted to a custom role based on their permissions
    fn determine_custom_role_from_permissions(user: &User) -> Option<UserRole> {
        // Check if user already has a custom role with appropriate rank
        if let UserRole::Custom(_, rank) = &user.role {
            if *rank >= 16 {
                return None; // Already has appropriate custom role
            }
        }

        // Collect all permissions across all domains
        let mut all_permissions = std::collections::HashSet::new();
        for permissions in user.permissions.values() {
            all_permissions.extend(permissions.iter().cloned());
        }

        // Check for Editor role criteria: EditMdx + any config editing permission
        if all_permissions.contains(&Permission::EditMdx)
            && (all_permissions.contains(&Permission::EditOfficeConfig)
                || all_permissions.contains(&Permission::EditRoomConfig)
                || all_permissions.contains(&Permission::EditWorkspaceConfig))
        {
            return UserRole::create_custom_role("Editor".to_string(), 16);
        }

        None
    }
}
