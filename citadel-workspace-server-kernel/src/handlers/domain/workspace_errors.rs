//! The two workspace-lookup failures, spelled once.
//!
//! These are produced in `server_ops` and read in the command processor, which
//! turns one of them into `WorkspaceNotInitialized` — an answer that sends a
//! client into the first-run setup flow. Two files agreeing on a sentence by
//! coincidence is not a link; renaming one here used to silently change what
//! the other concluded, with nothing failing anywhere.

/// The workspace exists; the caller is not in it.
pub const NOT_A_MEMBER: &str = "Permission denied: Not a member of this workspace";
/// No workspace on this server has the requested id.
pub const NO_SUCH_WORKSPACE: &str = "Workspace not found";
