//! Whether a signed listing is one the server accepts, and whether an installer may install it
//! where and with what they asked. Pure: the handler gathers the snapshots and facts.

use super::audience::scope_reach_within_audience;
use super::facts::{GatheredFacts, PermissionSnapshot};
use super::rules::{action_permissions, check_grant, may_install_at, AppsAction};
use citadel_app_signature::{sha256, sha256_from_hex, verify, ArtifactDigests};
use citadel_workspace_types::apps::{Capability, InstallScope};
use citadel_workspace_types::apps_install::{AppsRefusal, GrantDetails};
use citadel_workspace_types::apps_manifest::{
    AppManifest, CapabilityRequest, ABI_FIRST_PARTY_GLUE,
};
use citadel_workspace_types::structs::Permission;
use std::collections::BTreeSet;

/// The first-party publisher keys: only an app signed by one of these may load through the
/// transitional glue ABI or be granted `documents`, and only these sign the apps every workspace
/// is provisioned with (`first_party_provisioning`).
///
/// One key, the owner's (fingerprint `34b0 a177 4fb3 cb9b`). Its seed is the deploy secret
/// `CITADEL_APP_SIGNING_SEED_HEX`, read only by the deploy job's signing step
/// (`scripts/build-first-party-apps.mjs --sign`); it is never in the repository. A rotation adds
/// the new key here and keeps the old one while releases it signed are installed. The UI's copy
/// (`first-party/publisher-keys.ts`) is held to this list by a test.
pub const FIRST_PARTY_PUBLISHER_KEYS: &[&str] = &["15cf13ca3e3260895bed38e9b5b8df06891846978fd2b1e834187153dde933d7220055db5e14600c7250ce6152b3b550a5b00baafd166a2cb47145897f3e5931dff6d7c43d9f3a4a359931935d2565025c6654e8af19be9817bd6791f73d0ebe7fc96cd0a59711079e1f70def26f26e557f8bd1a0707bb2417fa1c3b4fc7211ccb8c7c33008248a02dc23bd0e999d55d14e96bb1408d38a15d2ade46c7719fbea2ce3c3f41928c61110479a32b44b2b2ca1af8e402c7778a199087e2acdf3d16e2e65dd2958bd5dd422839d8e15e4db846cc46b72a3ce40c03dc66cb220a738129d2e1f9c80a366572b22e5353538ee0301901c05e15f37eb02859ad955f605bdb66b5f85390a972288bc740323ca09097d0ae929adf3e9873701d57edcf6eb31ddc0abaefa51bbc3da0f53a299dd8df601209b4422516f7c96f01237d1466123c387ba4dba9852f362362c637db9bfcc23f4bce322206e2e0932afd3bee5675e9ce8381b1a7c7b47d2a194aea6f4ecad533862b209096694394b8dd011223de2a437028cbee9a33092f2d29866091fa29f7b119ea6b6608cbc6beac7ad8e1ebe6315802b5cc887e61a18dbc3fbb9c8297584ceeae04a235a1b41a6848e2ef3c6708e0b990d65af01a3d479c04cf7f7bc89309321fc27be1be46c4d0aaad3ddec06ff64b28b7c872ccded2b705e5db983a7295fc15120518017f4891943815410de2d8856976e801de7b489613b7adeccac69c580655c30e6dfbca6a1affa3af885799a8f063f96f4893f4e3a707e788d0d258cfd8292afcccfb743b2f25192d35ad534eb60a921eacd9b392f248bf973389429ccecf1fe9aa3beaf93bedc45b8908e05e8abb4ea62fd4bb0dfd9fee6ffc4f949b728466197a984dc34188d737978de9407a32cacb16f31fd40dcde05c4ffeaf25c62e32062641c39af05fb2963e1fdfad4f5a0999d04a559c4a4ff370e15412348fcde7e2579b72de28a40dda531a3b12d563b5526863cbb0cc076c79b90f38339bafc768a6d8cec4940df11a0c7143e3c6d335e23eacf070eb780affc5a0d25470e7e2c988bbd79381d40fcabe388ebd65e63c4d5245072639fd4acc6f0a8709b96eaf6605b1676fa4438be595e84d16beaac17ff0b018a8ebca8a4733c9e287c28ae79ea3d917d7562d78d95cd94a18e33de5b08fa384f3f929dcb2d044c67fd17d2f896c2d2ae6d63820043c2b5d2b7701d7871cfd4ed96271f1e283f64450869f9ef0d5efed59ba5ee309fef7238112b88c51e221fdc1658a2e0bef4cd7d0cca3989e8db3192c3bc081460d7d655b7e32dae2fdae6ff5157b5d61bcae7da4827e1083424c395ebbf2bdb8ab410de6e211bb2a4a03578acf85620baa09725d1f2be87c0af873e2429d04b881b314b8eebacf1f94a3059b8d3a8de027be9db2afb076e94cd1ced707cc5f0a9d65ce133b679488ae7fc7852170b842b792582deb55ca5c1552b600068f9817def6580131dfa981e4d9a752fba5c82a769257f980f11e9a2ed5c1d64e07cdb29d2398cd9b9f5b6983788319a0ef564b44ccfc32b0e83614e8d53828dbe9a93cabb6c88a34f35a9e9e7682ede8a8d571c9e6d6a99333556dfa05a921bdc9e743219c9c37b77f1fe9490b2a8344fb7dc3478f251b703d1f4efb4502da16694915ab0f64fd9a721dac409010b545543a48aaa32d6f2ad67bc07795b8376ee1a44d9e96ef6eee7206ef95242a41d9a5660f97e68679ea3d9fa496cfc748ba76300e241de35f08f3f0016499812abc5a4bc4f489af3890ccbe526c43e3ddea031380612fc9cbbbd4d2679676df77fd96c19a8a0476c52848ae7acfea16d42f82398c16260f5e1700d5e6b8127804b9d2d1135dffb2edd33c20d5348d2adf3152e8fd6166321414fc9e15023bda4b26341904b39487ca71636f71c8bba36c9f1d3ab3d539c9183e88f19998fdbf1f0170bb4c15341399b0b18d7204bdcbfd224314e2ae3adef544c28c347815fe5f857bc7ac7f099ab09747535daefe4e59fb62f45d7861325bdd44f75e0454cc47610d6905299c9ec294c8f19a0acb9e16b29283ef12774f196c8cfada1a1ccde01d0841c7eeb3cff31ffc4d28bcc32921ea6eca1cddc7d9bded38a89d474e0382f5f46fde43728712672f0ac263c6d83c37419cafa461797f5f20aaa1bd99371fcd42891fd352e7ccc6285f4e48d330a05028b29c25202fd56b617d2d9348cee4e83879755a1437aaa3e80ba3c12ceb7dbfc77fa8f02d24d9e6f5fca0c45ea10e5b7f41949e7b4805421bd82ad19cd82aee8bec4af738b44fdb9d9d9a44c3456dcb7664e5a98f4f231a9e3230a9d2c796fc4e9d0f1438df16e12eb4a260b33984649c09989b71d14be26cf428183e04ddb795e573e3df5452f58fca621f01fe3f41c531dfbc04d3f6bb38eac0f94ac832592aca2c77fc0237709a34258e9508311859414913f0cbcd5a8867710b97e3a2deae31a3590c040b02f4bc1d358ecc411b30212bbec127b0dca0cfb07772bfae182c9cbc6e0cc6d0d51ea868f0d06776a6c3c5af40873e6a4cb8eb46dbcaaff1482ca70bd2c9ead076b11f5fa49c151fa0b811294886c48cc2ff1ee41b004eb44e229f03ab6c7bb59e801dd83fad16773203b55643d4f2a674b102269994aa699d07414bc827aead43adc7900939162314b3089120b9b587c910db56a300c326bc296707c3d2648567c5e7fdebd365e6a1fd8e0db21193dc42a3d7814dddad75d2493478"];

