//! Concrete places code can be sent.
//!
//! Each of these is a `ExecutionTransport` and nothing more: the policy, the
//! serialisation and the error shapes are all upstream, so adding a destination
//! is a file here rather than a change anywhere else.

mod central_server;
mod fly_io;
mod ssh;

pub use central_server::{CentralServerTransport, WorkspaceDispatch};
pub use fly_io::FlyIoTransport;
pub use ssh::SshRemoteTransport;
