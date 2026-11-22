//! The startup settings' tests, moved from main.rs unchanged.

use super::*;

#[cfg(test)]
mod default_data_dir_tests {
    use super::*;

    #[test]
    fn a_fresh_install_keeps_its_account_in_the_home_directory() {
        let dir = default_data_dir(Some(PathBuf::from("/home/tester"))).unwrap();
        assert_eq!(
            PathBuf::from(dir),
            PathBuf::from("/home/tester").join(".citadel-agent")
        );
    }

    #[test]
    fn no_home_directory_is_an_error_not_a_silent_cwd() {
        assert!(default_data_dir(None).is_err());
    }
}

#[cfg(test)]
mod backend_select_tests {
    //! Boundary tests for `select_backend_type`. Mirrors the kernel's
    //! `backend_select_tests` (see KEEP IN SYNC WITH note in `main()`)
    //! so any drift in precedence semantics between the two binaries
    //! fails CI on both sides instead of silently picking the wrong
    //! backend at deploy time.
    use super::*;
    use citadel_sdk::prelude::BackendType;

    // An explicit stand-in: the real default is computed from the host (home
    // directory), which default_data_dir_tests cover.
    const DEFAULT: &str = "/home/tester/.citadel-agent";

    #[test]
    fn defaults_to_in_memory_when_nothing_is_set() {
        let bt = select_backend_type(None, None, None, None, DEFAULT).unwrap();
        assert!(matches!(bt, BackendType::InMemory));
    }

    #[test]
    fn cli_filesystem_uses_cli_data_dir() {
        let bt = select_backend_type(None, None, Some("filesystem"), Some("/srv/data"), DEFAULT)
            .unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "/srv/data"),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn cli_filesystem_falls_back_to_default_data_dir() {
        let bt = select_backend_type(None, None, Some("filesystem"), None, DEFAULT).unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, DEFAULT),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn env_backend_overrides_cli_backend() {
        let bt = select_backend_type(
            Some("filesystem"),
            Some("/data/from-env"),
            None,
            None,
            DEFAULT,
        )
        .unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "/data/from-env"),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn env_data_dir_overrides_cli_data_dir_independently() {
        let bt = select_backend_type(
            None,
            Some("/mnt/persistent"),
            Some("filesystem"),
            Some("/srv/data"),
            DEFAULT,
        )
        .unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "/mnt/persistent"),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn unknown_backend_string_returns_error() {
        let err = select_backend_type(None, None, Some("redis"), None, DEFAULT).unwrap_err();
        let msg = format!("{err}");
        assert!(
            msg.contains("Unknown backend type 'redis'"),
            "error message should name the bad value: {msg}"
        );
    }

    #[test]
    fn empty_env_backend_falls_through_to_cli() {
        let bt = select_backend_type(
            Some(""),
            None,
            Some("filesystem"),
            Some("/srv/data"),
            DEFAULT,
        )
        .unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "/srv/data"),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn empty_env_data_dir_falls_through_to_cli() {
        let bt = select_backend_type(
            Some("filesystem"),
            Some(""),
            None,
            Some("/srv/data"),
            DEFAULT,
        )
        .unwrap();
        match bt {
            BackendType::Filesystem(d) => assert_eq!(d, "/srv/data"),
            other => panic!("expected Filesystem, got {other:?}"),
        }
    }

    #[test]
    fn explicit_in_memory_ignores_data_dir() {
        let bt =
            select_backend_type(None, Some("/should-be-ignored"), None, None, DEFAULT).unwrap();
        assert!(matches!(bt, BackendType::InMemory));
    }
}

#[cfg(test)]
mod origin_policy_tests {
    //! The precedence and the fail-fast. `OriginPolicy::parse` is tested in the
    //! connector; what is tested here is that this binary REQUIRES a
    //! configuration rather than inventing one.
    use super::*;

    #[test]
    fn nothing_configured_is_a_startup_error() {
        // The whole point of the flag being required. A default would either be
        // wrong for every real deployment (localhost) or be the hole (any).
        let error = resolve_origin_policy(None, None).unwrap_err();
        let message = format!("{error}");
        assert!(
            message.contains("INTERNAL_SERVICE_ALLOWED_ORIGINS"),
            "the error must name the variable to set: {message}"
        );
    }

    #[test]
    fn empty_strings_count_as_unset() {
        // `.env` with a blank entry arrives as Some(""), exactly as for the
        // backend vars above.
        assert!(resolve_origin_policy(Some(""), Some("")).is_err());
    }

    #[test]
    fn the_cli_flag_is_used_when_the_env_var_is_unset() {
        let policy = resolve_origin_policy(None, Some("http://localhost:5291")).unwrap();
        assert!(policy.permits(Some("http://localhost:5291")));
        assert!(!policy.permits(Some("https://evil.example")));
    }

    #[test]
    fn the_env_var_wins_over_the_cli_flag() {
        // Same precedence as select_backend_type, so a docker operator can
        // change it without rebuilding.
        let policy =
            resolve_origin_policy(Some("http://from-env:1"), Some("http://from-cli:2")).unwrap();
        assert!(policy.permits(Some("http://from-env:1")));
        assert!(!policy.permits(Some("http://from-cli:2")));
    }

    #[test]
    fn an_empty_env_var_falls_through_to_the_cli_flag() {
        let policy = resolve_origin_policy(Some(""), Some("http://localhost:5291")).unwrap();
        assert!(policy.permits(Some("http://localhost:5291")));
    }

    #[test]
    fn a_malformed_specification_fails_startup_rather_than_degrading() {
        // A trailing slash never matches any browser Origin. Accepting it would
        // produce a listener that refuses the real UI and looks like downtime.
        let error = resolve_origin_policy(None, Some("http://localhost:5291/")).unwrap_err();
        assert!(format!("{error}").contains("invalid origin allowlist"));
    }

    #[test]
    fn the_wildcard_is_accepted_but_only_when_asked_for() {
        assert_eq!(
            resolve_origin_policy(None, Some("*")).unwrap(),
            OriginPolicy::Any
        );
    }
}