/// The keys every first-party decision of this build is made under: `FIRST_PARTY_PUBLISHER_KEYS`,
/// and with the `ci-first-party-root` feature (the integration image only) the CI root's too
/// (`ci_first_party_root`).
pub fn trusted_first_party_keys() -> &'static [&'static str] {
    TRUSTED_FIRST_PARTY_KEYS
}

#[cfg(not(feature = "ci-first-party-root"))]
const TRUSTED_FIRST_PARTY_KEYS: &[&str] = FIRST_PARTY_PUBLISHER_KEYS;
#[cfg(feature = "ci-first-party-root")]
const TRUSTED_FIRST_PARTY_KEYS: &[&str] = &super::ci_first_party_root::WITH_PRODUCTION;

pub fn is_first_party(publisher_key: &str) -> bool {
    is_first_party_in(trusted_first_party_keys(), publisher_key)
}

/// Whether `publisher_key` is one of `trusted`, the first-party keys a decision is made under.
pub fn is_first_party_in(trusted: &[&str], publisher_key: &str) -> bool {
    trusted.contains(&publisher_key)
}

/// The manifest in `manifest_bytes`, if it is valid, may use its ABI, and `signature` is its
/// publisher's over it and the artifact digest it names.
pub fn verify_listing(manifest_bytes: &[u8], signature: &str) -> Result<AppManifest, AppsRefusal> {
    verify_listing_with(manifest_bytes, signature, trusted_first_party_keys())
}

/// `verify_listing`, with `trusted` as the first-party keys.
pub fn verify_listing_with(
    manifest_bytes: &[u8],
    signature: &str,
    trusted: &[&str],
) -> Result<AppManifest, AppsRefusal> {
    let manifest = AppManifest::from_bytes(manifest_bytes)
        .map_err(|why| AppsRefusal::InvalidManifest(why.to_string()))?;
    let key = &manifest.publisher.mldsa65_public_key;
    if manifest.sdk.abi == ABI_FIRST_PARTY_GLUE && !is_first_party_in(trusted, key) {
        return Err(AppsRefusal::InvalidManifest(
            "the transitional glue ABI is for the first-party publisher only".to_string(),
        ));
    }
    let wasm = sha256_from_hex(&manifest.artifact.sha256).map_err(|_| AppsRefusal::BadSignature)?;
    let digests = ArtifactDigests {
        manifest: sha256(manifest_bytes),
        wasm,
    };
    verify(key, &manifest.id, &manifest.version, &digests, signature)
        .map_err(|_| AppsRefusal::BadSignature)?;
    Ok(manifest)
}

