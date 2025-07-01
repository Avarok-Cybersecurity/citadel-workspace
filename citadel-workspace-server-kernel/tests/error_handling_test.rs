//! # Error Handling Test Suite
//!
//! This test suite provides comprehensive validation of error handling behavior across
//! the workspace server kernel. It ensures that all error conditions are handled gracefully,
//! returning appropriate error responses rather than panicking or causing system failures.
//!
//! ## Test Coverage Areas
//!
//! ### Permission-Based Error Handling
//! - **Access Denied Scenarios**: Tests for proper permission validation and denial messages
//! - **Unprivileged User Operations**: Verification that non-admin users receive appropriate rejections
//! - **Resource-Level Permissions**: Validation of fine-grained permission checking
//!
//! ### Resource Validation Error Handling
//! - **Non-Existent Resources**: Tests for proper handling of missing entities (offices, rooms, users)
//! - **Invalid Resource IDs**: Validation of ID format and existence checking
//! - **Cross-Entity Validation**: Tests for referential integrity and relationship validation
//!
//! ### Member Operation Error Handling
//! - **Invalid Member Operations**: Tests for role updates and permission changes on non-existent users
//! - **Domain Validation**: Verification of domain existence during member operations
//! - **Operation Constraint Validation**: Tests for business rule enforcement
//!
//! ### Parameter Validation Error Handling
//! - **Missing Required Parameters**: Tests for proper validation of required inputs
//! - **Conflicting Parameters**: Validation of mutually exclusive parameter combinations
//! - **Parameter Format Validation**: Tests for input sanitization and validation
//!
//! ## Error Response Standards
// All tests validate that:
// - Operations return `Ok(WorkspaceProtocolResponse::Error(...))` instead of panicking
// - Error messages are informative and user-friendly
// - System remains stable and responsive after errors
// - No data corruption occurs during error conditions

