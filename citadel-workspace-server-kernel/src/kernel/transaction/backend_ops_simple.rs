//! Simplified backend operations for BackendTransactionManager
//!
//! This module provides simple async methods for the BackendTransactionManager without complex lifetimes.
//! Operations on domains, users, workspaces, and passwords use per-entity storage keys
//! (e.g. `citadel_workspace.domain.{id}`) with an index of IDs, rather than fetching
//! and re-saving the entire collection for every single-entity operation.

use crate::kernel::transaction::BackendTransactionManager;
use crate::kernel::transaction::{
    KEY_INDEX_DOMAIN_IDS, KEY_INDEX_USER_IDS, KEY_INDEX_WORKSPACE_IDS, KEY_SCHEMA_VERSION,
};
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{Domain, DomainNode, TreeSchema, User, Workspace};

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    /// Initialize the backend transaction manager and run migration if needed.
    pub async fn init(&self) -> Result<(), NetworkError> {
        self.migrate_if_needed().await
    }

    /// Simple method to get a domain (per-entity key lookup, O(1))
    pub async fn get_domain(&self, domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        self.get_domain_by_key(domain_id).await
    }

    /// Simple method to get a user (per-entity key lookup, O(1))
    pub async fn get_user(&self, user_id: &str) -> Result<Option<User>, NetworkError> {
        self.get_user_by_key(user_id).await
    }

    /// Simple method to get a workspace (per-entity key lookup, O(1))
    pub async fn get_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Option<Workspace>, NetworkError> {
        self.get_workspace_by_key(workspace_id).await
    }

    // Insert/remove pairs below are intentionally written as
    // "save → index" (insert) and "delete → index" (remove) with a
    // best-effort rollback on the second step. The two underlying
    // operations are independent backend writes; if the second fails
    // the first must be undone so that:
    //
    //   * `get_all_*` (which walks the index) can never see an entity
    //     whose entity-key save failed, and
    //   * the entity store can never hold a payload that no index
    //     entry points to (an orphan that consumes storage forever
    //     and is invisible to bulk lookups).
    //
    // The rollback uses `let _ = ... .await;` because the *real*
    // failure to surface to the caller is the original index error;
    // the rollback's own failure is logged via the warn! macros in
    // the underlying delete/save methods and there is nothing more
    // sensible the request handler can do with two stacked errors.

    /// Insert a domain: save entity, then add to index. On index-write
    /// failure, deletes the entity to avoid orphans.
    pub async fn insert_domain(
        &self,
        domain_id: String,
        domain: Domain,
    ) -> Result<(), NetworkError> {
        self.save_domain_by_key(&domain_id, &domain).await?;
        if let Err(e) = self.add_to_index(KEY_INDEX_DOMAIN_IDS, &domain_id).await {
            let _ = self.delete_domain_key(&domain_id).await;
            return Err(e);
        }
        Ok(())
    }

    /// Insert a user: save entity, then add to index. On index-write
    /// failure, deletes the entity to avoid orphans.
    pub async fn insert_user(&self, user_id: String, user: User) -> Result<(), NetworkError> {
        self.save_user_by_key(&user_id, &user).await?;
        if let Err(e) = self.add_to_index(KEY_INDEX_USER_IDS, &user_id).await {
            let _ = self.delete_user_key(&user_id).await;
            return Err(e);
        }
        Ok(())
    }

    /// Insert a workspace: save entity, then add to index. On
    /// index-write failure, deletes the entity to avoid orphans.
    pub async fn insert_workspace(
        &self,
        workspace_id: String,
        workspace: Workspace,
    ) -> Result<(), NetworkError> {
        self.save_workspace_by_key(&workspace_id, &workspace)
            .await?;
        if let Err(e) = self
            .add_to_index(KEY_INDEX_WORKSPACE_IDS, &workspace_id)
            .await
        {
            let _ = self.delete_workspace_key(&workspace_id).await;
            return Err(e);
        }
        Ok(())
    }

    /// Remove a domain: delete entity, then remove from index. On
    /// index-write failure, re-saves the entity so it remains visible
    /// to `get_all_domains` (avoids dangling index entries pointing
    /// to a missing payload).
    pub async fn remove_domain(&self, domain_id: &str) -> Result<Option<Domain>, NetworkError> {
        let removed = self.get_domain_by_key(domain_id).await?;
        if let Some(ref d) = removed {
            self.delete_domain_key(domain_id).await?;
            if let Err(e) = self
                .remove_from_index(KEY_INDEX_DOMAIN_IDS, domain_id)
                .await
            {
                let _ = self.save_domain_by_key(domain_id, d).await;
                return Err(e);
            }
        }
        Ok(removed)
    }

    /// Remove a user: delete entity, then remove from index. On
    /// index-write failure, re-saves the entity so it remains visible
    /// to `get_all_users`.
    pub async fn remove_user(&self, user_id: &str) -> Result<Option<User>, NetworkError> {
        let removed = self.get_user_by_key(user_id).await?;
        if let Some(ref u) = removed {
            self.delete_user_key(user_id).await?;
            if let Err(e) = self.remove_from_index(KEY_INDEX_USER_IDS, user_id).await {
                let _ = self.save_user_by_key(user_id, u).await;
                return Err(e);
            }
        }
        Ok(removed)
    }

    /// Remove a workspace: delete entity + password, then remove from
    /// index. On index-write failure, re-saves the entity so it
    /// remains visible to `get_all_workspaces`.
    ///
    /// Also deletes the per-workspace password key. Without this, the
    /// password value stored at `citadel_workspace.password.{id}`
    /// would be orphaned in the backend after the workspace was
    /// removed, leaking secret material indefinitely and risking
    /// re-association if a workspace ID were ever reused.
    ///
    /// The password is intentionally NOT restored on rollback: a
    /// failed remove leaves the workspace itself recoverable, but
    /// callers must re-set the password explicitly. Caching the
    /// plaintext password just to support a rare rollback path would
    /// keep secret material live in memory longer than necessary.
    pub async fn remove_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Option<Workspace>, NetworkError> {
        let removed = self.get_workspace_by_key(workspace_id).await?;
        if let Some(ref w) = removed {
            self.delete_workspace_key(workspace_id).await?;
            self.delete_password_key(workspace_id).await?;
            if let Err(e) = self
                .remove_from_index(KEY_INDEX_WORKSPACE_IDS, workspace_id)
                .await
            {
                let _ = self.save_workspace_by_key(workspace_id, w).await;
                return Err(e);
            }
        }
        Ok(removed)
    }

    /// Get workspace password (per-entity key lookup, O(1))
    pub async fn get_workspace_password(
        &self,
        workspace_id: &str,
    ) -> Result<Option<String>, NetworkError> {
        self.get_password_by_key(workspace_id).await
    }

    /// Set workspace password (per-entity key save, O(1))
    pub async fn set_workspace_password(
        &self,
        workspace_id: &str,
        password: &str,
    ) -> Result<(), NetworkError> {
        self.save_password_by_key(workspace_id, password).await
    }

    /// Update domain (per-entity key save, O(1); index unchanged)
    pub async fn update_domain(&self, domain_id: &str, domain: Domain) -> Result<(), NetworkError> {
        self.save_domain_by_key(domain_id, &domain).await?;
        // Ensure the ID is in the index (idempotent)
        self.add_to_index(KEY_INDEX_DOMAIN_IDS, domain_id).await
    }

    /// Update workspace (per-entity key save, O(1); index unchanged)
    pub async fn update_workspace(
        &self,
        workspace_id: &str,
        workspace: Workspace,
    ) -> Result<(), NetworkError> {
        self.save_workspace_by_key(workspace_id, &workspace).await?;
        self.add_to_index(KEY_INDEX_WORKSPACE_IDS, workspace_id)
            .await
    }

    /// Update user (per-entity key save, O(1); index unchanged)
    pub async fn update_user(&self, user_id: &str, user: User) -> Result<(), NetworkError> {
        self.save_user_by_key(user_id, &user).await?;
        self.add_to_index(KEY_INDEX_USER_IDS, user_id).await
    }

    // ========== DomainNode (Generalized Tree Hierarchy) Operations ==========
    // Note: DomainNode storage is NOT migrated to per-entity keys (not requested).

    /// Get a single DomainNode by ID
    pub async fn get_node(&self, node_id: &str) -> Result<Option<DomainNode>, NetworkError> {
        let nodes = self.get_all_nodes().await?;
        Ok(nodes.get(node_id).cloned())
    }

    /// Insert a DomainNode
    pub async fn insert_node(&self, node_id: String, node: DomainNode) -> Result<(), NetworkError> {
        let mut nodes = self.get_all_nodes().await?;
        nodes.insert(node_id, node);
        self.save_nodes(&nodes).await
    }

    /// Remove a DomainNode
    pub async fn remove_node(&self, node_id: &str) -> Result<Option<DomainNode>, NetworkError> {
        let mut nodes = self.get_all_nodes().await?;
        let removed = nodes.remove(node_id);
        if removed.is_some() {
            self.save_nodes(&nodes).await?;
        }
        Ok(removed)
    }

    /// Update a DomainNode
    pub async fn update_node(&self, node_id: &str, node: DomainNode) -> Result<(), NetworkError> {
        let mut nodes = self.get_all_nodes().await?;
        nodes.insert(node_id.to_string(), node);
        self.save_nodes(&nodes).await?;
        Ok(())
    }

    /// Get the tree schema, returning default if not set
    pub async fn get_tree_schema_or_default(&self) -> Result<TreeSchema, NetworkError> {
        match self.get_tree_schema().await? {
            Some(schema) => Ok(schema),
            None => Ok(TreeSchema::default()),
        }
    }

    // ========== Schema Version Operations ==========

    /// Get the current schema version from the backend.
    /// Returns `None` if no schema version has been set yet (fresh database).
    pub async fn get_schema_version(&self) -> Result<Option<u32>, NetworkError> {
        self.backend_get(KEY_SCHEMA_VERSION).await
    }

    /// Set the schema version in the backend.
    pub async fn set_schema_version(&self, version: u32) -> Result<(), NetworkError> {
        self.backend_save(KEY_SCHEMA_VERSION, &version).await
    }
}
