//! Startup migration: a workspace still on the OLD default tree moves to the new default.
//!
//! The old default made rooms leaves and capped the tree at depth 3. A stored schema equal to
//! it is one nobody chose, so it is rewritten to the current default (its id, name and display
//! configs kept). Any other stored schema is an admin's choice and is left as it is. The check
//! runs once per workspace: after it, a schema of the old shape is a deliberate one.

use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_logging::info;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::{NestingRule, TreeSchema};

/// Set once the check has run, whatever it found.
const MIGRATION_DONE_KEY: &str = "citadel_workspace.migration.tree_schema_default_v2";
/// The old default's depth cap.
const OLD_DEFAULT_MAX_DEPTH: Option<u32> = Some(3);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TreeSchemaMigration {
    /// The check ran before; nothing was read.
    AlreadyMigrated,
    /// No schema is stored, so the workspace already reads the current default.
    NothingStored,
    Rewritten,
    LeftCustomised,
}

/// The old default's nesting rules: Workspace → [Office], Office → [Room], Room → [].
fn old_default_rules() -> Vec<NestingRule> {
    let rule = |parent: &str, children: &[&str]| NestingRule {
        parent_type: parent.to_string(),
        allowed_child_types: children.iter().map(|c| c.to_string()).collect(),
    };
    vec![
        rule("Workspace", &["Office"]),
        rule("Office", &["Room"]),
        rule("Room", &[]),
    ]
}

/// The schema to store instead of `stored`, or `None` to leave it.
fn upgraded(stored: &TreeSchema) -> Option<TreeSchema> {
    if stored.max_depth != OLD_DEFAULT_MAX_DEPTH || stored.rules != old_default_rules() {
        return None;
    }
    let current = TreeSchema::default();
    Some(TreeSchema {
        rules: current.rules,
        max_depth: current.max_depth,
        ..stored.clone()
    })
}

impl<R: Ratchet + Send + Sync + 'static> AsyncWorkspaceServerKernel<R> {
    pub async fn migrate_default_tree_schema(&self) -> Result<TreeSchemaMigration, NetworkError> {
        let backend = &self.domain_operations.backend_tx_manager;
        // Schema writes are serialised under the nodes lock (see UpdateTreeSchema).
        let _nodes_guard = backend.lock_nodes().await;
        if backend
            .get_record::<bool>(MIGRATION_DONE_KEY)
            .await?
            .unwrap_or(false)
        {
            return Ok(TreeSchemaMigration::AlreadyMigrated);
        }
        let outcome = match backend.get_tree_schema().await? {
            None => TreeSchemaMigration::NothingStored,
            Some(stored) => match upgraded(&stored) {
                Some(schema) => {
                    backend.save_tree_schema(&schema).await?;
                    TreeSchemaMigration::Rewritten
                }
                None => TreeSchemaMigration::LeftCustomised,
            },
        };
        backend.save_record(MIGRATION_DONE_KEY, &true).await?;
        info!(target: "citadel", "Tree schema default migration: {outcome:?}");
        Ok(outcome)
    }
}
