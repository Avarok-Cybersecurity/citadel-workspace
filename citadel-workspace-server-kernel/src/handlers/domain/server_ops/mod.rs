pub mod async_domain_server_ops;
/// Past a direct grant: the role in the workspace, and a booking guest's live link.
pub mod guest_access;
/// The role an account joining on its own is given: the table's default.
pub mod joiner_role;
pub mod metadata_merge;
/// The bounded JSON-object document a new node is created with.
pub mod node_metadata;
/// Changing a node's metadata after it exists, and the tab keys of the workspace's.
pub mod node_metadata_merge;
#[cfg(test)]
mod node_metadata_merge_tests;
/// Who holds which role, and the ladder every role or permission change climbs.
pub mod role_authority;
/// Writing a member's role, and the guard that keeps someone able to manage roles.
pub mod role_writes;
