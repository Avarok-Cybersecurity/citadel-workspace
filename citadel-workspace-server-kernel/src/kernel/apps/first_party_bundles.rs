//! The first-party releases this server was built with, by app directory name: what
//! `build.rs` embedded from `CITADEL_FIRST_PARTY_SIGNED_DIR`. Empty in any build without the
//! deploy's signing key.

use super::first_party::SignedBundle;

pub const EMBEDDED: &[(&str, SignedBundle<'static>)] =
    include!(concat!(env!("OUT_DIR"), "/first_party_bundles.rs"));
