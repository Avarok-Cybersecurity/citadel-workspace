use crate::kernel::transaction::write::WriteTransaction;
use crate::kernel::transaction::{WorkspaceChange, WorkspaceOperations};
use citadel_sdk::prelude::NetworkError;
use citadel_workspace_types::structs::Workspace;

impl WriteTransaction<'_> {
    /// Get a workspace by ID - workspace management implementation
    pub fn get_workspace_internal(&self, workspace_id: &str) -> Option<&Workspace> {
        self.workspaces.get(workspace_id)
    }

    /// Get a mutable reference to a workspace - workspace management implementation
    pub fn get_workspace_mut_internal(&mut self, workspace_id: &str) -> Option<&mut Workspace> {
        // Track the change before returning the mutable reference
        if let Some(workspace) = self.workspaces.get(workspace_id) {
            self.workspace_changes.push(WorkspaceChange::Update(
                workspace_id.to_string(),
                workspace.clone(),
            ));
        }

        self.workspaces.get_mut(workspace_id)
    }

    /// Get all workspaces in the system - workspace management implementation
    pub fn get_all_workspaces_internal(&self) -> &std::collections::HashMap<String, Workspace> {
        &self.workspaces
    }

    /// Insert a new workspace - workspace management implementation
    pub fn insert_workspace_internal(
        &mut self,
        workspace_id: String,
        workspace: Workspace,
    ) -> Result<(), NetworkError> {
        if self.workspaces.contains_key(&workspace_id) {
            return Err(NetworkError::msg(format!(
                "Workspace with ID {} already exists",
                workspace_id
            )));
        }

        self.workspaces.insert(workspace_id, workspace);
        Ok(())
    }

    /// Update an existing workspace - workspace management implementation
    pub fn update_workspace_internal(
        &mut self,
        workspace_id: &str,
        new_workspace: Workspace,
    ) -> Result<(), NetworkError> {
        if !self.workspaces.contains_key(workspace_id) {
            return Err(NetworkError::msg(format!(
                "Workspace with ID {} does not exist",
                workspace_id
            )));
        }

        // Track the change before updating
        if let Some(old_workspace) = self.workspaces.get(workspace_id) {
            self.workspace_changes.push(WorkspaceChange::Update(
                workspace_id.to_string(),
                old_workspace.clone(),
            ));
        }

        self.workspaces
            .insert(workspace_id.to_string(), new_workspace);
        Ok(())
    }

    /// Remove a workspace - workspace management implementation
    pub fn remove_workspace_internal(
        &mut self,
        workspace_id: &str,
    ) -> Result<Option<Workspace>, NetworkError> {
        // Track the change before removing
        if let Some(old_workspace) = self.workspaces.get(workspace_id) {
            self.workspace_changes.push(WorkspaceChange::Remove(
                workspace_id.to_string(),
                old_workspace.clone(),
            ));
        }

        Ok(self.workspaces.remove(workspace_id))
    }
}

// Implement the WorkspaceOperations trait
impl WorkspaceOperations for WriteTransaction<'_> {
    /// Get a workspace by ID
    fn get_workspace(&self, workspace_id: &str) -> Option<&Workspace> {
        self.workspaces.get(workspace_id)
    }

    /// Add a new workspace
    fn add_workspace(
        &mut self,
        workspace_id: &str,
        workspace: &mut Workspace,
    ) -> Result<(), NetworkError> {
        // Track the change for rollback
        if self.workspaces.contains_key(workspace_id) {
            // If it exists, track as an update
            if let Some(old_workspace) = self.workspaces.get(workspace_id) {
                self.workspace_changes.push(WorkspaceChange::Update(
                    workspace_id.to_string(),
                    old_workspace.clone(),
                ));
            }
        } else {
            // If it's new, track as an insert
            self.workspace_changes
                .push(WorkspaceChange::Insert(workspace_id.to_string()));
        }

        // Insert or update the workspace
        self.workspaces
            .insert(workspace_id.to_string(), workspace.clone());
        Ok(())
    }

    /// Remove a workspace
    fn remove_workspace(&mut self, workspace_id: &str) -> Result<(), NetworkError> {
        if let Some(old_workspace) = self.workspaces.get(workspace_id) {
            // Track the change for rollback
            self.workspace_changes.push(WorkspaceChange::Remove(
                workspace_id.to_string(),
                old_workspace.clone(),
            ));

            // Remove the workspace
            self.workspaces.remove(workspace_id);
            Ok(())
        } else {
            Err(NetworkError::msg(format!(
                "Workspace with id {} not found",
                workspace_id
            )))
        }
    }

    /// Update a workspace
    fn update_workspace(
        &mut self,
        workspace_id: &str,
        workspace: Workspace,
    ) -> Result<(), NetworkError> {
        if let Some(old_workspace) = self.workspaces.get(workspace_id) {
            // Track the change for rollback
            self.workspace_changes.push(WorkspaceChange::Update(
                workspace_id.to_string(),
                old_workspace.clone(),
            ));

            // Update the workspace
            self.workspaces.insert(workspace_id.to_string(), workspace);
            Ok(())
        } else {
            Err(NetworkError::msg(format!(
                "Workspace with id {} not found",
                workspace_id
            )))
        }
    }
}