/// What an install request asks, with the facts about the installer.
pub struct InstallInput<'a> {
    pub installer: &'a str,
    pub manifest: &'a AppManifest,
    pub app_id: &'a str,
    pub version: &'a str,
    pub scope: &'a InstallScope,
    pub granted: &'a [Capability],
    pub pinned_publisher_key: &'a str,
    pub inject_requirement: bool,
    /// The installer's permissions on the workspace root.
    pub at_root: &'a PermissionSnapshot,
    /// ... and on the scope's node (`facts::authority_node`), the root for a scope with none.
    pub at_authority: &'a PermissionSnapshot,
    /// Whether the node a `Node` or `NodeTree` scope names exists.
    pub scope_node_exists: bool,
    pub facts: &'a GatheredFacts,
}

/// What an accepted install records.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallPlan {
    pub granted: BTreeSet<Capability>,
    pub details: GrantDetails,
    /// The node whose header the kernel writes the requirement into.
    pub inject_into: Option<String>,
}

pub fn decide_install(input: &InstallInput<'_>) -> Result<InstallPlan, AppsRefusal> {
    let manifest = input.manifest;
    if manifest.id != input.app_id || manifest.version != input.version {
        return Err(AppsRefusal::Unavailable);
    }
    let key = &manifest.publisher.mldsa65_public_key;
    if key != input.pinned_publisher_key {
        return Err(AppsRefusal::BadSignature);
    }
    let root = |p: Permission| input.at_root.holds(p);
    may_install_at(input.scope, &manifest.scopes, input.installer, &root)?;
    let node_scope = matches!(
        input.scope,
        InstallScope::Node(_) | InstallScope::NodeTree(_)
    );
    if node_scope && !input.scope_node_exists {
        return Err(AppsRefusal::Unavailable);
    }
    let for_others = input.scope != &InstallScope::SelfOnly(input.installer.to_string());
    if for_others && !input.at_authority.holds(Permission::UpdateNodeSettings) {
        return Err(AppsRefusal::PermissionRequired(
            Permission::UpdateNodeSettings,
        ));
    }
    let granted: BTreeSet<Capability> = input.granted.iter().copied().collect();
    let authority = |p: Permission| input.at_authority.holds(p);
    check_grant(
        &manifest.capabilities,
        &granted,
        &authority,
        is_first_party(key),
    )?;
    scope_reach_within_audience(
        input.scope,
        &manifest.audience,
        &input.facts.members,
        input.facts,
    )?;
    let inject_into = if input.inject_requirement {
        let (InstallScope::Node(node) | InstallScope::NodeTree(node)) = input.scope else {
            return Err(AppsRefusal::ScopeNotSupported);
        };
        if let Some(missing) = action_permissions(AppsAction::WriteMdHeader)
            .iter()
            .find(|p| !input.at_authority.holds(**p))
        {
            return Err(AppsRefusal::PermissionRequired(*missing));
        }
        Some(node.clone())
    } else {
        None
    };
    Ok(InstallPlan {
        details: grant_details(manifest, &granted),
        granted,
        inject_into,
    })
}

/// Whether installing this release stores a module the server must obtain. Every ABI's module
/// does, wherever its listing came from, except the transitional first-party glue ABI's, which
/// ships in the UI bundle. Only a first-party key may publish that ABI (`verify_listing_with`).
pub fn stores_module(manifest: &AppManifest) -> bool {
    manifest.sdk.abi != ABI_FIRST_PARTY_GLUE
}

/// The hosts, routes and targets the manifest lists for the capabilities in `granted`.
pub fn grant_details(manifest: &AppManifest, granted: &BTreeSet<Capability>) -> GrantDetails {
    let listed = |cap: Capability, pick: fn(&CapabilityRequest) -> Option<Vec<String>>| {
        if !granted.contains(&cap) {
            return Vec::new();
        }
        manifest
            .capabilities
            .iter()
            .filter(|r| r.cap == cap)
            .find_map(pick)
            .unwrap_or_default()
    };
    GrantDetails {
        host_network_hosts: listed(Capability::NetHost, |r| r.hosts.clone()),
        server_network_hosts: listed(Capability::NetServer, |r| r.hosts.clone()),
        ihttp_routes: listed(Capability::IhttpServe, |r| r.routes.clone()),
        ihttp_call_targets: listed(Capability::IhttpCall, |r| r.targets.clone()),
        ihttp_p2p_routes: listed(Capability::IhttpP2pServe, |r| r.routes.clone()),
        topics: {
            let mut topics = listed(Capability::GroupTopicSubscribe, |r| r.topics.clone());
            for topic in listed(Capability::GroupTopicPublish, |r| r.topics.clone()) {
                if !topics.contains(&topic) {
                    topics.push(topic);
                }
            }
            topics
        },
    }
}
