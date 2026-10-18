//! Siteverify over HTTPS: the native server's [`SiteVerify`]. rustls with Mozilla's roots (as the
//! agent's updater), and a bound on every call, so a siteverify that hangs refuses the sign-in it
//! holds up rather than holding it forever.

use crate::kernel::sign_in::turnstile::{SiteVerify, SiteVerifyUnreachable, SITEVERIFY_URL};
use serde_json::Value;
use std::time::Duration;

/// The longest one siteverify call may take, connect to last byte. Cloudflare answers in well
/// under a second; ten is generous and still short of the client's own sign-in timeout.
pub const SITEVERIFY_TIMEOUT: Duration = Duration::from_secs(10);

pub struct CloudflareSiteVerify {
    client: reqwest::Client,
}

impl CloudflareSiteVerify {
    pub fn new() -> Result<Self, String> {
        reqwest::Client::builder()
            .timeout(SITEVERIFY_TIMEOUT)
            .connect_timeout(SITEVERIFY_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map(|client| Self { client })
            .map_err(|e| format!("the siteverify client could not be built: {e}"))
    }
}

#[async_trait::async_trait]
impl SiteVerify for CloudflareSiteVerify {
    async fn verify(
        &self,
        secret: &str,
        token: &str,
        remote_ip: Option<&str>,
    ) -> Result<Value, SiteVerifyUnreachable> {
        let mut form = vec![("secret", secret), ("response", token)];
        if let Some(ip) = remote_ip {
            form.push(("remoteip", ip));
        }
        // `without_url`: a reqwest error prints its URL, and nothing here may print the form.
        let unreachable = |e: reqwest::Error| SiteVerifyUnreachable(e.without_url().to_string());
        let response = self
            .client
            .post(SITEVERIFY_URL)
            .form(&form)
            .send()
            .await
            .map_err(unreachable)?;
        let body = response.bytes().await.map_err(unreachable)?;
        Ok(serde_json::from_slice(&body).unwrap_or(Value::Null))
    }
}
