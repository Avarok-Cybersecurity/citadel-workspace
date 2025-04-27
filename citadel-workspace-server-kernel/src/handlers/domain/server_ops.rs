use crate::handlers::domain;
use crate::handlers::domain::{DomainEntity, DomainOperations};
use crate::handlers::transaction::Transaction;
use crate::WorkspaceServerKernel;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{
    Domain, Office, Permission, Room, User, UserRole, Workspace,
};
use std::sync::Arc;
use uuid::Uuid;

/// Server-side implementation of domain operations
pub struct ServerDomainOps<R: Ratchet> {
    kernel: Arc<WorkspaceServerKernel<R>>,
}

impl<R: Ratchet> ServerDomainOps<R> {
    /// Create a new instance of ServerDomainOps
    pub fn new(kernel: Arc<WorkspaceServerKernel<R>>) -> Self {
        Self { kernel }
    }

    /// Execute a function with a read transaction
    pub fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>,
    {
        // Use the kernel's transaction manager
        self.kernel.with_read_transaction(f)
    }

    /// Execute a function with a write transaction
    pub fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>,
    {
        // Use the kernel's transaction manager
        self.kernel.with_write_transaction(f)
    }
}

impl<R: Ratchet> DomainOperations<R> for ServerDomainOps<R> {
    fn init(&self) -> Result<(), NetworkError> {
        // Nothing to initialize for the server implementation
        Ok(())
    }

    fn kernel(&self) -> &WorkspaceServerKernel<R> {
        &self.kernel
    }

    fn is_admin(&self, user_id: &str) -> bool {
        // Delegate to the kernel's admin check
        self.kernel.is_admin(user_id)
    }

    fn get_user(&self, user_id: &str) -> Option<User> {
        // Use transaction manager to get user
        self.kernel
            .with_read_transaction(|tx| Ok(tx.get_user(user_id).cloned()))
            .unwrap_or(None)
    }

