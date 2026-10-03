//! The agent's updater (citadel-internal-service's src/updater), given what only this binary
//! knows: its version, where it may keep downloads, its socket, how it was started.
//!
//! Compiled in by the `self-update` feature, which only the release builds turn on.

use crate::notice_token::NOTICE_TOKEN_ENV;
use citadel_internal_service::kernel::CitadelWorkspaceService;
use citadel_internal_service::UpdaterConfig;
use citadel_sdk::prelude::Ratchet;
use std::error::Error;
use std::net::SocketAddr;
use std::path::PathBuf;

/// Under the user's cache directory (~/Library/Caches, $XDG_CACHE_HOME): downloads that can be
/// fetched again, kept apart from the account's data directory.
const CACHE_SUBDIR: [&str; 2] = ["citadel-agent", "updates"];

/// `service`, checking for and installing newer releases.
pub(crate) fn applied<T, R: Ratchet>(
    service: CitadelWorkspaceService<T, R>,
    bind: SocketAddr,
) -> Result<CitadelWorkspaceService<T, R>, Box<dyn Error>> {
    let config = config(
        dirs2::cache_dir(),
        bind,
        std::env::args_os()
            .skip(1)
            .map(|a| a.into_string())
            .collect(),
        std::env::var(NOTICE_TOKEN_ENV).is_ok_and(|v| !v.is_empty()),
    )?;
    Ok(service.with_updater(config))
}

/// Pure: the configuration from what `applied` read.
fn config(
    cache_dir: Option<PathBuf>,
    bind: SocketAddr,
    args: Result<Vec<String>, std::ffi::OsString>,
    launched_by_app: bool,
) -> Result<UpdaterConfig, Box<dyn Error>> {
    let cache_dir = cache_dir.ok_or(
        "no cache directory to download agent updates into. Set XDG_CACHE_HOME, or build \
         without the self-update feature.",
    )?;
    let relaunch_args = args.map_err(|arg| {
        format!("an argument is not UTF-8 ({arg:?}), so an update could not restart with it")
    })?;
    Ok(UpdaterConfig {
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        cache_dir: CACHE_SUBDIR
            .iter()
            .fold(cache_dir, |dir, part| dir.join(part)),
        bind,
        relaunch_args,
        launched_by_app,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bind() -> SocketAddr {
        "127.0.0.1:12345".parse().unwrap()
    }

    #[test]
    fn the_updater_runs_as_this_crates_version_under_the_cache_directory() {
        let args = Ok(vec!["--bind".to_string(), "127.0.0.1:12345".to_string()]);
        let c = config(Some(PathBuf::from("/home/a/.cache")), bind(), args, true).unwrap();
        assert_eq!(c.current_version, env!("CARGO_PKG_VERSION"));
        assert_eq!(
            c.cache_dir,
            PathBuf::from("/home/a/.cache/citadel-agent/updates")
        );
        assert_eq!(c.relaunch_args, ["--bind", "127.0.0.1:12345"]);
        assert!(c.launched_by_app);
        assert_eq!(c.bind, bind());
    }

    #[test]
    fn no_cache_directory_or_an_unrepeatable_argument_is_a_startup_error() {
        assert!(config(None, bind(), Ok(Vec::new()), false).is_err());
        let bad = Err(std::ffi::OsString::from("x"));
        assert!(config(Some(PathBuf::from("/c")), bind(), bad, false).is_err());
    }
}
