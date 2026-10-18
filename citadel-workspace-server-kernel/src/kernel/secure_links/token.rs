//! A link's token and the digest it is stored under.
//!
//! The token is 32 bytes from the operating system's CSPRNG, base64url without padding (43
//! characters). It exists only in the response that creates or regenerates it; the store holds
//! its SHA-256 digest, so a read of the store does not yield a working link.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use citadel_sdk::prelude::NetworkError;
use sha2::{Digest, Sha256};

const TOKEN_BYTES: usize = 32;

/// A fresh token.
pub fn mint_token() -> Result<String, NetworkError> {
    let mut bytes = [0u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes)
        .map_err(|e| NetworkError::msg(format!("No randomness for a link token: {e}")))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

/// The lower-case hex SHA-256 of `token`: the record's key and its stored identity.
pub fn digest_of(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
