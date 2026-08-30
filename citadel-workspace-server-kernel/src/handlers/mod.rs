// Module declarations
pub mod domain;
// pub mod office;  // Commented out - depends on sync WorkspaceServerKernel
// There is no `permissions` module. The file existed but was never compiled --
// `pub mod permissions;` had been commented out with the note "depends on sync
// WorkspaceServerKernel" -- and it carried a FOURTH role-to-permission table
// that granted SendMessages to no role at all, contradicting
// `Permission::for_role`. Uncompiled code cannot be wrong on its own, but it
// can be read as authoritative and wired back in, which would have restored
// exactly the refusal round 409 removed. Deleted rather than repaired; git
// remembers it if the sync kernel ever returns.
// pub mod query;  // Commented out - depends on sync WorkspaceServerKernel
// pub mod room;  // Commented out - depends on sync WorkspaceServerKernel
