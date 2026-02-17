use crate::kernel::transaction::prelude::TransactionManagerExt;
use crate::kernel::transaction::Transaction;
use crate::kernel::WorkspaceServerKernel;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::structs::User;
use std::collections::HashSet;

// Query handlers - functions for retrieving workspace information

#[allow(dead_code)]
impl<R: Ratchet> WorkspaceServerKernel<R> {
    // List members in a domain entity
    pub fn query_members(
        &self,
        entity_id: Option<&str>,
        additional_entity_id: Option<&str>,
    ) -> Result<Vec<User>, NetworkError> {
        self.tx_manager().with_read_transaction(|tx| {
            let mut members = Vec::new();

            match (entity_id, additional_entity_id) {
                (Some(entity_id), None) => {
                    // Get members of a single entity using DomainNode
                    match tx.get_node(entity_id) {
                        Some(node) => {
                            for member_id in &node.members {
                                if let Some(user) = tx.get_user(member_id) {
                                    members.push(user.clone());
                                }
                            }
                        }
                        None => return Err(NetworkError::msg("Entity not found")),
                    }
                }
                (Some(entity_id1), Some(entity_id2)) => {
                    // Get members who are in both entities
                    match (tx.get_node(entity_id1), tx.get_node(entity_id2)) {
                        (Some(node1), Some(node2)) => {
                            // Find members who are in both entities
                            let entity1_members: HashSet<&String> =
                                node1.members.iter().collect();
                            let entity2_members: HashSet<&String> =
                                node2.members.iter().collect();
                            let common_members = entity1_members.intersection(&entity2_members);

                            for member_id in common_members {
                                if let Some(user) = tx.get_user(member_id) {
                                    members.push(user.clone());
                                }
                            }
                        }
                        (None, _) => return Err(NetworkError::msg("First entity not found")),
                        (_, None) => return Err(NetworkError::msg("Second entity not found")),
                    }
                }
                (None, None) => {
                    // Get all members
                    for user in tx.get_all_users().values() {
                        members.push(user.clone());
                    }
                }
                (None, Some(_)) => {
                    return Err(NetworkError::msg("Invalid query: second entity ID provided without first"));
                }
            }

            Ok(members)
        })
    }
}
