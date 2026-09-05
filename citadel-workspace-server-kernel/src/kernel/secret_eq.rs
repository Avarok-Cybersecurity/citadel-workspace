//! Constant-time comparison for the workspace master password.
//!
//! `String == String` compares lengths and then runs `memcmp`, which returns as
//! soon as two bytes differ. How long that takes is a function of how many
//! leading bytes the guess got right, so an attacker who can submit guesses and
//! time the answers learns the secret one byte at a time rather than having to
//! search the whole space.
//!
//! The master password is what makes somebody the administrator of a workspace,
//! and four of the five places it was compared are reachable from a request. So
//! the comparison is done on fixed-size digests: SHA-256 both sides, then
//! compare the two 32-byte digests with `subtle`, which is written to run in
//! time independent of the data and not to be optimised back into an early
//! return.
//!
//! Hashing first also removes the length leak. Comparing the raw bytes in
//! constant time would still take time proportional to the longer input, which
//! tells an attacker how many characters to guess.

use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

/// Whether two secrets are equal, in time independent of *how* they differ.
///
/// Use this for anything an attacker can submit guesses against. For comparing
/// two values that are both already trusted -- a config value against itself at
/// startup, say -- plain `==` is not a vulnerability, but this is not slower in
/// any way that matters, and one rule is easier to keep than two.
pub fn secrets_match(a: &str, b: &str) -> bool {
    let left: [u8; 32] = Sha256::digest(a.as_bytes()).into();
    let right: [u8; 32] = Sha256::digest(b.as_bytes()).into();
    left.ct_eq(&right).into()
}

#[cfg(test)]
mod tests {
    use super::secrets_match;

    #[test]
    fn identical_secrets_match() {
        assert!(secrets_match("correct horse battery staple", "correct horse battery staple"));
    }

    #[test]
    fn different_secrets_do_not_match() {
        assert!(!secrets_match("correct horse battery staple", "correct horse battery stapla"));
    }

    #[test]
    fn a_shared_prefix_is_not_a_match() {
        // The case the old `==` leaked: a guess that is right for its whole
        // length is still wrong.
        assert!(!secrets_match("hunter2", "hunter2-and-then-some"));
    }

    #[test]
    fn empty_matches_only_empty() {
        assert!(secrets_match("", ""));
        assert!(!secrets_match("", "x"));
        assert!(!secrets_match("x", ""));
    }

    #[test]
    fn comparison_is_byte_exact_not_unicode_normalised() {
        // Two strings that render alike must not authenticate one another.
        assert!(!secrets_match("é", "e\u{0301}"));
    }
}
