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
//! The app runtime's server side: `storage` the named backends' namespaces and limits;
//! `egress` server egress (`net.server`) over the host's `EgressFetcher`; `usage_meter` the port
//! egress and relay bytes are reported to (not wired to any plan's billing);
//! `ihttp_relay` and `ihttp_flow` the internal-HTTP relay's advertisements, streams and flow,
//! `ihttp_audit` its audit line, `ihttp_routes` the digest an advertisement names its route
//! table by.
//! `host_net` what a member's agent may let an install reach from the member's machine.
//!
//! No I/O: the request handler (`command_processor::apps`) gathers the facts (permissions,
//! roles, node views, members) and applies what these decide; the store is
//! `kernel::transaction::apps_store`.

pub mod artifact;
pub mod audience;
pub mod egress;
#[cfg(not(target_family = "wasm"))]
pub mod egress_native;
pub mod egress_port;
pub mod facts;
pub mod fetcher;
#[cfg(not(target_family = "wasm"))]
pub mod fetcher_native;
pub mod host_net;
pub mod ihttp_adverts;
pub mod ihttp_audit;
pub mod ihttp_flow;
pub mod ihttp_relay;
pub mod ihttp_relay_end;
pub mod ihttp_relay_types;
pub mod ihttp_routes;
pub mod install;
pub mod md_header;
pub mod peer_limiter;
pub mod peer_rules;
pub mod records;
pub mod rules;
pub mod storage;
pub mod storage_entitlement;
pub mod storage_write;
pub mod update;
pub mod usage_meter;

#[cfg(test)]
mod artifact_tests;
#[cfg(test)]
mod audience_tests;
#[cfg(test)]
mod effective_tests;
#[cfg(test)]
mod egress_in_flight_tests;
#[cfg(all(test, not(target_family = "wasm")))]
mod egress_native_tests;
#[cfg(test)]
mod egress_tests;
#[cfg(test)]
mod ihttp_adverts_tests;
#[cfg(test)]
mod ihttp_corpus;
#[cfg(test)]
mod ihttp_corpus_cases;
#[cfg(test)]
mod ihttp_corpus_tests;
#[cfg(test)]
mod ihttp_flow_corpus_tests;
#[cfg(test)]
mod ihttp_relay_hardening_tests;
#[cfg(test)]
mod ihttp_relay_tests;
#[cfg(test)]
mod install_tests;
#[cfg(test)]
mod kernel_advertise_tests;
#[cfg(test)]
mod kernel_artifact_tests;
#[cfg(test)]
mod kernel_call_backend_tests;
#[cfg(test)]
mod kernel_call_tests;
#[cfg(test)]
mod kernel_effective_tests;
#[cfg(test)]
mod kernel_header_tests;
#[cfg(test)]
mod kernel_host_net_grant_tests;
#[cfg(test)]
mod kernel_ihttp_hardening_tests;
#[cfg(test)]
mod kernel_ihttp_tests;
#[cfg(test)]
mod kernel_install_tests;
#[cfg(test)]
mod kernel_lifecycle_tests;
#[cfg(test)]
mod kernel_listing_tests;
#[cfg(test)]
mod kernel_member_tests;
#[cfg(test)]
mod kernel_notice_tests;
#[cfg(test)]
mod kernel_peer_tests;
#[cfg(test)]
mod kernel_purge_tests;
#[cfg(test)]
mod kernel_release_change_tests;
#[cfg(test)]
mod kernel_scope_tests;
#[cfg(test)]
mod kernel_session_tests;
#[cfg(test)]
mod kernel_storage_hardening_tests;
#[cfg(test)]
mod kernel_withdraw_tests;
#[cfg(test)]
mod md_header_tests;
#[cfg(test)]
mod peer_rules_tests;
#[cfg(test)]
mod rules_tests;
#[cfg(test)]
mod runtime_wire_calls;
#[cfg(test)]
mod runtime_wire_fixture_tests;
#[cfg(test)]
mod runtime_wire_frames;
#[cfg(test)]
mod runtime_wire_relay;
#[cfg(test)]
mod storage_tests;
#[cfg(test)]
mod storage_write_tests;
#[cfg(test)]
mod test_facts;
#[cfg(test)]
mod test_ihttp;
#[cfg(test)]
mod test_manifests;
#[cfg(test)]
mod test_runtime;
#[cfg(test)]
mod test_support;
