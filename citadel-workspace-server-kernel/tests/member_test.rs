/// # Member Test Suite
/// 
/// This module orchestrates comprehensive member operation testing across the workspace system.
/// The tests are organized into focused modules covering different aspects of member management.
/// 
/// ## Test Organization
/// - **Domain Operations**: Basic add/remove operations for users in domains
/// - **Lifecycle Management**: Complete user lifecycle including creation and removal
/// - **Command Processing**: Protocol-level member operations and command handling
/// 
/// ## Member Management Flow
/// ```
/// User Creation → Domain Addition → Operations → Lifecycle Management → Cleanup
/// ```

// Import focused test modules
mod member_domain_operations_test;
mod member_lifecycle_test;
mod member_command_processing_test;
