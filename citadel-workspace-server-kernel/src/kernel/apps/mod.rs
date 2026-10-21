//! Citadel Apps: the kernel's decisions about installs, pure.
//!
//! `rules` says which permission each capability and each apps action takes, what an installer
//! may grant, and what a call may do now (the intersection of the install's grant, what the
//! installer may still grant, what the acting member holds, and where the install reaches).
//! `audience` says who an app's audience admits and whether an install's scope stays inside it.
//!
//! `install` and `update` decide installs and updates from a verified listing, `md_header` the
//! required-apps header, `artifact` what an artifact chunk must be, `facts` what the handler
//! gathers for them, `records` what is stored; `fetcher` is the host capability that fetches
//! artifacts by URL.
//!
//! No I/O: the request handler (`command_processor::apps`) gathers the facts (permissions,
//! roles, node views, members) and applies what these decide; the store is
//! `kernel::transaction::apps_store`.

pub mod artifact;
pub mod audience;
pub mod facts;
pub mod fetcher;
#[cfg(not(target_family = "wasm"))]
pub mod fetcher_native;
pub mod install;
pub mod md_header;
pub mod records;
pub mod rules;
pub mod update;

#[cfg(test)]
mod artifact_tests;
#[cfg(test)]
mod audience_tests;
#[cfg(test)]
mod effective_tests;
#[cfg(test)]
mod install_tests;
#[cfg(test)]
mod kernel_artifact_tests;
#[cfg(test)]
mod kernel_effective_tests;
#[cfg(test)]
mod kernel_header_tests;
#[cfg(test)]
mod kernel_install_tests;
#[cfg(test)]
mod kernel_lifecycle_tests;
#[cfg(test)]
mod kernel_listing_tests;
#[cfg(test)]
mod kernel_member_tests;
#[cfg(test)]
mod kernel_scope_tests;
#[cfg(test)]
mod md_header_tests;
#[cfg(test)]
mod rules_tests;
#[cfg(test)]
mod test_facts;
#[cfg(test)]
mod test_manifests;
#[cfg(test)]
mod test_support;
