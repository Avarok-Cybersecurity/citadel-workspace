//! The one definition of `AdvertiseService.routes_digest` (R4.4) on the Rust side; the page's
//! is `routesDigest` in the UI's `ihttp-relay-port.ts`, held to the same shared fixture
//! (`apps/runtime-fixtures/apps-runtime-wire.json`).
//!
//! The digest is the lowercase hex sha256 of the route lines as a manifest writes them
//! (`METHOD /path`), sorted bytewise and joined by `\n`, with no trailing newline. Sorted, so
//! the order an app lists its routes in does not matter: the table served is a set, and the
//! advertisement must name exactly the set the installer consented to.

use citadel_app_signature::sha256;

pub fn routes_digest<'a>(routes: impl IntoIterator<Item = &'a str>) -> String {
    let mut lines: Vec<&str> = routes.into_iter().collect();
    lines.sort_unstable();
    hex::encode(sha256(lines.join("\n").as_bytes()))
}
