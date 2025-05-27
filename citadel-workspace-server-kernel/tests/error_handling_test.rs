use citadel_sdk::prelude::*;
use citadel_workspace_server_kernel::kernel::WorkspaceServerKernel;
use citadel_workspace_types::{
    structs::{Permission, User, UserRole},
    UpdateOperation, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use std::sync::Arc;

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::*;
    use std::time::Duration;

    const ADMIN_PASSWORD: &str = "admin_password";
    // Helper function to create a test user
    fn create_test_user(id: &str, role: UserRole) -> User {
        User {
            id: id.to_string(),
            name: format!("Test {}", id),
            role,
            permissions: std::collections::HashMap::new(),
            metadata: Default::default(),
        }
    }

    // Helper to setup a test environment
    fn setup_test_environment() -> Arc<WorkspaceServerKernel<StackedRatchet>> {
        Arc::new(WorkspaceServerKernel::<StackedRatchet>::with_admin(
            "admin",
            "Administrator",
            ADMIN_PASSWORD,
        ))
    }

    #[rstest]
    #[timeout(Duration::from_secs(15))]
    #[test]
    fn test_command_invalid_access() {
        let kernel = setup_test_environment();

        // Add a regular user with no special permissions
        let user_id = "unprivileged_user";
        let user = create_test_user(user_id, UserRole::Guest);

        kernel
            .tx_manager()
            .with_write_transaction(|tx| {
                tx.insert_user(user_id.to_string(), user)?;
                Ok(())
            })
            .unwrap();

        println!("test_command_invalid_access: Attempting CreateOffice");
        // Attempt to create an office (should fail due to lack of permissions)
        let result = kernel.process_command(
            user_id,
            WorkspaceProtocolRequest::CreateOffice {
                name: "Office 1".to_string(),
                description: "Office 1 Description".to_string(),
                mdx_content: None,
                metadata: None,
            },
        );
        println!(
            "test_command_invalid_access: CreateOffice call completed, result: {:?}",
            result.is_ok()
        );

        // Verify we get an error response, not a panic or actual error
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert!(message.contains(
                    "Permission denied: User does not have permission to create an office"
                ));
            }
            _ => panic!("Expected error response"),
        }
        println!("test_command_invalid_access: CreateOffice assertions passed");

        println!("test_command_invalid_access: Attempting DeleteOffice");
        // Attempt to delete a non-existent office
        let result = kernel.process_command(
            user_id,
            WorkspaceProtocolRequest::DeleteOffice {
                office_id: "non_existent_id".to_string(),
            },
        );
        println!(
            "test_command_invalid_access: DeleteOffice call completed, result: {:?}",
            result.is_ok()
        );

        // Verify we get an error response
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert!(
                    message.contains("No permission to delete entity"),
                    "Unexpected error message: {}",
                    message
                );
            }
            _ => panic!("Expected error response"),
        }
        println!("test_command_invalid_access: DeleteOffice assertions passed. Test finished.");
    }

    #[rstest]
    #[timeout(Duration::from_secs(15))]
    #[test]
    fn test_command_invalid_resource() {
        let kernel = setup_test_environment();

        // Attempt to get a non-existent office (even as admin)
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::GetOffice {
                office_id: "non_existent_id".to_string(),
            },
        );

        // Verify we get an error response, not a panic
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert!(message.contains("Failed to get office"));
            }
            _ => panic!("Expected error response"),
        }

        // Attempt to get a non-existent room
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::GetRoom {
                room_id: "non_existent_room".to_string(),
            },
        );

        // Verify we get an error response
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert!(message.contains("Failed to get room"));
            }
            _ => panic!("Expected error response"),
        }

        // Attempt to get a non-existent member
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::GetMember {
                user_id: "non_existent_user".to_string(),
            },
        );

        // Verify we get an error response
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert!(message.contains("not found"));
            }
            _ => panic!("Expected error response"),
        }
    }

    #[rstest]
    #[timeout(Duration::from_secs(15))]
    #[test]
    fn test_member_operations_errors() {
        let kernel = setup_test_environment();

        // Attempt to update role for non-existent member
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::UpdateMemberRole {
                user_id: "non_existent_user".to_string(),
                role: UserRole::Member,
                metadata: None,
            },
        );

        // Verify we get an error response
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert!(message.contains("Failed to update member role"));
            }
            _ => panic!("Expected error response"),
        }

        // Attempt to update permissions for non-existent member
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::UpdateMemberPermissions {
                user_id: "non_existent_user".to_string(),
                domain_id: "office1".to_string(),
                permissions: vec![Permission::ReadMessages],
                operation: UpdateOperation::Add,
            },
        );

        // Verify we get an error response
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert!(message.contains("Failed to update member permissions"));
            }
            _ => panic!("Expected error response"),
        }

        // Test invalid operation when updating permissions
        // Add a real user first
        let user_id = "test_user";
        let user = create_test_user(user_id, UserRole::Member);
        kernel
            .tx_manager()
            .with_write_transaction(|tx| {
                tx.insert_user(user_id.to_string(), user)?;
                Ok(())
            })
            .unwrap();

        // Now try with attempting to update a non-existent domain
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::UpdateMemberPermissions {
                user_id: user_id.to_string(),
                domain_id: "non_existent_domain".to_string(),
                permissions: vec![Permission::ReadMessages],
                operation: UpdateOperation::Set,
            },
        );

        // Verify we get an error response
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert!(message.contains("Failed to update member permissions"));
            }
            _ => panic!("Expected error response"),
        }
    }

    #[rstest]
    #[timeout(Duration::from_secs(15))]
    #[test]
    fn test_list_members_invalid_parameters() {
        let kernel = setup_test_environment();

        // Test ListMembers with neither office_id nor room_id
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::ListMembers {
                office_id: None,
                room_id: None,
            },
        );

        // Verify we get the correct error message
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert_eq!(message, "Must specify exactly one of office_id or room_id");
            }
            _ => panic!("Expected error response"),
        }

        // Test ListMembers with both office_id and room_id
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::ListMembers {
                office_id: Some("office1".to_string()),
                room_id: Some("room1".to_string()),
            },
        );

        // Verify we get the correct error message
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert_eq!(message, "Must specify exactly one of office_id or room_id");
            }
            _ => panic!("Expected error response"),
        }
    }
}
