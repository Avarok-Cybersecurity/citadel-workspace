//! The backend storage's schema version: what this server reads, and the refusal of a
//! store written by an earlier one. Earlier stores are never migrated.

/// The schema this server writes and reads. Bump it with every change to a stored shape;
/// a store stamped lower is refused.
pub const CURRENT_SCHEMA_VERSION: u32 = 2;

/// `Err` naming the remedy when `found` is from an earlier server.
pub(crate) fn refuse_earlier(found: u32) -> Result<(), String> {
    if found < CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "Backend schema version (v{found}) was written by an earlier server; \
             this one reads only v{CURRENT_SCHEMA_VERSION}. Start it on an empty store."
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_store_from_the_previous_release_is_refused() {
        let why = refuse_earlier(1).unwrap_err();
        assert!(why.contains("v1") && why.contains("empty store"), "{why}");
    }

    #[test]
    fn the_current_and_a_newer_version_are_not_refused_here() {
        assert!(refuse_earlier(CURRENT_SCHEMA_VERSION).is_ok());
        assert!(refuse_earlier(CURRENT_SCHEMA_VERSION + 1).is_ok());
    }
}
