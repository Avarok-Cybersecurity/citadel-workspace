// Modular workspace test suite
use citadel_workspace_server_kernel::handlers::domain::{TransactionOperations, PermissionOperations, UserManagementOperations, WorkspaceOperations, OfficeOperations, RoomOperations, EntityOperations, DomainOperations};
//
// This file has been refactored from a single 446-line file into focused test modules
// to improve maintainability and code organization. Each module tests specific functionality:
//
// - `workspace_crud_test`: Core CRUD operations (create, get, update, delete)
// - `workspace_office_integration_test`: Office-workspace integration functionality
// - `workspace_permissions_test`: Permission inheritance and role-based access control
// - `workspace_loading_test`: Workspace loading operations
//
// Shared utilities are available in `tests/common/workspace_test_utils.rs`

// Import focused workspace test modules
mod workspace_crud_test;
mod workspace_loading_test;
mod workspace_office_integration_test;
mod workspace_permissions_test;

// All test functionality has been moved to focused modules imported above
