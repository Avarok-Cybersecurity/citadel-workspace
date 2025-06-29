/// # Permission Test Suite
/// 
/// This module orchestrates comprehensive permission testing across the workspace system.
/// The tests are organized into focused modules covering different aspects of permission management.
/// 
/// ## Test Organization
/// - **Basic Permission Tests**: Fundamental permission setting and verification
/// - **Admin Check Tests**: Admin role verification and detection
/// - **Role-Based Permission Tests**: Complete role-based permission system testing
/// 
/// ## Permission Testing Flow
/// ```
/// Basic Permissions → Admin Role Verification → Role-Based Access Control
/// ```

// Import focused test modules
mod basic_permission_test;
mod admin_check_test;
mod role_based_permissions_test;
