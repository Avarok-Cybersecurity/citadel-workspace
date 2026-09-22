//! What the kernel needs from the runtime hosting it, in one place.
//!
//! Natively the kernel runs on a tokio runtime and every item here is the tokio or `std` one it
//! always used. On wasm32 it is hosted by a JS event loop (a Workers Durable Object), where
//! `tokio::spawn` has no runtime to find, tokio's timers have no driver and `std`'s clocks panic;
//! `citadel_io` supplies the equivalents the SDK itself runs on there.

pub use citadel_io::spawn;
pub use citadel_io::time::sleep;

#[cfg(target_family = "wasm")]
pub use citadel_io::time::{Instant, SystemTime, UNIX_EPOCH};
#[cfg(not(target_family = "wasm"))]
pub use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Content mirroring writes MDX files under the configured content directory.
pub mod fs {
    #[cfg(not(target_family = "wasm"))]
    pub use tokio::fs::{create_dir_all, write};

    /// A hosted wasm server has no filesystem. Mirroring runs only when a content base path is
    /// configured, and the wasm entry point never configures one, so reaching this is a
    /// configuration error and says so rather than pretending the write happened.
    #[cfg(target_family = "wasm")]
    fn unsupported(path: &std::path::Path) -> std::io::Error {
        std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            format!("no filesystem on wasm32; cannot write {path:?}"),
        )
    }

    #[cfg(target_family = "wasm")]
    pub async fn create_dir_all(path: impl AsRef<std::path::Path>) -> std::io::Result<()> {
        Err(unsupported(path.as_ref()))
    }

    #[cfg(target_family = "wasm")]
    pub async fn write(
        path: impl AsRef<std::path::Path>,
        _contents: impl AsRef<[u8]>,
    ) -> std::io::Result<()> {
        Err(unsupported(path.as_ref()))
    }
}
