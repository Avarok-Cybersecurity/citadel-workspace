//! Where a listing and its artifact come from: the registry or a signed manifest the caller
//! holds, and the module from the store, the caller's upload or the host's fetcher. The
//! signature is verified before anything is fetched, and the bytes against the digest after.

use super::apps::{Caller, Step};
use super::apps_gather::gather;
use crate::kernel::apps::artifact::check_artifact_bytes;
use crate::kernel::apps::audience::audience_admits;
use crate::kernel::apps::facts::ViewsNeeded;
use crate::kernel::apps::fetcher::{admit_url, location_url, MAX_FETCH_BYTES};
use crate::kernel::apps::install::verify_listing;
use crate::kernel::apps::records::{RegistryEntry, StoredRelease};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_app_signature::sha256;
use citadel_logging::warn;
use citadel_sdk::prelude::{NetworkError, Ratchet};
use citadel_workspace_types::apps_install::{AppsRefusal, ListingSource};
use citadel_workspace_types::apps_manifest::{AppManifest, ArtifactRef};
use citadel_workspace_types::apps_protocol::ListingOffer;
use citadel_workspace_types::apps_responses::AppListing;

/// A verified listing.
pub(super) struct Offered {
    pub manifest: AppManifest,
    pub release: StoredRelease,
    pub manifest_sha256: String,
    pub source: ListingSource,
}

pub(super) fn listing_of(release: &StoredRelease, source: ListingSource) -> AppListing {
    AppListing {
        source,
        manifest_bytes: release.manifest.as_bytes().to_vec(),
        signature: release.signature.clone(),
    }
}

/// Whether `entry`'s audience admits the caller.
pub(super) async fn admitted<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    entry: &RegistryEntry,
) -> Result<bool, NetworkError> {
    let mut needed = ViewsNeeded::default();
    needed.audience(&entry.audience);
    let facts = gather(kernel, &[caller.user.to_string()], &needed).await?;
    Ok(audience_admits(&entry.audience, caller.user, &facts))
}

pub(super) async fn resolve_offer<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    offer: &ListingOffer,
) -> Step<Offered> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let (release, source) = match offer {
        ListingOffer::Registry { entry_id } => {
            let Some(entry) = backend.registry_entry(entry_id).await? else {
                return Err(AppsRefusal::Unavailable.into());
            };
            if !admitted(kernel, caller, &entry).await? {
                return Err(AppsRefusal::Unavailable.into());
            }
            let Some(release) = backend.app_release(&entry.release.manifest_sha256).await? else {
                return Err(AppsRefusal::Unavailable.into());
            };
            let source = ListingSource::WorkspaceRegistry {
                entry_id: entry_id.clone(),
            };
            (release, source)
        }
        ListingOffer::Signed {
            manifest_bytes,
            signature,
        } => {
            let manifest = String::from_utf8(manifest_bytes.clone()).map_err(|_| {
                AppsRefusal::InvalidManifest("the manifest is not UTF-8".to_string())
            })?;
            let release = StoredRelease {
                manifest,
                signature: signature.clone(),
            };
            (release, ListingSource::Upload)
        }
    };
    let manifest = verify_listing(release.manifest.as_bytes(), &release.signature)?;
    Ok(Offered {
        manifest_sha256: hex::encode(sha256(release.manifest.as_bytes())),
        manifest,
        release,
        source,
    })
}

/// Where the artifact a listing names is.
pub(super) enum Artifact {
    /// The server holds it.
    Stored,
    /// From the caller's completed upload, to be stored and the upload dropped.
    Uploaded(Vec<u8>),
    /// From one of its locations, to be stored.
    Fetched(Vec<u8>),
}

pub(super) async fn obtain_artifact<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    artifact: &ArtifactRef,
) -> Step<Artifact> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    if backend.artifact_meta(&artifact.sha256).await?.is_some() {
        return Ok(Artifact::Stored);
    }
    if let Some(staging) = backend.app_upload(caller.user).await? {
        if staging.complete && staging.sha256 == artifact.sha256 {
            let bytes = backend
                .assemble_app_upload(caller.user, &staging)
                .await?
                .ok_or(AppsRefusal::ArtifactMismatch)?;
            check_artifact_bytes(artifact, &bytes)?;
            return Ok(Artifact::Uploaded(bytes));
        }
    }
    let Some(fetcher) = kernel.artifact_fetcher() else {
        return Err(AppsRefusal::ServerFeatureUnavailable.into());
    };
    let mut mismatched = false;
    for location in &artifact.locations {
        let url = location_url(location);
        if let Err(why) = admit_url(&url) {
            warn!(target: "citadel", "Artifact location {url} refused: {why:?}");
            continue;
        }
        match fetcher.fetch(&url, MAX_FETCH_BYTES).await {
            Ok(bytes) => match check_artifact_bytes(artifact, &bytes) {
                Ok(()) => return Ok(Artifact::Fetched(bytes)),
                Err(_) => mismatched = true,
            },
            Err(why) => warn!(target: "citadel", "Artifact fetch from {url} failed: {why:?}"),
        }
    }
    Err(if mismatched {
        AppsRefusal::ArtifactMismatch
    } else {
        AppsRefusal::ArtifactUnreachable
    }
    .into())
}

/// Store what `obtain_artifact` found. The caller holds `APPS_LOCK`. A stored artifact the
/// sweep removed since it was found is unreachable now; asking again fetches or uploads it.
pub(super) async fn commit_artifact<R: Ratchet + Send + Sync + 'static>(
    kernel: &AsyncWorkspaceServerKernel<R>,
    caller: &Caller<'_>,
    sha256: &str,
    artifact: Artifact,
) -> Step<()> {
    let backend = &kernel.domain_operations.backend_tx_manager;
    let (bytes, from_upload) = match artifact {
        Artifact::Stored if backend.artifact_meta(sha256).await?.is_some() => return Ok(()),
        Artifact::Stored => return Err(AppsRefusal::ArtifactUnreachable.into()),
        Artifact::Uploaded(bytes) => (bytes, true),
        Artifact::Fetched(bytes) => (bytes, false),
    };
    if backend.artifact_meta(sha256).await?.is_none() {
        backend.store_artifact(sha256, &bytes).await?;
    }
    if from_upload {
        backend.drop_app_upload(caller.user).await?;
    }
    Ok(())
}
