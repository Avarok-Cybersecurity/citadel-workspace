//! Compute Pool's logic, with no host in it: the jobs, the wire, the pool's coordination and the
//! dashboard's draw list. The app crate (`../app`) only connects these to the SDK, so all of
//! this is tested natively, without mocks.
#![no_std]

extern crate alloc;
#[cfg(test)]
extern crate std;

pub mod dashboard;
pub mod jobs;
pub mod limits;
pub mod pool;
pub mod sha256;
pub mod wire;