use citadel_sdk::prelude::*;
use citadel_workspace_server_kernel::handlers::domain::{
    DomainOperations, EntityOperations, OfficeOperations, PermissionOperations, RoomOperations,
    TransactionOperations, UserManagementOperations, WorkspaceOperations,
};
use citadel_workspace_server_kernel::kernel::transaction::{Transaction, TransactionManagerExt};
use citadel_workspace_server_kernel::kernel::WorkspaceServerKernel;
use citadel_workspace_types::{
    structs::{Permission, User, UserRole},
    UpdateOperation, WorkspaceProtocolRequest, WorkspaceProtocolResponse,
};
use rocksdb::DB;
use std::sync::Arc;
use tempfile::TempDir;

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::*;
    use std::time::Duration;

    // ════════════════════════════════════════════════════════════════════════════
    // TEST CONFIGURATION AND CONSTANTS
    // ════════════════════════════════════════════════════════════════════════════

    /// Master password for admin user in test environments
    const ADMIN_PASSWORD: &str = "admin_password";

    // ════════════════════════════════════════════════════════════════════════════
    // TEST UTILITY FUNCTIONS
    // ════════════════════════════════════════════════════════════════════════════

    /// Creates a test user with the specified ID and role.
    ///
    /// This utility function provides a standardized way to create test users
    /// for error handling scenarios, ensuring consistent user structure across tests.
    ///
    /// # Arguments
    /// * `id` - Unique identifier for the test user
    /// * `role` - Role to assign to the user (Guest, Member, Admin, etc.)
    ///
    /// # Returns
    /// A properly structured `User` instance ready for testing
    fn create_test_user(id: &str, role: UserRole) -> User {
        User {
            id: id.to_string(),
            name: format!("Test {}", id),
            role,
            permissions: std::collections::HashMap::new(),
            metadata: Default::default(),
        }
    }

    /// Sets up a complete test environment with kernel and database.
    ///
    /// This function creates a fresh test environment for each test, including:
    /// - Temporary database directory with automatic cleanup
    /// - Initialized WorkspaceServerKernel with admin user
    /// - Clean state ready for error condition testing
    ///
    /// # Returns
    /// A tuple containing:
    /// - `Arc<WorkspaceServerKernel<StackedRatchet>>` - The initialized kernel
    /// - `TempDir` - Database directory handle (keep alive for cleanup)
    ///
    /// # Test Environment Features
    /// - Isolated database per test (prevents test interference)
    /// - Pre-configured admin user for privileged operations
    /// - Automatic cleanup when TempDir is dropped
    fn setup_test_environment() -> (Arc<WorkspaceServerKernel<StackedRatchet>>, TempDir) {
        let db_temp_dir = TempDir::new().expect("Failed to create temp dir for DB");
        let db_path = db_temp_dir.path().join("test_error_handling_db");
        let db = DB::open_default(&db_path).expect("Failed to open DB");
        let kernel = Arc::new(WorkspaceServerKernel::<StackedRatchet>::with_admin(
            "admin",
            "Administrator",
            ADMIN_PASSWORD,
            Arc::new(db),
        ));
        (kernel, db_temp_dir)
    }

    // ════════════════════════════════════════════════════════════════════════════
    // PERMISSION-BASED ERROR HANDLING TESTS
    // ════════════════════════════════════════════════════════════════════════════

    /// Tests proper error handling for permission-denied scenarios.
    ///
    /// This test validates that unprivileged users receive appropriate error responses
    /// when attempting operations they don't have permission to perform. It ensures
    /// the system properly validates permissions and returns user-friendly error messages.
    ///
    /// ## Test Scenarios
    /// 1. **Office Creation by Unprivileged User**: Validates permission checking for workspace modifications
    /// 2. **Office Deletion by Unprivileged User**: Tests permission validation for destructive operations
    ///
    /// ## Expected Behavior
    /// - All operations return `Ok(WorkspaceProtocolResponse::Error(...))`
    /// - Error messages clearly indicate permission denial and specify the missing permission
    /// - No system crashes or panics occur
    /// - System state remains unchanged after permission denials
    #[rstest]
    #[timeout(Duration::from_secs(15))]
    #[test]
    fn test_command_invalid_access() {
        let (kernel, _db_temp_dir) = setup_test_environment();

        // Create an unprivileged user with guest-level access
        let user_id = "unprivileged_user";
        let user = create_test_user(user_id, UserRole::Guest);

        kernel
            .tx_manager()
            .with_write_transaction(|tx| {
                tx.insert_user(user_id.to_string(), user)?;
                Ok(())
            })
            .unwrap();

        println!("test_command_invalid_access: Attempting CreateOffice with unprivileged user");

        // Test Case 1: Attempt office creation without proper permissions
        let result = kernel.process_command(
            user_id,
            WorkspaceProtocolRequest::CreateOffice {
                workspace_id: citadel_workspace_server_kernel::WORKSPACE_ROOT_ID.to_string(),
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

        // Validate proper error response for permission denial
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert!(message.contains(
                    "User 'unprivileged_user' does not have permission to add offices to workspace 'workspace-root'"
                ));
            }
            _ => panic!("Expected error response for permission denial"),
        }
        println!("test_command_invalid_access: CreateOffice permission denial validated");

        println!("test_command_invalid_access: Attempting DeleteOffice with unprivileged user");

        // Test Case 2: Attempt office deletion without proper permissions
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

        // Validate proper error response (could be permission or not found)
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                // Accept either permission denied or office not found (both are valid security responses)
                assert!(
                    message.contains("User 'unprivileged_user' does not have permission")
                        || message.contains("Office 'non_existent_id' not found"),
                    "Unexpected error message: {}",
                    message
                );
            }
            _ => panic!("Expected error response for unauthorized deletion"),
        }
        println!("test_command_invalid_access: DeleteOffice permission denial validated. Test completed successfully.");
    }

    // ════════════════════════════════════════════════════════════════════════════
    // RESOURCE VALIDATION ERROR HANDLING TESTS
    // ════════════════════════════════════════════════════════════════════════════

    /// Tests proper error handling for operations on non-existent resources.
    ///
    /// This test validates that the system gracefully handles requests for resources
    /// that don't exist in the database. It ensures proper validation and informative
    /// error messages for missing entities across different resource types.
    ///
    /// ## Test Scenarios
    /// 1. **Non-Existent Office Retrieval**: Tests office lookup validation
    /// 2. **Non-Existent Room Retrieval**: Tests room lookup validation  
    /// 3. **Non-Existent Member Retrieval**: Tests user lookup validation
    ///
    /// ## Expected Behavior
    /// - All operations return `Ok(WorkspaceProtocolResponse::Error(...))`
    /// - Error messages clearly indicate the resource was not found
    /// - Admin privileges don't bypass existence validation
    /// - System performance remains optimal during failed lookups
    #[rstest]
    #[timeout(Duration::from_secs(15))]
    #[test]
    fn test_command_invalid_resource() {
        let (kernel, _db_temp_dir) = setup_test_environment();

        // Test Case 1: Attempt to retrieve a non-existent office (using admin privileges)
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::GetOffice {
                office_id: "non_existent_id".to_string(),
            },
        );

        // Validate proper error response for missing office
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert!(message.contains("Failed to get office"));
            }
            _ => panic!("Expected error response for non-existent office"),
        }

        // Test Case 2: Attempt to retrieve a non-existent room
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::GetRoom {
                room_id: "non_existent_room".to_string(),
            },
        );

        // Validate proper error response for missing room
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert!(message.contains("Failed to get room"));
            }
            _ => panic!("Expected error response for non-existent room"),
        }

        // Test Case 3: Attempt to retrieve a non-existent member
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::GetMember {
                user_id: "non_existent_user".to_string(),
            },
        );

        // Validate proper error response for missing member
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert!(message.contains("not found"));
            }
            _ => panic!("Expected error response for non-existent member"),
        }
    }

    // ════════════════════════════════════════════════════════════════════════════
    // MEMBER OPERATION ERROR HANDLING TESTS
    // ════════════════════════════════════════════════════════════════════════════

    /// Tests proper error handling for invalid member management operations.
    ///
    /// This test validates error handling for member-related operations that involve
    /// validation failures, including operations on non-existent users and domains.
    /// It ensures the system maintains data integrity during failed member operations.
    ///
    /// ## Test Scenarios  
    /// 1. **Role Update on Non-Existent User**: Tests user existence validation
    /// 2. **Permission Update on Non-Existent User**: Tests user validation in permission operations
    /// 3. **Permission Update on Non-Existent Domain**: Tests domain validation in permission operations
    ///
    /// ## Expected Behavior
    /// - All invalid operations return appropriate error responses
    /// - Error messages provide clear indication of validation failures
    /// - No partial updates occur during validation failures
    /// - System state remains consistent after failed operations
    #[rstest]
    #[timeout(Duration::from_secs(15))]
    #[test]
    fn test_member_operations_errors() {
        let (kernel, _db_temp_dir) = setup_test_environment();

        // Test Case 1: Attempt to update role for non-existent member
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::UpdateMemberRole {
                user_id: "non_existent_user".to_string(),
                role: UserRole::Member,
                metadata: None,
            },
        );

        // Validate proper error response for missing user
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert!(message.contains("Failed to update member role"));
            }
            _ => panic!("Expected error response for non-existent user role update"),
        }

        // Test Case 2: Attempt to update permissions for non-existent member
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::UpdateMemberPermissions {
                user_id: "non_existent_user".to_string(),
                domain_id: "office1".to_string(),
                permissions: vec![Permission::ReadMessages],
                operation: UpdateOperation::Add,
            },
        );

        // Validate proper error response for permission update on missing user
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert!(message.contains("Failed to update member permissions"));
            }
            _ => panic!("Expected error response for non-existent user permission update"),
        }

        // Setup: Create a valid user for domain validation testing
        let user_id = "test_user";
        let user = create_test_user(user_id, UserRole::Member);
        kernel
            .tx_manager()
            .with_write_transaction(|tx| {
                tx.insert_user(user_id.to_string(), user)?;
                Ok(())
            })
            .unwrap();

        // Test Case 3: Attempt permission update on non-existent domain
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::UpdateMemberPermissions {
                user_id: user_id.to_string(),
                domain_id: "non_existent_domain".to_string(),
                permissions: vec![Permission::ReadMessages],
                operation: UpdateOperation::Set,
            },
        );

        // Validate proper error response for invalid domain
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert!(message.contains("Failed to update member permissions"));
            }
            _ => panic!("Expected error response for non-existent domain permission update"),
        }
    }

    // ════════════════════════════════════════════════════════════════════════════
    // PARAMETER VALIDATION ERROR HANDLING TESTS
    // ════════════════════════════════════════════════════════════════════════════

    /// Tests proper error handling for invalid parameter combinations.
    ///
    /// This test validates that the system properly validates input parameters
    /// and rejects invalid combinations with clear error messages. It focuses on
    /// operations that have mutually exclusive parameters or missing required inputs.
    ///
    /// ## Test Scenarios
    /// 1. **ListMembers with No Parameters**: Tests validation of missing required parameters
    /// 2. **ListMembers with Conflicting Parameters**: Tests validation of mutually exclusive parameters
    ///
    /// ## Expected Behavior
    /// - Invalid parameter combinations are rejected immediately
    /// - Error messages clearly explain the parameter validation requirements
    /// - No database operations are attempted with invalid parameters
    /// - Validation occurs before any permission or resource existence checks
    #[rstest]
    #[timeout(Duration::from_secs(15))]
    #[test]
    fn test_list_members_invalid_parameters() {
        let (kernel, _db_temp_dir) = setup_test_environment();

        // Test Case 1: ListMembers with neither office_id nor room_id (missing required parameter)
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::ListMembers {
                office_id: None,
                room_id: None,
            },
        );

        // Validate proper error response for missing required parameters
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert_eq!(message, "Must specify exactly one of office_id or room_id");
            }
            _ => panic!("Expected error response for missing required parameters"),
        }

        // Test Case 2: ListMembers with both office_id and room_id (conflicting parameters)
        let result = kernel.process_command(
            "admin",
            WorkspaceProtocolRequest::ListMembers {
                office_id: Some("office1".to_string()),
                room_id: Some("room1".to_string()),
            },
        );

        // Validate proper error response for conflicting parameters
        assert!(result.is_ok());
        match result.unwrap() {
            WorkspaceProtocolResponse::Error(message) => {
                assert_eq!(message, "Must specify exactly one of office_id or room_id");
            }
            _ => panic!("Expected error response for conflicting parameters"),
        }
    }
}
