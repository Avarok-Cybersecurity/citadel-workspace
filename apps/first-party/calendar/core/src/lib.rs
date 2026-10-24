//! The Calendar's logic, with no host and no I/O in it (Calendar design §3.2): the model and its
//! codec, time zones behind a port, recurrence, slots, host choice, propagation and ICS. The page
//! (`citadel-workspaces/src/lib/calendar`) supplies the ports and renders the answers; all of this
//! is tested natively, against the IANA database, without mocks of its own logic.
#![cfg_attr(not(any(feature = "ts", test)), no_std)]

extern crate alloc;
#[cfg(any(feature = "ts", test))]
extern crate std;

pub mod civil;
pub mod codec;
pub mod hosts;
pub mod ics_export;
pub mod ics_import;
pub mod ics_props;
pub mod ics_text;
pub mod model;
pub mod model_booking;
pub mod nav;
pub mod propagation;
pub mod refusal;
pub mod rrule;
pub mod slots;
pub mod topic;
pub mod tz;
pub mod tz_offsets;
pub mod wire;

#[cfg(test)]
mod civil_tests;
#[cfg(test)]
mod codec_tests;
#[cfg(test)]
mod hosts_tests;
#[cfg(test)]
mod ics_tests;
#[cfg(test)]
mod nav_tests;
#[cfg(test)]
mod propagation_tests;
#[cfg(test)]
mod rrule_tests;
#[cfg(test)]
mod slots_tests;
#[cfg(test)]
mod test_tz;
#[cfg(test)]
mod topic_tests;
#[cfg(test)]
mod tz_offsets_tests;
#[cfg(test)]
mod tz_tests;