    fn with_read_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&dyn Transaction) -> Result<T, NetworkError>,
    {
        // Use the kernel's transaction manager
        self.kernel.with_read_transaction(f)
    }

    fn with_write_transaction<F, T>(&self, f: F) -> Result<T, NetworkError>
    where
        F: FnOnce(&mut dyn Transaction) -> Result<T, NetworkError>,
    {
        // Use the kernel's transaction manager
        self.kernel.with_write_transaction(f)
    }

    fn check_entity_permission(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        // Delegate to the centralized permission checking system in the kernel
        self.kernel
            .check_entity_permission(user_id, entity_id, permission)
    }

    fn is_member_of_domain(&self, user_id: &str, domain_id: &str) -> Result<bool, NetworkError> {
        // Delegate to the kernel's implementation
        self.kernel.is_member_of_domain(user_id, domain_id)
    }

    fn check_permission<T: DomainEntity + 'static>(
        &self,
        user_id: &str,
        entity_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        // Since this is identical to check_entity_permission, just call that
        self.check_entity_permission(user_id, entity_id, permission)
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
        self.kernel.with_write_transaction(|tx| {
            let domain = tx
                .get_domain(domain_id)
                .cloned()
                .ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?;

            // Update domain with updated user list
            match domain {
                Domain::Office { mut office } => {
                    // Add user to members if not already present
                    if !office.members.contains(&user_id.to_string()) {
                        office.members.push(user_id.to_string());
                    }
                    let updated_domain = Domain::Office { office };
                    tx.update_domain(domain_id, updated_domain)?;
                    Ok(())
                }
                Domain::Room { mut room } => {
                    // Add user to members if not already present
                    if !room.members.contains(&user_id.to_string()) {
                        room.members.push(user_id.to_string());
                    }
                    let updated_domain = Domain::Room { room };
                    tx.update_domain(domain_id, updated_domain)?;
                    Ok(())
                }
                Domain::Workspace { mut workspace } => {
                    // Add user to members if not already present
                    if !workspace.members.contains(&user_id.to_string()) {
                        workspace.members.push(user_id.to_string());
                    }
                    let updated_domain = Domain::Workspace { workspace };
                    tx.update_domain(domain_id, updated_domain)?;
                    Ok(())
                }
            }
        })
    }

    fn remove_user_from_domain(&self, _user_id: &str, domain_id: &str) -> Result<(), NetworkError> {
        self.kernel.with_write_transaction(|tx| {
            // Get domain by ID
            let domain = tx
                .get_domain(domain_id)
                .cloned()
                .ok_or_else(|| NetworkError::msg(format!("Domain {} not found", domain_id)))?;

            // Remove user from domain
            match domain {
                Domain::Office { mut office } => {
                    // Remove user from members
                    office.members.retain(|id| id != _user_id);
                    let updated_domain = Domain::Office { office };
                    tx.update_domain(domain_id, updated_domain)?;
                    Ok(())
                }
                Domain::Room { mut room } => {
                    // Remove user from members
                    room.members.retain(|id| id != _user_id);
                    let updated_domain = Domain::Room { room };
                    tx.update_domain(domain_id, updated_domain)?;
                    Ok(())
                }
                Domain::Workspace { mut workspace } => {
                    // Remove user from members
                    workspace.members.retain(|id| id != _user_id);
                    let updated_domain = Domain::Workspace { workspace };
                    tx.update_domain(domain_id, updated_domain)?;
                    Ok(())
                }
            }
        })
    }

    fn get_domain_entity<T>(&self, _user_id: &str, entity_id: &str) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        self.with_read_transaction(|tx| {
            // Get domain by ID
            let domain = tx.get_domain(entity_id).ok_or_else(|| {
                domain::permission_denied(format!("Entity {} not found", entity_id))
            })?;

            // Convert to the requested type
            T::from_domain(domain.clone()).ok_or_else(|| {
                domain::permission_denied("Entity is not of the requested type".to_string())
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
        self.with_write_transaction(|tx| {
            // Get parent domain if provided
            if let Some(parent_id) = parent_id {
                if !self.can_access_domain(user_id, parent_id)? {
                    return Err(domain::permission_denied("Cannot access parent domain"));
                }
            }

            // Create entity with appropriate ID
            let entity_id = uuid::Uuid::new_v4().to_string();
            let entity = if std::any::type_name::<T>().contains("Office") {
                let office = Office {
                    id: entity_id.clone(),
                    name: name.to_string(),
                    description: description.to_string(),
                    owner_id: user_id.to_string(),
                    members: vec![user_id.to_string()], // Owner is automatically a member
                    rooms: Vec::new(),                  // Initialize with empty rooms
                    mdx_content: mdx_content.unwrap_or_default().to_string(), // Use provided MDX content or empty string
                    metadata: Vec::new(),
                };

                // Insert the office domain
                tx.insert_domain(
                    entity_id.clone(),
                    Domain::Office {
                        office: office.clone(),
                    },
                )?;

                // Convert back to T
                T::from_domain(Domain::Office { office })
                    .ok_or_else(|| domain::permission_denied("Failed to convert to entity type"))?
            } else if std::any::type_name::<T>().contains("Room") {
                let parent = parent_id
                    .ok_or_else(|| domain::permission_denied("Room requires a parent office ID"))?
                    .to_string();

                let room = Room {
                    id: entity_id.clone(),
                    name: name.to_string(),
                    description: description.to_string(),
                    office_id: parent,
                    owner_id: user_id.to_string(),
                    members: vec![user_id.to_string()], // Owner is automatically a member
                    mdx_content: mdx_content.unwrap_or_default().to_string(), // Use provided MDX content or empty string
                    metadata: Vec::new(),
                };

                // Insert the room domain
                tx.insert_domain(entity_id.clone(), Domain::Room { room: room.clone() })?;

                // Convert back to T
                T::from_domain(Domain::Room { room })
                    .ok_or_else(|| domain::permission_denied("Failed to convert to entity type"))?
            } else if std::any::type_name::<T>().contains("Workspace") {
                let workspace = Workspace {
                    id: entity_id.clone(),
                    name: name.to_string(),
                    description: description.to_string(),
                    owner_id: user_id.to_string(),
                    members: vec![user_id.to_string()],
                    offices: Vec::new(),
                    metadata: Vec::new(),
                };

                // Insert the workspace domain
                tx.insert_domain(
                    entity_id.clone(),
                    Domain::Workspace {
                        workspace: workspace.clone(),
                    },
                )?;

                // Convert back to T
                T::from_domain(Domain::Workspace { workspace })
                    .ok_or_else(|| domain::permission_denied("Failed to convert to entity type"))?
            } else {
                return Err(domain::permission_denied("Unsupported entity type"));
            };

            Ok(entity)
        })
    }

    fn delete_domain_entity<T>(&self, user_id: &str, entity_id: &str) -> Result<T, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        self.with_write_transaction(|tx| {
            // Check if user has permission to delete
            if !self.can_access_domain(user_id, entity_id)? {
                return Err(domain::permission_denied("No permission to delete entity"));
            }

            // Get the domain first to return it later
            let domain = tx.get_domain(entity_id).cloned().ok_or_else(|| {
                domain::permission_denied(format!("Entity {} not found", entity_id))
            })?;

            // Remove domain
            tx.remove_domain(entity_id)?;

            // Convert to the requested type
            T::from_domain(domain)
                .ok_or_else(|| domain::permission_denied("Entity is not of the requested type"))
        })
    }

    fn list_domain_entities<T>(
        &self,
        user_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<T>, NetworkError>
    where
        T: DomainEntity + Clone + 'static,
    {
        // Get all domains of the specified type
        let all_domains = DomainOperations::with_read_transaction(self, |tx| {
            let domains = tx.get_domains();
            Ok(domains.values().cloned().collect::<Vec<Domain>>())
        })?;

        // Filter domains by type and parent ID
        let mut filtered_domains = Vec::new();
        for domain in all_domains {
            // Skip domains that don't match the requested type
            if T::from_domain(domain.clone()).is_none() {
                continue;
            }

            // Filter by parent ID if specified
            if let Some(parent_id) = parent_id {
                if let Domain::Room { room } = &domain {
                    if room.office_id != parent_id {
                        continue;
                    }
                }
            }

            // Check if user has access to this domain
            if let Ok(has_access) = ServerDomainOps::can_access_domain(self, user_id, domain.id()) {
                if has_access {
                    if let Some(entity) = T::from_domain(domain) {
                        filtered_domains.push(entity);
                    }
                }
            }
        }

        Ok(filtered_domains)
    }

    fn create_office(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        mdx_content: Option<&str>,
    ) -> Result<Office, NetworkError> {
        // Check if user has permission to create offices
        let workspace_id = crate::WORKSPACE_ROOT_ID;

        // Check if user is admin, workspace owner, or has CreateOffice permission
        let is_authorized = self.with_read_transaction(|tx| {
            if self.kernel.is_admin(user_id) {
                return Ok(true);
            }

            // Check if user is workspace owner
            if let Some(domain) = tx.get_domain(&workspace_id) {
                if let Domain::Workspace { workspace } = domain {
                    if workspace.owner_id == user_id {
                        return Ok(true);
                    }
                }
            }

            // Check if user has CreateOffice permission
            Ok(self
                .check_entity_permission(user_id, &workspace_id, Permission::CreateOffice)
                .unwrap_or(false))
        })?;

        if !is_authorized {
            return Err(NetworkError::msg("Permission denied: Cannot create office. Must be admin, workspace owner, or have CreateOffice permission"));
        }

        self.with_write_transaction(|tx| {
            // Generate ID for the new office
            let office_id = uuid::Uuid::new_v4().to_string();

            // Create the office
            let office = Office {
                id: office_id.clone(),
                name: name.to_string(),
                description: description.to_string(),
                owner_id: user_id.to_string(),
                members: vec![user_id.to_string()], // Owner is automatically a member
                rooms: Vec::new(),                  // Initialize with empty rooms
                mdx_content: mdx_content.unwrap_or_default().to_string(), // Use provided MDX content or empty string
                metadata: Vec::new(),
            };

            // Insert into domains
            tx.insert_domain(
                office_id,
                Domain::Office {
                    office: office.clone(),
                },
            )?;

            Ok(office)
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
        // Check if user has permission to create a room in this office
        if !self.check_entity_permission(user_id, office_id, Permission::CreateRoom)? {
            return Err(domain::permission_denied(
                "You don't have permission to create rooms in this office",
            ));
        }

        self.with_write_transaction(|tx| {
            // Generate a unique ID for the new room
            let room_id = Uuid::new_v4().to_string();

            // Create the room
            let room = Room {
                id: room_id.clone(),
                name: name.to_string(),
                description: description.to_string(),
                office_id: office_id.to_string(),
                owner_id: user_id.to_string(),
                members: vec![user_id.to_string()], // Owner is automatically a member
                mdx_content: mdx_content.unwrap_or_default().to_string(), // Use provided MDX content or empty string
                metadata: Vec::new(),
            };

            // Add it to the database
            tx.insert_domain(room_id, Domain::Room { room: room.clone() })?;
            Ok(room)
        })
    }

    fn get_office(&self, user_id: &str, office_id: &str) -> Result<Office, NetworkError> {
        // Check if user can access this office
        if !ServerDomainOps::can_access_domain(self, user_id, office_id)? {
            return Err(domain::permission_denied(
                "User does not have permission to access this office",
            ));
        }

        // Get the office entity
        DomainOperations::get_domain_entity::<Office>(self, user_id, office_id)
    }

    fn get_room(&self, user_id: &str, room_id: &str) -> Result<Room, NetworkError> {
        // Check if user can access this room
        if !self.kernel.check_room_access(user_id, room_id)? {
            return Err(domain::permission_denied(
                "User does not have permission to access this room",
            ));
        }

        // Get the room entity
        DomainOperations::get_domain_entity::<Room>(self, user_id, room_id)
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
        // Check if user can access this office
        if !ServerDomainOps::can_access_domain(self, user_id, office_id)? {
            return Err(domain::permission_denied(
                "User does not have permission to access this office",
            ));
        }

        // List rooms in this office
        DomainOperations::list_domain_entities::<Room>(self, user_id, Some(office_id))
    }

    fn check_room_access(&self, user_id: &str, room_id: &str) -> Result<bool, NetworkError> {
        // Delegate to the kernel's implementation for consistent behavior
        self.kernel.check_room_access(user_id, room_id)
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
        self.with_write_transaction(|tx| {
            // Check if user has permission to update
            if !self.can_access_domain(user_id, domain_id)? {
                return Err(domain::permission_denied("No permission to update entity"));
            }

            // Get domain by ID
            let mut domain = tx.get_domain(domain_id).cloned().ok_or_else(|| {
                domain::permission_denied(format!("Entity {} not found", domain_id))
            })?;

            // Update domain properties
            match &mut domain {
                Domain::Office { ref mut office } => {
                    if let Some(name) = name {
                        office.name = name.to_string();
                    }
                    if let Some(description) = description {
                        office.description = description.to_string();
                    }
                    if let Some(mdx) = mdx_content {
                        office.mdx_content = mdx.to_string();
                    }
                }
                Domain::Room { ref mut room } => {
                    if let Some(name) = name {
                        room.name = name.to_string();
                    }
                    if let Some(description) = description {
                        room.description = description.to_string();
                    }
                    if let Some(mdx) = mdx_content {
                        room.mdx_content = mdx.to_string();
                    }
                }
                Domain::Workspace { ref mut workspace } => {
                    if let Some(name) = name {
                        workspace.name = name.to_string();
                    }
                    if let Some(description) = description {
                        workspace.description = description.to_string();
                    }
                    // Workspaces don't have mdx_content, so ignore that parameter
                }
            }

            // Update domain
            tx.update_domain(domain_id, domain.clone())?;

            // Convert to the requested type
            T::from_domain(domain)
                .ok_or_else(|| domain::permission_denied("Entity is not of the requested type"))
        })
    }

    /// Get the single workspace that exists in the system
    fn get_workspace(&self, user_id: &str, _workspace_id: &str) -> Result<Workspace, NetworkError> {
        let perm_kernel = self.kernel.clone();
        let actual_workspace_id = crate::WORKSPACE_ROOT_ID;

        self.with_read_transaction(move |tx| {
            let domain = tx
                .get_domain(&actual_workspace_id)
                .ok_or_else(|| NetworkError::msg(format!("Workspace not found")))?;

            match domain {
                Domain::Workspace { workspace } => {
                    // Check if user has permission to access the workspace
                    if perm_kernel.is_admin(user_id)
                        || workspace.members.contains(&user_id.to_string())
                    {
                        Ok(workspace.clone())
                    } else {
                        Err(NetworkError::msg("Not authorized to access this workspace"))
                    }
                }
                _ => Err(NetworkError::msg("Domain is not a workspace")),
            }
        })
    }

    fn create_workspace(
        &self,
        user_id: &str,
        name: &str,
        description: &str,
        metadata: Option<Vec<u8>>,
    ) -> Result<Workspace, NetworkError> {
        // Ensure user has permission to create workspaces
        if !self.check_entity_permission(user_id, "global", Permission::CreateWorkspace)? {
            return Err(NetworkError::msg(
                "Permission denied: Cannot create workspace",
            ));
        }

        // Check if a workspace already exists
        let existing_workspace = self.with_read_transaction(|tx| {
            let workspaces = tx.get_workspaces();
            Ok(!workspaces.is_empty())
        })?;

        if existing_workspace {
            return Err(NetworkError::msg(
                "A workspace already exists. Only one workspace is allowed in the system.",
            ));
        }

        // Generate a unique ID for the new workspace
        let workspace_id = crate::WORKSPACE_ROOT_ID.to_string();

        let metadata = metadata.unwrap_or_default();

        match self.with_write_transaction(move |tx| {
            // Create the workspace
            let workspace = Workspace {
                id: workspace_id.clone(),
                name: name.to_string(),
                description: description.to_string(),
                owner_id: user_id.to_string(),
                members: vec![user_id.to_string()],
                offices: Vec::new(),
                metadata,
            };

            // Add the workspace to the transaction
            tx.insert_domain(
                workspace_id.clone(),
                Domain::Workspace {
                    workspace: workspace.clone(),
                },
            )?;

            Ok(workspace)
        }) {
            Ok(result) => Ok(result),
            Err(err) => Err(err),
        }
    }

    fn delete_workspace(
        &self,
        user_id: &str,
        _workspace_id: &str,
    ) -> Result<Workspace, NetworkError> {
        // Use fixed workspace-root ID
        let actual_workspace_id = crate::WORKSPACE_ROOT_ID;

        // Ensure user has permission to delete workspaces
        if !self.check_entity_permission(
            user_id,
            &actual_workspace_id,
            Permission::DeleteWorkspace,
        )? {
            return Err(NetworkError::msg(
                "Permission denied: Cannot delete workspace",
            ));
        }

        // Get the workspace first to return it later
        let workspace = self.get_workspace(user_id, &actual_workspace_id)?;

        self.with_write_transaction(move |tx| {
            // Get the workspace
            let domain = tx
                .get_domain(&actual_workspace_id)
                .ok_or_else(|| NetworkError::msg("Workspace not found"))?;

            if let Domain::Workspace { workspace } = domain {
                // First collect all office IDs to avoid borrowing issues
                let office_ids: Vec<String> = workspace.offices.clone();

                // Then delete all offices
                for office_id in &office_ids {
                    let _ = tx.remove_domain(office_id)?;
                }
            }

            // Delete the workspace itself
            let _ = tx.remove_domain(&actual_workspace_id)?;

            Ok(())
        })?;

        // Return the workspace that was deleted
        Ok(workspace)
    }

    fn update_workspace(
        &self,
        user_id: &str,
        _workspace_id: &str,
        name: Option<&str>,
        description: Option<&str>,
        metadata: Option<Vec<u8>>,
    ) -> Result<Workspace, NetworkError> {
        // Use fixed workspace-root ID
        let workspace_id = crate::WORKSPACE_ROOT_ID.to_string();

        // Ensure user has permission to update workspaces
        if !self.check_entity_permission(user_id, &workspace_id, Permission::UpdateWorkspace)? {
            return Err(NetworkError::msg(
                "Permission denied: Cannot update workspace",
            ));
        }

        self.with_write_transaction(move |tx| {
            // Get the workspace
            let domain = tx
                .get_domain(&workspace_id)
                .ok_or_else(|| NetworkError::msg(format!("Workspace not found")))?;

            let mut workspace = match domain {
                Domain::Workspace { workspace } => workspace.clone(), // Clone to get owned value
                _ => return Err(NetworkError::msg("Domain is not a workspace")),
            };

            // Update the workspace fields
            if let Some(name_val) = name {
                workspace.name = name_val.to_string();
            }

            if let Some(desc_val) = description {
                workspace.description = desc_val.to_string();
            }

            if let Some(metadata_val) = metadata {
                workspace.metadata = metadata_val;
            }

            // Store the updated workspace
            tx.insert_domain(
                workspace_id,
                Domain::Workspace {
                    workspace: workspace.clone(),
                },
            )?;

            Ok(workspace)
        })
    }

    fn add_office_to_workspace(
        &self,
        user_id: &str,
        _workspace_id: &str,
        office_id: &str,
    ) -> Result<(), NetworkError> {
        // Use fixed workspace-root ID
        let workspace_id = crate::WORKSPACE_ROOT_ID.to_string();

        // Ensure user has permission to update workspaces
        if !self.check_entity_permission(user_id, &workspace_id, Permission::UpdateWorkspace)? {
            return Err(NetworkError::msg(
                "Permission denied: Cannot add office to workspace",
            ));
        }

        self.with_write_transaction(|tx| {
            // Get the workspace
            let Some(Domain::Workspace { mut workspace }) = tx.get_domain(&workspace_id).cloned()
            else {
                return Err(NetworkError::msg("Workspace not found"));
            };

            // Get the office (we only need to verify it exists, since we're not modifying it anymore)
            if tx.get_domain(office_id).is_none() {
                return Err(NetworkError::msg(format!("Office {} not found", office_id)));
            }

            // Add the office to the workspace if not already present
            if !workspace.offices.contains(&office_id.to_string()) {
                workspace.offices.push(office_id.to_string());
            }

            // No need to update office's workspace_id - it's implied by the single workspace model

            // Update workspace entity
            tx.insert_domain(workspace_id, Domain::Workspace { workspace })?;
            Ok(())
        })
    }

    fn remove_office_from_workspace(
        &self,
        user_id: &str,
        _workspace_id: &str, // Using fixed ID, so this is unused
        office_id: &str,
    ) -> Result<(), NetworkError> {
        // Use fixed workspace-root ID
        let workspace_id = crate::WORKSPACE_ROOT_ID.to_string();

        // Ensure user has permission
        if !self.check_entity_permission(user_id, &workspace_id, Permission::UpdateWorkspace)? {
            return Err(NetworkError::msg(
                "Permission denied: Cannot remove office from workspace",
            ));
        }

        self.with_write_transaction(move |tx| {
            // Get the workspace
            let domain = tx
                .get_domain(&workspace_id)
                .ok_or_else(|| NetworkError::msg("Workspace not found"))?;

            let mut workspace = match domain {
                Domain::Workspace { workspace } => workspace.clone(), // Clone to get owned value
                _ => return Err(NetworkError::msg("Domain is not a workspace")),
            };

            // Remove office from workspace
            workspace.offices.retain(|id| id != office_id);

            // Update workspace
            tx.insert_domain(workspace_id, Domain::Workspace { workspace })?;

            Ok(())
        })
    }

    fn add_user_to_workspace(
        &self,
        user_id: &str,
        member_id: &str,
        _workspace_id: &str,
    ) -> Result<(), NetworkError> {
        // Use fixed workspace-root ID
        let workspace_id = crate::WORKSPACE_ROOT_ID.to_string();

        // Ensure user has permission to update workspace
        if !self.check_entity_permission(user_id, &workspace_id, Permission::AddUsers)? {
            return Err(NetworkError::msg(
                "Permission denied: Cannot add users to workspace",
            ));
        }

        self.with_write_transaction(move |tx| {
            // Get the workspace
            let domain = tx
                .get_domain(&workspace_id)
                .ok_or_else(|| NetworkError::msg("Workspace not found"))?;

            let mut workspace = match domain {
                Domain::Workspace { workspace } => workspace.clone(), // Clone to get owned value
                _ => return Err(NetworkError::msg("Domain is not a workspace")),
            };

            // Check if member is already in workspace
            if workspace.members.contains(&member_id.to_string()) {
                return Ok(()); // Member already in workspace
            }

            // Add member to workspace
            workspace.members.push(member_id.to_string());

            // Update workspace
            tx.insert_domain(workspace_id, Domain::Workspace { workspace })?;

            Ok(())
        })
    }

    fn remove_user_from_workspace(
        &self,
        user_id: &str,
        member_id: &str,
        _workspace_id: &str,
    ) -> Result<(), NetworkError> {
        // Use fixed workspace-root ID
        let workspace_id = crate::WORKSPACE_ROOT_ID.to_string();

        // Ensure user has permission to update workspace
        if !self.check_entity_permission(user_id, &workspace_id, Permission::RemoveUsers)? {
            return Err(NetworkError::msg(
                "Permission denied: Cannot remove users from workspace",
            ));
        }

        self.with_write_transaction(move |tx| {
            // Get the workspace
            let domain = tx
                .get_domain(&workspace_id)
                .ok_or_else(|| NetworkError::msg("Workspace not found"))?;

            let mut workspace = match domain {
                Domain::Workspace { workspace } => workspace.clone(), // Clone to get owned value
                _ => return Err(NetworkError::msg("Domain is not a workspace")),
            };

            // Check if trying to remove the workspace owner
            if workspace.owner_id == member_id {
                return Err(NetworkError::msg("Cannot remove workspace owner"));
            }

            // Remove member from workspace
            workspace.members.retain(|id| id != member_id);

            // Update workspace
            tx.insert_domain(workspace_id, Domain::Workspace { workspace })?;

            Ok(())
        })
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
        // Use the fixed workspace ID, ignoring the provided workspace_id parameter
        let workspace_id = crate::WORKSPACE_ROOT_ID;

        self.with_read_transaction(|tx| {
            match tx.get_domain(workspace_id) {
                Some(Domain::Workspace { workspace }) => {
                    // Check if user has permission to view this workspace
                    if self.kernel.is_admin(user_id)
                        || workspace.owner_id == user_id
                        || workspace.members.contains(&user_id.to_string())
                    {
                        // List all offices - with the single workspace model, all offices belong to the workspace
                        let offices: Vec<Office> = tx
                            .get_domains()
                            .iter()
                            .filter_map(|(_, domain)| match domain {
                                Domain::Office { office } => {
                                    // All offices belong to the single workspace, so no need to check workspace_id
                                    Some(office.clone())
                                }
                                _ => None,
                            })
                            .collect();

                        Ok(offices)
                    } else {
                        Err(NetworkError::msg("Not authorized to access this workspace"))
                    }
                }
                _ => {
                    // If the root workspace doesn't exist yet, create it
                    if workspace_id == crate::WORKSPACE_ROOT_ID && self.kernel.is_admin(user_id) {
                        // Create the root workspace implicitly
                        let _ = self.with_write_transaction(|tx| {
                            let workspace = Workspace {
                                id: workspace_id.to_string(),
                                name: "Root Workspace".to_string(),
                                description: "Default root workspace".to_string(),
                                owner_id: user_id.to_string(),
                                members: vec![user_id.to_string()],
                                offices: vec![],
                                metadata: vec![],
                            };
                            tx.insert_domain(
                                workspace_id.to_string(),
                                Domain::Workspace { workspace },
                            )?;
                            Ok(())
                        });
                        // Return empty list of offices for newly created workspace
                        Ok(Vec::new())
                    } else {
                        Err(NetworkError::msg(format!(
                            "Workspace {} not found",
                            workspace_id
                        )))
                    }
                }
            }
        })
    }
}

impl<R: Ratchet> ServerDomainOps<R> {
    /// Helper method to check if user can access a domain
    pub fn can_access_domain(&self, user_id: &str, entity_id: &str) -> Result<bool, NetworkError> {
        // Admins can access all domains
        if self.is_admin(user_id) {
            return Ok(true);
        }

        // Check if user is a member of the domain
        self.is_member_of_domain(user_id, entity_id)
    }

    /// Helper method to check global permission
    pub fn check_global_permission(
        &self,
        user_id: &str,
        permission: Permission,
    ) -> Result<bool, NetworkError> {
        // System administrators always have all global permissions
        if self.is_admin(user_id) {
            return Ok(true);
        }

        // Check if user has the specific global permission
        if let Some(user) = self.get_user(user_id) {
            if user.has_permission("global", permission) {
                return Ok(true);
            }

            // Check if the user's role grants this permission
            match user.role {
                UserRole::Admin => Ok(true), // Admins have all permissions
                UserRole::Owner => match permission {
                    Permission::ViewContent => Ok(true),
                    Permission::EditContent => Ok(true),
                    Permission::AddUsers => Ok(true),
                    Permission::RemoveUsers => Ok(true),
                    Permission::CreateOffice => Ok(true),
                    Permission::DeleteOffice => Ok(true),
                    Permission::CreateRoom => Ok(true),
                    Permission::DeleteRoom => Ok(true),
                    Permission::CreateWorkspace => Ok(true),
                    Permission::DeleteWorkspace => Ok(true),
                    Permission::UpdateWorkspace => Ok(true),
                    Permission::EditMdx => Ok(true),
                    Permission::EditRoomConfig => Ok(true),
                    Permission::EditOfficeConfig => Ok(true),
                    Permission::AddOffice => Ok(true),
                    Permission::AddRoom => Ok(true),
                    Permission::UpdateOfficeSettings => Ok(true),
                    Permission::UpdateRoomSettings => Ok(true),
                    Permission::ManageOfficeMembers => Ok(true),
                    Permission::ManageRoomMembers => Ok(true),
                    Permission::SendMessages => Ok(true),
                    Permission::ReadMessages => Ok(true),
                    Permission::UploadFiles => Ok(true),
                    Permission::DownloadFiles => Ok(true),
                    Permission::ManageDomains => Ok(true),
                    Permission::ConfigureSystem => Ok(true),
                    Permission::All => Ok(true),
                },
                _ => Ok(false), // Other roles don't have global permissions by default
            }
        } else {
            Err(domain::permission_denied(format!(
                "User with ID {} not found",
                user_id
            )))
        }
    }
}
