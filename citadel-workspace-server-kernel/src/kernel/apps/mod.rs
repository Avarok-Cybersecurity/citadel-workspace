//! Citadel Apps: the kernel's decisions about installs, pure.
//!
//! `rules` says which permission each capability and each apps action takes, what an installer
//! may grant, and what a call may do now (the intersection of the install's grant, what the
//! installer may still grant, what the acting member holds, and where the install reaches).
//! `audience` says who an app's audience admits and whether an install's scope stays inside it.
//!
//! No I/O: the request handler gathers the facts (permissions, roles, node views, members) and
//! applies what these decide. The store and the handler come with the apps protocol's dispatch.

pub mod audience;
pub mod rules;

#[cfg(test)]
mod audience_tests;
#[cfg(test)]
mod effective_tests;
#[cfg(test)]
mod install_tests;
#[cfg(test)]
mod rules_tests;
#[cfg(test)]
mod test_facts;
