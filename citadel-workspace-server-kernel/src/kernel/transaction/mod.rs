use citadel_logging::info;
use citadel_sdk::prelude::{BackendHandler, NetworkError, NodeRemote, ProtocolRemoteExt, Ratchet};
use citadel_workspace_types::structs::{Domain, DomainNode, TreeSchema, User, Workspace};
use citadel_workspace_types::GroupMessage;
use parking_lot::RwLock;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Arc;
// `async_transactions` (AsyncReadTransaction / AsyncWriteTransaction) was
// deleted here: nothing ever constructed either type, yet the module read as
// the authoritative transaction layer. It carried two divergences from the
// live handlers — an unlocked get_all_nodes/insert/save_nodes read-modify-write
// that violated the `lock_nodes` contract, and list_offices/list_rooms reading
// `TreeSchema::default()` instead of the stored schema — traps for whoever
// resurrected it. The live paths are the handlers in `crate::handlers` over
// `BackendTransactionManager` directly.
pub mod backend_ops_simple;
// Note: TransactionManager has been removed. Use BackendTransactionManager instead.

/// How many message locks exist, total.
///
/// Two groups collide with probability 1/GROUP_LOCK_STRIPES, and a collision
/// costs only the throughput the single global lock used to cost for every pair.
/// 256 `Mutex<()>` is a few KB, fixed for the life of the process.
const GROUP_LOCK_STRIPES: usize = 256;

/// Which stripe guards this group. A pure function of the id — see
/// `BackendTransactionManager::group_msg_mutex`.
fn group_stripe(group_id: &str) -> usize {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    group_id.hash(&mut hasher);
    (hasher.finish() % GROUP_LOCK_STRIPES as u64) as usize
}

/// A parsed node map and the exact bytes it came from.
///
/// The bytes are the validity check — see `BackendTransactionManager::nodes_cache`.
type CachedNodes = (Vec<u8>, Arc<HashMap<String, DomainNode>>);

/// Transaction manager that uses NodeRemote backend for persistence
pub struct BackendTransactionManager<R: Ratchet> {
    /// NodeRemote for backend operations
    node_remote: Arc<RwLock<Option<NodeRemote<R>>>>,
    /// In-memory storage for testing when no NodeRemote is available
    test_storage: Arc<RwLock<HashMap<String, Vec<u8>>>>,
    /// Whether migration from collection-level keys has been completed
    migrated: Arc<RwLock<bool>>,
    /// Serializes index-key read-modify-write operations across concurrent
    /// connection tasks. Without this, two connections inserting entities
    /// concurrently would race on the index (both read the same prior set,
    /// both append, second write wins) and silently drop one entity from
    /// the index - making the affected entity invisible to get_all_* lookups.
    index_write_mutex: Arc<tokio::sync::Mutex<()>>,
    /// Serializes group-message read-modify-write operations across all
    /// groups. Without this, two concurrent `store_group_message` /
    /// `update_group_message` / `delete_group_message` calls for the
    /// same group would each load the prior message list, mutate, and
    /// save — the second save silently overwrites the first, dropping
    /// a message edit or insert on the floor.
    ///
    /// One stripe per group, chosen by hashing the group id.
    ///
    /// The lock protects a read-modify-write of `group_messages:{group_id}`, and
    /// two different groups share nothing — but it was ONE mutex across every
    /// group, with a note to "refactor to a per-id mutex if profiling shows
    /// contention" on the grounds that group message ops are infrequent. They
    /// are chat. And the cost held under the guard is not small: the whole of a
    /// room's history is parsed and re-serialised per message, and
    /// `backend_save`'s 100/200/400ms retry sleeps happen inside the guard. So
    /// one busy room throttled sending for every room on the server.
    ///
    /// Striped rather than a map keyed by group id, which is what this was
    /// first written as. A map has to be bounded — an entry per group id is an
    /// unbounded collection keyed by user-supplied data — and every bound has a
    /// saturation case. That one shared a lock without recording which group it
    /// had been handed to, so the next caller for the same group could mint a
    /// fresh one and run its read-modify-write concurrently with the first,
    /// restoring exactly the lost update the mutex exists to prevent.
    ///
    /// Striping has no saturation case to get wrong. A group's stripe is a pure
    /// function of its id, so the same group always takes the same lock, for the
    /// life of the process. Memory is fixed. Two groups sharing a stripe costs
    /// throughput, never correctness, and `GROUP_LOCK_STRIPES` sets how often
    /// that happens.
    group_msg_mutex: Vec<Arc<tokio::sync::Mutex<()>>>,

    /// Serializes DomainNode-collection read-modify-write operations.
    /// All nodes share a single `citadel_workspace.nodes` HashMap key,
    /// so `insert_node` / `remove_node` / `update_node` all do a
    /// load-mutate-save cycle on that single key. Without the mutex,
    /// two concurrent node ops would each load the same prior map,
    /// apply their mutation, and the second save would overwrite the
    /// first's change — losing a node insert/delete/update silently.
    /// Same data-loss-vs-cost trade-off as `group_msg_mutex` above.
    node_mutex: Arc<tokio::sync::Mutex<()>>,

    /// The parsed node map, kept beside the exact bytes it was parsed from.
    ///
    /// Every group broadcast re-authorises every connected client, and each
    /// authorization walks `resolve_group_node` -> `check_entity_permission` ->
    /// `is_member_of_domain`, each of which calls `get_all_nodes`. So one message
    /// to a room of C clients cost 3*C `serde_json` parses of the single
    /// `citadel_workspace.nodes` blob — which carries every node's
    /// `mdx_content`, i.e. every document in the workspace. At 1 MB of nodes and
    /// 50 clients that is on the order of a CPU-second per message, paid inside
    /// each connection's own receive loop, so a client's requests stall behind
    /// other people's chat and its broadcast receiver falls behind the channel.
    ///
    /// Validated by comparing the raw bytes, not a hash or a TTL. This gates
    /// authorization, so an entry that is stale for even a moment is a removed
    /// member still reading; a memcmp is exact, has no collision to reason
    /// about, and is still an order of magnitude cheaper than the parse it
    /// replaces. The blob is fetched every time either way — only the parse and
    /// the map allocation are skipped.
    nodes_cache: Arc<RwLock<Option<CachedNodes>>>,

    /// Serializes read-modify-write sequences over a single `Workspace` record.
    ///
    /// A workspace is stored whole, so any handler that reads one, changes a
    /// field and writes it back can lose a concurrent change to a different
    /// field — the theme handler and a member update both load the same record
    /// and the second write discards the first. Same reasoning as `node_mutex`,
    /// applied to workspaces.
    ///
    /// `insert_workspace` deliberately does NOT take this itself, so a caller
    /// can hold the guard across the whole get → modify → insert sequence.
    /// tokio's Mutex is not reentrant; if that changes, this breaks.
    workspace_mutex: Arc<tokio::sync::Mutex<()>>,

    /// Test-only fault injection: keys whose deletes fail with an injected
    /// error. The in-memory `test_storage` cannot fail a delete, so failure
    /// ordering (e.g. "purge failed after the tree was saved") is otherwise
    /// untestable. `#[cfg(test)]`-gated: absent from every non-test build,
    /// including the integration-test build of this crate as a dependency.
    #[cfg(test)]
    failing_delete_keys: Arc<RwLock<std::collections::HashSet<String>>>,
}

impl<R: Ratchet + Send + Sync + 'static> Default for BackendTransactionManager<R> {
    fn default() -> Self {
        Self::new()
    }
}

/// Old collection-level storage keys (pre-migration).
const LEGACY_KEY_DOMAINS: &str = "citadel_workspace.domains";
const LEGACY_KEY_USERS: &str = "citadel_workspace.users";
const LEGACY_KEY_WORKSPACES: &str = "citadel_workspace.workspaces";
const LEGACY_KEY_PASSWORDS: &str = "citadel_workspace.passwords";

/// Per-entity key prefixes (post-migration).
const KEY_PREFIX_DOMAIN: &str = "citadel_workspace.domain.";
const KEY_PREFIX_USER: &str = "citadel_workspace.user.";
const KEY_PREFIX_WORKSPACE: &str = "citadel_workspace.workspace.";
const KEY_PREFIX_PASSWORD: &str = "citadel_workspace.password.";

/// Index keys that hold the set of entity IDs.
const KEY_INDEX_DOMAIN_IDS: &str = "citadel_workspace.domain_ids";
const KEY_INDEX_USER_IDS: &str = "citadel_workspace.user_ids";
const KEY_INDEX_WORKSPACE_IDS: &str = "citadel_workspace.workspace_ids";

/// Sentinel key indicating migration has been completed.
const KEY_MIGRATION_DONE: &str = "citadel_workspace.migration_v2_done";

/// Key for storing the backend schema version.
pub(crate) const KEY_SCHEMA_VERSION: &str = "citadel_workspace.schema_version";

/// Durable "the initial workspace structure has been seeded" marker.
///
/// `on_start` runs the structure seeding on EVERY boot, so it needs a way to
/// know whether a workspace is genuinely new. Inferring that from "the tree has
/// no root children" is not sound: an admin who deletes every office leaves a
/// legitimately-empty tree that would then be re-seeded with the baked-in
/// defaults on the next restart, resurrecting content they deliberately removed.
/// A persisted marker records the fact of seeding itself, which is what the
/// contract actually depends on.
pub(crate) const KEY_STRUCTURE_SEEDED: &str = "citadel_workspace.structure_seeded";

/// Durable "a brand-new workspace was created and its initial structure has NOT yet been
/// confirmed written" marker.
///
/// Written when the root workspace is first created, and cleared once the structure is durably
/// seeded. It is what makes an interrupted first boot recoverable: if the process dies (or the
/// node write merely fails) between creating the root workspace and writing the tree, the next
/// boot still sees this marker and finishes the job. Without it, that store would look
/// indistinguishable from an established pre-marker workspace and would be permanently left
/// with no offices at all.
pub(crate) const KEY_STRUCTURE_SEED_PENDING: &str = "citadel_workspace.structure_seed_pending";

impl<R: Ratchet + Send + Sync + 'static> BackendTransactionManager<R> {
    pub fn new() -> Self {
        info!(target: "citadel", "Initializing BackendTransactionManager with NodeRemote backend");

        Self {
            node_remote: Arc::new(RwLock::new(None)),
            test_storage: Arc::new(RwLock::new(HashMap::new())),
            migrated: Arc::new(RwLock::new(false)),
            index_write_mutex: Arc::new(tokio::sync::Mutex::new(())),
            group_msg_mutex: (0..GROUP_LOCK_STRIPES)
                .map(|_| Arc::new(tokio::sync::Mutex::new(())))
                .collect(),
            node_mutex: Arc::new(tokio::sync::Mutex::new(())),
            nodes_cache: Arc::new(RwLock::new(None)),
            workspace_mutex: Arc::new(tokio::sync::Mutex::new(())),
            #[cfg(test)]
            failing_delete_keys: Arc::new(RwLock::new(std::collections::HashSet::new())),
        }
    }

    /// Test-only: make every delete of `key` fail until cleared. See
    /// `failing_delete_keys`.
    #[cfg(test)]
    pub(crate) fn fail_deletes_of(&self, key: &str) {
        self.failing_delete_keys.write().insert(key.to_string());
    }

    /// Test-only: clear an injected delete fault for `key`.
    #[cfg(test)]
    pub(crate) fn clear_delete_fault(&self, key: &str) {
        self.failing_delete_keys.write().remove(key);
    }

    /// Set the NodeRemote instance
    pub fn set_node_remote(&self, node_remote: NodeRemote<R>) {
        *self.node_remote.write() = Some(node_remote);
    }

    /// Check if we're in test mode (no NodeRemote set)
    pub fn is_test_mode(&self) -> bool {
        self.node_remote.read().is_none()
    }

    /// Get the node remote
    fn get_node_remote(&self) -> Result<NodeRemote<R>, NetworkError> {
        self.node_remote
            .read()
            .as_ref()
            .ok_or_else(|| NetworkError::msg("NodeRemote not set"))
            .cloned()
    }

    // ========== Generic Backend Helpers (SSOT for persistence pattern) ==========

    /// Generic get: deserializes a value from the backend by key.
    /// Returns `None` if the key doesn't exist.
    /// The stored bytes for a key, before any deserialization.
    ///
    /// Split out so `get_all_nodes_shared` can compare what it just fetched
    /// against what it last parsed.
    async fn backend_get_raw(&self, key: &str) -> Result<Option<Vec<u8>>, NetworkError> {
        if self.node_remote.read().is_none() {
            return Ok(self.test_storage.read().get(key).cloned());
        }

        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {e}")))?;

        backend.get(key).await
    }

    async fn backend_get<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, NetworkError> {
        match self.backend_get_raw(key).await? {
            Some(data) => serde_json::from_slice(&data)
                .map(Some)
                .map_err(|e| NetworkError::msg(format!("Failed to deserialize {key}: {e}"))),
            None => Ok(None),
        }
    }

    /// Generic save: serializes a value and writes it to the backend by key.
    /// Includes retry logic with exponential backoff for transient failures.
    async fn backend_save<T: Serialize>(&self, key: &str, value: &T) -> Result<(), NetworkError> {
        let data = serde_json::to_vec(value)
            .map_err(|e| NetworkError::msg(format!("Failed to serialize {key}: {e}")))?;

        if self.node_remote.read().is_none() {
            self.test_storage.write().insert(key.to_string(), data);
            return Ok(());
        }

        // Retry with exponential backoff: 100ms, 200ms, 400ms
        let mut last_err = None;
        for attempt in 0..3u32 {
            if attempt > 0 {
                let delay = std::time::Duration::from_millis(100 * (1 << (attempt - 1)));
                citadel_logging::warn!(target: "citadel", "Retrying backend_save for key '{}' (attempt {}/3) after {:?}", key, attempt + 1, delay);
                tokio::time::sleep(delay).await;
            }

            match self.try_backend_save(key, &data).await {
                Ok(()) => return Ok(()),
                Err(e) => {
                    last_err = Some(e);
                }
            }
        }

        Err(last_err.unwrap_or_else(|| {
            NetworkError::msg(format!("Failed to save key '{key}' after 3 attempts"))
        }))
    }

    /// Single attempt to save data to the backend
    async fn try_backend_save(&self, key: &str, data: &[u8]) -> Result<(), NetworkError> {
        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {e}")))?;
        backend.set(key, data.to_vec()).await?;
        Ok(())
    }

    /// Generic delete: removes a key from the backend.
    async fn backend_delete(&self, key: &str) -> Result<(), NetworkError> {
        #[cfg(test)]
        if self.failing_delete_keys.read().contains(key) {
            return Err(NetworkError::msg(format!(
                "injected delete fault for key '{key}'"
            )));
        }

        if self.node_remote.read().is_none() {
            self.test_storage.write().remove(key);
            return Ok(());
        }

        let node_remote = self.get_node_remote()?;
        let backend = node_remote
            .propose_target(0, 0)
            .await
            .map_err(|e| NetworkError::msg(format!("Failed to get backend handler: {e}")))?;
        backend.remove(key).await?;
        Ok(())
    }

    // ========== Index Helpers ==========

    /// Get the set of entity IDs from an index key.
    async fn get_index(&self, index_key: &str) -> Result<HashSet<String>, NetworkError> {
        Ok(self.backend_get(index_key).await?.unwrap_or_default())
    }

    /// Save the set of entity IDs to an index key.
    async fn save_index(&self, index_key: &str, ids: &HashSet<String>) -> Result<(), NetworkError> {
        self.backend_save(index_key, ids).await
    }

    /// Add an ID to an index and persist.
    ///
    /// The read-modify-write is serialised through `index_write_mutex` so that
    /// two concurrent tasks inserting distinct entities cannot race and
    /// silently drop one entity from the index.
    async fn add_to_index(&self, index_key: &str, id: &str) -> Result<(), NetworkError> {
        let _guard = self.index_write_mutex.lock().await;
        let mut ids = self.get_index(index_key).await?;
        ids.insert(id.to_string());
        self.save_index(index_key, &ids).await
    }

    /// Remove an ID from an index and persist.
    ///
    /// Serialised through `index_write_mutex`; see `add_to_index` for rationale.
    async fn remove_from_index(&self, index_key: &str, id: &str) -> Result<(), NetworkError> {
        let _guard = self.index_write_mutex.lock().await;
        let mut ids = self.get_index(index_key).await?;
        ids.remove(id);
        self.save_index(index_key, &ids).await
    }

    // ========== Migration ==========

    /// Check for legacy collection-level keys and migrate to per-entity keys.
    /// This is idempotent: if migration has already run, it is a no-op.
    pub async fn migrate_if_needed(&self) -> Result<(), NetworkError> {
        // Fast path: already migrated this process lifetime
        if *self.migrated.read() {
            return Ok(());
        }

        // Check persistent sentinel
        let done: Option<bool> = self.backend_get(KEY_MIGRATION_DONE).await?;
        if done == Some(true) {
            *self.migrated.write() = true;
            return Ok(());
        }

        info!(target: "citadel", "Checking for legacy collection-level storage keys to migrate...");

        // Migrate domains.
        //
        // Each `save_index` call is wrapped in `index_write_mutex` so a
        // concurrent request handler calling `add_to_index` cannot race
        // with the migration writing the migrated set: the handler's
        // addition would otherwise be loaded by `add_to_index`, then
        // overwritten when the migration's `save_index` lands. Today
        // `init()` runs before connections are accepted so the race
        // window is zero in practice, but the mutex acquisition keeps
        // the invariant of "every write to an index goes through
        // `index_write_mutex`" intact regardless of future call order.
        let legacy_domains: Option<HashMap<String, Domain>> =
            self.backend_get(LEGACY_KEY_DOMAINS).await?;
        if let Some(domains) = legacy_domains {
            info!(target: "citadel", "Migrating {} domains to per-entity keys", domains.len());
            let mut ids = HashSet::new();
            for (id, domain) in &domains {
                let key = format!("{KEY_PREFIX_DOMAIN}{id}");
                self.backend_save(&key, domain).await?;
                ids.insert(id.clone());
            }
            {
                let _guard = self.index_write_mutex.lock().await;
                self.save_index(KEY_INDEX_DOMAIN_IDS, &ids).await?;
            }
            self.backend_delete(LEGACY_KEY_DOMAINS).await?;
        }

        // Migrate users — same mutex contract as domains above.
        let legacy_users: Option<HashMap<String, User>> =
            self.backend_get(LEGACY_KEY_USERS).await?;
        if let Some(users) = legacy_users {
            info!(target: "citadel", "Migrating {} users to per-entity keys", users.len());
            let mut ids = HashSet::new();
            for (id, user) in &users {
                let key = format!("{KEY_PREFIX_USER}{id}");
                self.backend_save(&key, user).await?;
                ids.insert(id.clone());
            }
            {
                let _guard = self.index_write_mutex.lock().await;
                self.save_index(KEY_INDEX_USER_IDS, &ids).await?;
            }
            self.backend_delete(LEGACY_KEY_USERS).await?;
        }

        // Migrate workspaces — same mutex contract as domains above.
        let legacy_workspaces: Option<HashMap<String, Workspace>> =
            self.backend_get(LEGACY_KEY_WORKSPACES).await?;
        if let Some(workspaces) = legacy_workspaces {
            info!(target: "citadel", "Migrating {} workspaces to per-entity keys", workspaces.len());
            let mut ids = HashSet::new();
            for (id, workspace) in &workspaces {
                let key = format!("{KEY_PREFIX_WORKSPACE}{id}");
                self.backend_save(&key, workspace).await?;
                ids.insert(id.clone());
            }
            {
                let _guard = self.index_write_mutex.lock().await;
                self.save_index(KEY_INDEX_WORKSPACE_IDS, &ids).await?;
            }
            self.backend_delete(LEGACY_KEY_WORKSPACES).await?;
        }

        // Migrate passwords (no index needed)
        let legacy_passwords: Option<HashMap<String, String>> =
            self.backend_get(LEGACY_KEY_PASSWORDS).await?;
        if let Some(passwords) = legacy_passwords {
            info!(target: "citadel", "Migrating {} passwords to per-entity keys", passwords.len());
            for (id, password) in &passwords {
                let key = format!("{KEY_PREFIX_PASSWORD}{id}");
                self.backend_save(&key, password).await?;
            }
            self.backend_delete(LEGACY_KEY_PASSWORDS).await?;
        }

        // Write sentinel
        self.backend_save(KEY_MIGRATION_DONE, &true).await?;
        *self.migrated.write() = true;
        info!(target: "citadel", "Migration to per-entity storage keys complete");
        Ok(())
    }

    // ========== Per-Entity Accessors ==========

    /// Get a single domain by ID using per-entity key.
    pub async fn get_domain_by_key(&self, id: &str) -> Result<Option<Domain>, NetworkError> {
        let key = format!("{KEY_PREFIX_DOMAIN}{id}");
        self.backend_get(&key).await
    }

    /// Save a single domain by ID using per-entity key.
    pub async fn save_domain_by_key(&self, id: &str, domain: &Domain) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_DOMAIN}{id}");
        self.backend_save(&key, domain).await
    }

    /// Delete a single domain entity key.
    pub async fn delete_domain_key(&self, id: &str) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_DOMAIN}{id}");
        self.backend_delete(&key).await
    }

    /// Get a single user by ID using per-entity key.
    pub async fn get_user_by_key(&self, id: &str) -> Result<Option<User>, NetworkError> {
        let key = format!("{KEY_PREFIX_USER}{id}");
        self.backend_get(&key).await
    }

    /// Save a single user by ID using per-entity key.
    pub async fn save_user_by_key(&self, id: &str, user: &User) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_USER}{id}");
        self.backend_save(&key, user).await
    }

    /// Delete a single user entity key.
    pub async fn delete_user_key(&self, id: &str) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_USER}{id}");
        self.backend_delete(&key).await
    }

    /// Get a single workspace by ID using per-entity key.
    pub async fn get_workspace_by_key(&self, id: &str) -> Result<Option<Workspace>, NetworkError> {
        let key = format!("{KEY_PREFIX_WORKSPACE}{id}");
        self.backend_get(&key).await
    }

    /// Save a single workspace by ID using per-entity key.
    pub async fn save_workspace_by_key(
        &self,
        id: &str,
        workspace: &Workspace,
    ) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_WORKSPACE}{id}");
        self.backend_save(&key, workspace).await
    }

    /// Delete a single workspace entity key.
    pub async fn delete_workspace_key(&self, id: &str) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_WORKSPACE}{id}");
        self.backend_delete(&key).await
    }

    /// Get a single password by workspace ID using per-entity key.
    pub async fn get_password_by_key(&self, id: &str) -> Result<Option<String>, NetworkError> {
        let key = format!("{KEY_PREFIX_PASSWORD}{id}");
        self.backend_get(&key).await
    }

    /// Save a single password by workspace ID using per-entity key.
    pub async fn save_password_by_key(&self, id: &str, password: &str) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_PASSWORD}{id}");
        self.backend_save(&key, &password.to_string()).await
    }

    /// Delete a single password entity key.
    pub async fn delete_password_key(&self, id: &str) -> Result<(), NetworkError> {
        let key = format!("{KEY_PREFIX_PASSWORD}{id}");
        self.backend_delete(&key).await
    }

    // ========== Typed Accessors (delegate to per-entity keys via index) ==========
    //
    // These preserve the original public API. They reconstruct the full HashMap
    // by iterating over the index and fetching each entity individually.

    pub async fn get_all_domains(&self) -> Result<HashMap<String, Domain>, NetworkError> {
        let ids = self.get_index(KEY_INDEX_DOMAIN_IDS).await?;
        let mut map = HashMap::with_capacity(ids.len());
        for id in &ids {
            if let Some(domain) = self.get_domain_by_key(id).await? {
                map.insert(id.clone(), domain);
            }
        }
        Ok(map)
    }

    pub async fn get_all_users(&self) -> Result<HashMap<String, User>, NetworkError> {
        let ids = self.get_index(KEY_INDEX_USER_IDS).await?;
        let mut map = HashMap::with_capacity(ids.len());
        for id in &ids {
            if let Some(user) = self.get_user_by_key(id).await? {
                map.insert(id.clone(), user);
            }
        }
        Ok(map)
    }

    pub async fn get_all_workspaces(&self) -> Result<HashMap<String, Workspace>, NetworkError> {
        let ids = self.get_index(KEY_INDEX_WORKSPACE_IDS).await?;
        let mut map = HashMap::with_capacity(ids.len());
        for id in &ids {
            if let Some(workspace) = self.get_workspace_by_key(id).await? {
                map.insert(id.clone(), workspace);
            }
        }
        Ok(map)
    }

    pub async fn get_all_passwords(&self) -> Result<HashMap<String, String>, NetworkError> {
        // Passwords don't have a dedicated index. We derive the password IDs
        // from the workspace index, since passwords are keyed by workspace ID.
        let ids = self.get_index(KEY_INDEX_WORKSPACE_IDS).await?;
        let mut map = HashMap::new();
        for id in &ids {
            if let Some(password) = self.get_password_by_key(id).await? {
                map.insert(id.clone(), password);
            }
        }
        Ok(map)
    }

    pub async fn save_domains(
        &self,
        domains: &HashMap<String, Domain>,
    ) -> Result<(), NetworkError> {
        // Bulk replace of the domain collection. Taken under the same
        // index_write_mutex as add_to_index/remove_from_index so an in-flight
        // single-entity insert cannot be clobbered by this write rebuilding
        // the index from an older snapshot.
        let _guard = self.index_write_mutex.lock().await;

        // Compute the desired set of IDs from the incoming map
        let new_ids: HashSet<String> = domains.keys().cloned().collect();
        let old_ids = self.get_index(KEY_INDEX_DOMAIN_IDS).await?;

        // Delete entities that are no longer present
        for id in old_ids.difference(&new_ids) {
            self.delete_domain_key(id).await?;
        }

        // Save each entity
        for (id, domain) in domains {
            self.save_domain_by_key(id, domain).await?;
        }

        // Update index
        self.save_index(KEY_INDEX_DOMAIN_IDS, &new_ids).await
    }

    pub async fn save_users(&self, users: &HashMap<String, User>) -> Result<(), NetworkError> {
        // See `save_domains` for rationale on index_write_mutex.
        let _guard = self.index_write_mutex.lock().await;

        let new_ids: HashSet<String> = users.keys().cloned().collect();
        let old_ids = self.get_index(KEY_INDEX_USER_IDS).await?;

        for id in old_ids.difference(&new_ids) {
            self.delete_user_key(id).await?;
        }

        for (id, user) in users {
            self.save_user_by_key(id, user).await?;
        }

        self.save_index(KEY_INDEX_USER_IDS, &new_ids).await
    }

    pub async fn save_workspaces(
        &self,
        workspaces: &HashMap<String, Workspace>,
    ) -> Result<(), NetworkError> {
        // See `save_domains` for rationale on index_write_mutex.
        let _guard = self.index_write_mutex.lock().await;

        let new_ids: HashSet<String> = workspaces.keys().cloned().collect();
        let old_ids = self.get_index(KEY_INDEX_WORKSPACE_IDS).await?;

        for id in old_ids.difference(&new_ids) {
            self.delete_workspace_key(id).await?;
            // Mirror remove_workspace's password cleanup. Without
            // this, workspaces removed via the bulk save path would
            // leave their `citadel_workspace.password.{id}` entry
            // orphaned in the backend forever - leaking secret
            // material and risking re-association if the same id is
            // ever reused.
            self.delete_password_key(id).await?;
        }

        for (id, workspace) in workspaces {
            self.save_workspace_by_key(id, workspace).await?;
        }

        self.save_index(KEY_INDEX_WORKSPACE_IDS, &new_ids).await
    }

    /// Persist passwords keyed by workspace ID.
    ///
    /// IMPORTANT: this is UPSERT-ONLY. Unlike `save_workspaces`, it does not
    /// reconcile deletions — a key omitted from `passwords` is NOT removed
    /// from the backend (there is no password index to diff against). Removal
    /// must be done explicitly via `delete_password_key`, which is what
    /// `remove_workspace` does. Do NOT rely on dropping a key from the map +
    /// calling this to delete a secret; the stale password would silently
    /// persist.
    pub async fn save_passwords(
        &self,
        passwords: &HashMap<String, String>,
    ) -> Result<(), NetworkError> {
        for (id, password) in passwords {
            self.save_password_by_key(id, password).await?;
        }
        Ok(())
    }

    // ========== Group Messaging Storage ==========

    fn group_messages_key(group_id: &str) -> String {
        format!("citadel_workspace.group_messages.{}", group_id)
    }

    pub async fn get_group_messages(
        &self,
        group_id: &str,
    ) -> Result<Vec<GroupMessage>, NetworkError> {
        let key = Self::group_messages_key(group_id);
        Ok(self.backend_get(&key).await?.unwrap_or_default())
    }

    /// Get paginated messages for a group
    pub async fn get_group_messages_paginated(
        &self,
        group_id: &str,
        before_timestamp: Option<u64>,
        limit: u32,
    ) -> Result<(Vec<GroupMessage>, bool), NetworkError> {
        let all_messages = self.get_group_messages(group_id).await?;

        // Sort by timestamp descending (newest first)
        let mut messages: Vec<GroupMessage> = all_messages
            .into_iter()
            .filter(|m| {
                // Only include messages before the given timestamp
                if let Some(before) = before_timestamp {
                    m.timestamp < before
                } else {
                    true
                }
            })
            .collect();

        messages.sort_by_key(|m| std::cmp::Reverse(m.timestamp));

        // Apply limit
        let limit = limit as usize;
        let has_more = messages.len() > limit;
        messages.truncate(limit);

        Ok((messages, has_more))
    }

    /// Get thread messages (replies to a specific message)
    pub async fn get_thread_messages(
        &self,
        group_id: &str,
        parent_message_id: &str,
    ) -> Result<Vec<GroupMessage>, NetworkError> {
        let all_messages = self.get_group_messages(group_id).await?;

        let mut thread_messages: Vec<GroupMessage> = all_messages
            .into_iter()
            .filter(|m| m.reply_to.as_ref() == Some(&parent_message_id.to_string()))
            .collect();

        // Sort by timestamp ascending (oldest first for threads)
        thread_messages.sort_by_key(|m| m.timestamp);

        Ok(thread_messages)
    }

    /// The lock guarding one group's message list.
    ///
    /// A pure function of the id: same group, same stripe, always. That is the
    /// whole correctness argument, and it is why this cannot have the bug the
    /// map version had — there is no state to saturate and no moment at which a
    /// group's answer changes.
    fn group_lock(&self, group_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.group_msg_mutex[group_stripe(group_id)].clone()
    }

    async fn save_group_messages(
        &self,
        group_id: &str,
        messages: &[GroupMessage],
    ) -> Result<(), NetworkError> {
        let key = Self::group_messages_key(group_id);
        self.backend_save(&key, &messages).await
    }

    /// Store a new group message.
    ///
    /// Serialized through `group_msg_mutex` so two concurrent inserts
    /// for the same group cannot race on the load-modify-save cycle
    /// (both read the same prior list, both push, second save
    /// overwrites the first — silently dropping the earlier message).
    pub async fn store_group_message(&self, message: GroupMessage) -> Result<(), NetworkError> {
        let group_id = message.group_id.clone();
        let lock = self.group_lock(&group_id);
        let _guard = lock.lock().await;
        let mut messages = self.get_group_messages(&group_id).await?;

        // If this is a reply, increment the parent's reply_count
        if let Some(parent_id) = &message.reply_to {
            for msg in &mut messages {
                if &msg.id == parent_id {
                    msg.reply_count += 1;
                    break;
                }
            }
        }

        messages.push(message);
        self.save_group_messages(&group_id, &messages).await
    }

    /// Update a group message (edit). Serialized through
    /// `group_msg_mutex` for the same reason as `store_group_message`.
    pub async fn update_group_message(
        &self,
        group_id: &str,
        message_id: &str,
        new_content: String,
        edited_at: u64,
    ) -> Result<Option<GroupMessage>, NetworkError> {
        let lock = self.group_lock(group_id);
        let _guard = lock.lock().await;
        let mut messages = self.get_group_messages(group_id).await?;

        let mut updated_message = None;
        for msg in &mut messages {
            if msg.id == message_id {
                msg.content = new_content;
                msg.edited_at = Some(edited_at);
                updated_message = Some(msg.clone());
                break;
            }
        }

        if updated_message.is_some() {
            self.save_group_messages(group_id, &messages).await?;
        }

        Ok(updated_message)
    }

    /// Delete a group message. Serialized through `group_msg_mutex`
    /// for the same reason as `store_group_message`.
    pub async fn delete_group_message(
        &self,
        group_id: &str,
        message_id: &str,
    ) -> Result<Option<GroupMessage>, NetworkError> {
        let lock = self.group_lock(group_id);
        let _guard = lock.lock().await;
        let mut messages = self.get_group_messages(group_id).await?;

        // Find and remove the message
        let mut deleted_message = None;
        let mut parent_id_to_decrement = None;

        messages.retain(|msg| {
            if msg.id == message_id {
                deleted_message = Some(msg.clone());
                parent_id_to_decrement = msg.reply_to.clone();
                false
            } else {
                true
            }
        });

        // If this was a reply, decrement the parent's reply_count
        if let Some(parent_id) = parent_id_to_decrement {
            for msg in &mut messages {
                if msg.id == parent_id && msg.reply_count > 0 {
                    msg.reply_count -= 1;
                    break;
                }
            }
        }

        if deleted_message.is_some() {
            self.save_group_messages(group_id, &messages).await?;
        }

        Ok(deleted_message)
    }

    /// Drop every message a room ever held.
    ///
    /// Deleting a node removed it from the node map and nothing else, so the
    /// room's entire message history stayed in the backend under
    /// `citadel_workspace.group_messages.<id>` -- unreachable, because the node
    /// that named it was gone, and therefore unlistable and unpurgeable. Every
    /// message anyone ever sent in a deleted room was retained indefinitely,
    /// which is not what deleting a room means to the person who pressed it.
    ///
    /// Serialized through `group_msg_mutex` like every other writer of this key,
    /// so a send racing the delete cannot re-create the entry after it is gone.
    pub async fn delete_all_group_messages(&self, group_id: &str) -> Result<(), NetworkError> {
        let lock = self.group_lock(group_id);
        let _guard = lock.lock().await;
        self.backend_delete(&Self::group_messages_key(group_id))
            .await
    }

    /// Get a single message by ID
    pub async fn get_group_message(
        &self,
        group_id: &str,
        message_id: &str,
    ) -> Result<Option<GroupMessage>, NetworkError> {
        let messages = self.get_group_messages(group_id).await?;
        Ok(messages.into_iter().find(|m| m.id == message_id))
    }

    // ========== DomainNode (Generalized Tree Hierarchy) Storage ==========

    /// The node map for READERS, shared rather than cloned.
    ///
    /// The authorization walk that runs per broadcast recipient only reads, and
    /// it reads three times. Handing back an `Arc` lets those three calls share
    /// one parse and one allocation instead of making three of each — see
    /// `nodes_cache`.
    pub async fn get_all_nodes_shared(
        &self,
    ) -> Result<Arc<HashMap<String, DomainNode>>, NetworkError> {
        let Some(raw) = self.backend_get_raw("citadel_workspace.nodes").await? else {
            return Ok(Arc::new(HashMap::new()));
        };

        if let Some((cached_raw, cached)) = self.nodes_cache.read().as_ref() {
            if cached_raw == &raw {
                return Ok(cached.clone());
            }
        }

        let parsed: Arc<HashMap<String, DomainNode>> =
            Arc::new(serde_json::from_slice(&raw).map_err(|e| {
                NetworkError::msg(format!(
                    "Failed to deserialize citadel_workspace.nodes: {e}"
                ))
            })?);
        *self.nodes_cache.write() = Some((raw, parsed.clone()));
        Ok(parsed)
    }

    /// The node map for MUTATORS, owned so it can be modified and saved back.
    pub async fn get_all_nodes(&self) -> Result<HashMap<String, DomainNode>, NetworkError> {
        Ok((*self.get_all_nodes_shared().await?).clone())
    }

    pub async fn save_nodes(
        &self,
        nodes: &HashMap<String, DomainNode>,
    ) -> Result<(), NetworkError> {
        self.backend_save("citadel_workspace.nodes", nodes).await
    }

    pub async fn get_tree_schema(&self) -> Result<Option<TreeSchema>, NetworkError> {
        self.backend_get("citadel_workspace.tree_schema").await
    }

    pub async fn save_tree_schema(&self, schema: &TreeSchema) -> Result<(), NetworkError> {
        self.backend_save("citadel_workspace.tree_schema", schema)
            .await
    }
}

#[cfg(test)]
mod migration_tests {
    //! Tests for the legacy-collection -> per-entity-key migration and the
    //! schema-version stamping in `BackendTransactionManager`.
    //!
    //! These tests run against the in-memory `test_storage` backend (no
    //! `NodeRemote`), which is the only mode reachable from a unit test;
    //! the real-backend behaviour is exercised end-to-end via the kernel
    //! integration tests. The contract being verified here is the same
    //! either way: the migration moves data from legacy collection keys to
    //! per-entity keys, populates the index, removes the legacy collection,
    //! sets the persistent sentinel, and is idempotent.
    use super::*;
    use citadel_sdk::prelude::StackedRatchet;
    use citadel_workspace_types::structs::Workspace;

    fn fresh() -> BackendTransactionManager<StackedRatchet> {
        BackendTransactionManager::new()
    }

    fn ws(id: &str) -> Workspace {
        Workspace {
            id: id.to_string(),
            name: format!("workspace-{id}"),
            description: String::new(),
            owner_id: "owner".to_string(),
            members: vec![],
            offices: vec![],
            metadata: vec![],
        }
    }

    /// Helper: write a serialized blob directly into `test_storage` to
    /// simulate a backend that already contains a legacy collection. We
    /// have to reach into the private field (rather than calling the
    /// public save_* methods) because those write to per-entity keys -
    /// the very format we're trying to migrate AWAY from.
    fn seed_legacy<T: Serialize>(
        mgr: &BackendTransactionManager<StackedRatchet>,
        key: &str,
        value: &T,
    ) {
        let bytes = serde_json::to_vec(value).expect("serialize");
        mgr.test_storage.write().insert(key.to_string(), bytes);
    }

    #[tokio::test]
    async fn migrate_moves_legacy_domains_to_per_entity_keys() {
        let mgr = fresh();

        // Seed two domains in the legacy collection format.
        let mut domains: HashMap<String, Domain> = HashMap::new();
        domains.insert("a".to_string(), Domain::Workspace { workspace: ws("a") });
        domains.insert("b".to_string(), Domain::Workspace { workspace: ws("b") });
        seed_legacy(&mgr, LEGACY_KEY_DOMAINS, &domains);

        mgr.migrate_if_needed().await.expect("migration");

        // Each entity now reachable via the per-entity key.
        assert!(mgr.get_domain_by_key("a").await.unwrap().is_some());
        assert!(mgr.get_domain_by_key("b").await.unwrap().is_some());

        // Index reflects both IDs.
        let idx = mgr.get_index(KEY_INDEX_DOMAIN_IDS).await.unwrap();
        assert_eq!(idx.len(), 2);
        assert!(idx.contains("a"));
        assert!(idx.contains("b"));

        // Legacy collection key is removed.
        assert!(mgr.test_storage.read().get(LEGACY_KEY_DOMAINS).is_none());

        // Persistent sentinel is set so the next startup is a no-op.
        let sentinel: Option<bool> = mgr.backend_get(KEY_MIGRATION_DONE).await.unwrap();
        assert_eq!(sentinel, Some(true));
    }

    #[tokio::test]
    async fn migrate_is_no_op_on_fresh_database() {
        let mgr = fresh();
        // No legacy keys, no per-entity keys. Migration should still run
        // cleanly and stamp the sentinel.
        mgr.migrate_if_needed().await.expect("migration");

        let sentinel: Option<bool> = mgr.backend_get(KEY_MIGRATION_DONE).await.unwrap();
        assert_eq!(sentinel, Some(true));
        let idx = mgr.get_index(KEY_INDEX_DOMAIN_IDS).await.unwrap();
        assert!(idx.is_empty());
    }

    #[tokio::test]
    async fn migrate_skips_when_persistent_sentinel_already_set() {
        let mgr = fresh();
        // Pre-stamp the sentinel as if a previous run had completed.
        mgr.backend_save(KEY_MIGRATION_DONE, &true).await.unwrap();

        // Plant legacy data; this MUST NOT be migrated because the sentinel
        // says we're done.
        let mut domains: HashMap<String, Domain> = HashMap::new();
        domains.insert("x".to_string(), Domain::Workspace { workspace: ws("x") });
        seed_legacy(&mgr, LEGACY_KEY_DOMAINS, &domains);

        mgr.migrate_if_needed().await.expect("migration");

        assert!(
            mgr.get_domain_by_key("x").await.unwrap().is_none(),
            "sentinel must short-circuit the migration"
        );
        assert!(
            mgr.test_storage.read().get(LEGACY_KEY_DOMAINS).is_some(),
            "legacy data must remain untouched when sentinel is set"
        );
    }

    #[tokio::test]
    async fn migrate_running_twice_in_same_process_is_cheap() {
        let mgr = fresh();

        let mut domains: HashMap<String, Domain> = HashMap::new();
        domains.insert("y".to_string(), Domain::Workspace { workspace: ws("y") });
        seed_legacy(&mgr, LEGACY_KEY_DOMAINS, &domains);

        mgr.migrate_if_needed().await.expect("first migration");
        // Second call must be a no-op (process-local fast-path), and must
        // not undo anything from the first call.
        mgr.migrate_if_needed().await.expect("second migration");

        let idx = mgr.get_index(KEY_INDEX_DOMAIN_IDS).await.unwrap();
        assert_eq!(idx.len(), 1);
        assert!(mgr.get_domain_by_key("y").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn schema_version_round_trips() {
        let mgr = fresh();

        // Fresh DB has no version stamp.
        assert!(mgr.get_schema_version().await.unwrap().is_none());

        // After set, the value is visible to subsequent reads.
        mgr.set_schema_version(7).await.unwrap();
        assert_eq!(mgr.get_schema_version().await.unwrap(), Some(7));

        // Idempotent overwrite to a higher version (simulates an upgrade).
        mgr.set_schema_version(8).await.unwrap();
        assert_eq!(mgr.get_schema_version().await.unwrap(), Some(8));
    }
}

#[cfg(test)]
mod group_message_tests {
    //! Regression tests for the `group_msg_mutex`. The three group
    //! message ops (`store`, `update`, `delete`) all do a load,
    //! mutate, save sequence; without the mutex, two concurrent
    //! callers would each load the prior list, mutate, and save in
    //! whichever order their futures wake — silently dropping one
    //! caller's mutation when the second save lands on top.
    use super::*;
    use citadel_sdk::prelude::StackedRatchet;
    use citadel_workspace_types::{GroupMessage, GroupMessageType};

    fn fresh() -> Arc<BackendTransactionManager<StackedRatchet>> {
        Arc::new(BackendTransactionManager::new())
    }

    fn msg(id: &str, group_id: &str) -> GroupMessage {
        GroupMessage {
            id: id.to_string(),
            group_id: group_id.to_string(),
            sender_id: "u1".to_string(),
            sender_name: "Alice".to_string(),
            message_type: GroupMessageType::Text,
            content: format!("body-{id}"),
            timestamp: 0,
            reply_to: None,
            reply_count: 0,
            mentions: vec![],
            edited_at: None,
        }
    }

    /// Deleting a room's history must remove the key, not empty the list.
    ///
    /// Nothing deleted it at all before: `delete_node` removed the node and
    /// left `citadel_workspace.group_messages.<id>` behind, unreachable because
    /// the node that named it was gone. Every message in every deleted room was
    /// retained for the life of the backend.
    #[tokio::test]
    async fn deleting_a_group_takes_its_messages_with_it() {
        let mgr = fresh();
        mgr.store_group_message(msg("m1", "doomed")).await.unwrap();
        mgr.store_group_message(msg("m2", "doomed")).await.unwrap();
        mgr.store_group_message(msg("m3", "kept")).await.unwrap();

        // Precondition, so a later refactor that stops storing cannot make this
        // pass by finding nothing to delete.
        assert_eq!(mgr.get_group_messages("doomed").await.unwrap().len(), 2);

        mgr.delete_all_group_messages("doomed").await.unwrap();

        assert!(
            mgr.get_group_messages("doomed").await.unwrap().is_empty(),
            "a deleted room's messages must not survive it"
        );
        assert_eq!(
            mgr.get_group_messages("kept").await.unwrap().len(),
            1,
            "and only that room's -- deletion must not reach a sibling"
        );
    }

    /// 50 concurrent `store_group_message` calls into the same group
    /// must all land — the pre-mutex implementation lost messages
    /// because the load-modify-save sequences interleaved and the
    /// last-writer-wins saves clobbered earlier inserts.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_stores_all_persist() {
        let mgr = fresh();
        let n = 50;
        let handles: Vec<_> = (0..n)
            .map(|i| {
                let mgr = Arc::clone(&mgr);
                tokio::spawn(async move {
                    mgr.store_group_message(msg(&format!("m{i}"), "g1"))
                        .await
                        .expect("store ok");
                })
            })
            .collect();
        for h in handles {
            h.await.expect("task ok");
        }

        let stored = mgr.get_group_messages("g1").await.expect("get ok");
        assert_eq!(
            stored.len(),
            n,
            "every concurrent store must land — mutex regression if not"
        );
        let mut ids: Vec<&str> = stored.iter().map(|m| m.id.as_str()).collect();
        ids.sort();
        let mut expected: Vec<String> = (0..n).map(|i| format!("m{i}")).collect();
        expected.sort();
        assert_eq!(ids, expected.iter().map(|s| s.as_str()).collect::<Vec<_>>());
    }

    /// Concurrent edits to *different* messages in the same group
    /// must all be visible after the storm. Pre-mutex, two edits
    /// would each load the same prior list, apply one mutation, and
    /// save — losing the other's edit.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_updates_dont_lose_edits() {
        let mgr = fresh();
        // Seed two messages.
        mgr.store_group_message(msg("a", "g")).await.unwrap();
        mgr.store_group_message(msg("b", "g")).await.unwrap();

        let m1 = Arc::clone(&mgr);
        let m2 = Arc::clone(&mgr);
        let (r1, r2) = tokio::join!(
            tokio::spawn(async move {
                m1.update_group_message("g", "a", "edit-a".into(), 100)
                    .await
            }),
            tokio::spawn(async move {
                m2.update_group_message("g", "b", "edit-b".into(), 100)
                    .await
            }),
        );
        r1.unwrap().unwrap();
        r2.unwrap().unwrap();

        let stored = mgr.get_group_messages("g").await.unwrap();
        let by_id: HashMap<&str, &GroupMessage> =
            stored.iter().map(|m| (m.id.as_str(), m)).collect();
        assert_eq!(by_id.get("a").unwrap().content, "edit-a");
        assert_eq!(by_id.get("b").unwrap().content, "edit-b");
    }
}

#[cfg(test)]
mod workspace_concurrency_tests {
    //! Regression tests for `workspace_mutex`.
    //!
    //! A `Workspace` is stored and written whole, so a handler that reads one,
    //! changes a single field and writes it back races every other handler
    //! doing the same to a different field. The theme handler does exactly that
    //! with `metadata`; a concurrent member update reads the same record and
    //! whichever writes second discards the other's change.
    //!
    //! These drive the read-modify-write directly rather than through the
    //! handler, because the property under test belongs to the storage layer.
    use super::*;
    use citadel_sdk::prelude::StackedRatchet;
    use citadel_workspace_types::structs::Workspace;

    fn fresh() -> Arc<BackendTransactionManager<StackedRatchet>> {
        Arc::new(BackendTransactionManager::new())
    }

    fn workspace(id: &str) -> Workspace {
        Workspace {
            id: id.to_string(),
            name: format!("ws-{id}"),
            description: String::new(),
            owner_id: "owner".to_string(),
            members: vec![],
            offices: vec![],
            metadata: b"{}".to_vec(),
        }
    }

    /// Concurrent members-appends to ONE workspace must all survive.
    ///
    /// Each task holds `lock_workspaces` across get → modify → insert, which is
    /// the sequence the theme handler now uses. Without the lock the tasks
    /// interleave and most of the appends are overwritten.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_updates_to_one_workspace_all_persist() {
        let mgr = fresh();
        mgr.insert_workspace("ws".into(), workspace("ws"))
            .await
            .expect("seed");

        let n = 25;
        let handles: Vec<_> = (0..n)
            .map(|i| {
                let mgr = Arc::clone(&mgr);
                tokio::spawn(async move {
                    let _guard = mgr.lock_workspaces().await;
                    let mut ws = mgr
                        .get_workspace("ws")
                        .await
                        .expect("get")
                        .expect("seeded workspace exists");
                    ws.members.push(format!("member-{i}"));
                    mgr.insert_workspace("ws".into(), ws).await.expect("insert");
                })
            })
            .collect();
        for h in handles {
            h.await.expect("task ok");
        }

        let stored = mgr
            .get_workspace("ws")
            .await
            .expect("get")
            .expect("workspace still exists");
        assert_eq!(
            stored.members.len(),
            n,
            "every concurrent update must land — workspace_mutex regression if not"
        );
    }
}

#[cfg(test)]
mod node_concurrency_tests {
    //! Regression tests for `node_mutex`. The three DomainNode mutators
    //! (`insert_node`, `remove_node`, `update_node`) all share a single
    //! collection-level backend key, so the same load-modify-save race
    //! that motivated `group_msg_mutex` applies here. Without the
    //! mutex, two concurrent inserts each load the same prior map,
    //! each apply their change, and the second save overwrites the
    //! first — silently losing a node insert.
    use super::*;
    use citadel_sdk::prelude::StackedRatchet;
    use citadel_workspace_types::structs::{DomainNode, DomainPermissions, NodeEntityType};

    fn fresh() -> Arc<BackendTransactionManager<StackedRatchet>> {
        Arc::new(BackendTransactionManager::new())
    }

    fn node(id: &str) -> DomainNode {
        DomainNode {
            id: id.to_string(),
            parent_id: None,
            entity_type: NodeEntityType::Child("Office".to_string()),
            depth: 1,
            name: format!("node-{id}"),
            description: String::new(),
            owner_id: "owner".to_string(),
            members: vec![],
            children: vec![],
            mdx_content: String::new(),
            mdx_content_hash: None,
            rules: None,
            chat_enabled: false,
            chat_channel_id: None,
            default_permissions: DomainPermissions::default(),
            metadata: vec![],
            allowed_child_types: None,
            is_default: false,
            created_at: 0,
            updated_at: 0,
        }
    }

    /// 50 concurrent `insert_node` calls into the same collection
    /// must all land. The pre-mutex implementation lost roughly half
    /// because the read-modify-write cycles interleaved.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_inserts_all_persist() {
        let mgr = fresh();
        let n = 50;
        let handles: Vec<_> = (0..n)
            .map(|i| {
                let mgr = Arc::clone(&mgr);
                tokio::spawn(async move {
                    let id = format!("n{i}");
                    mgr.insert_node(id.clone(), node(&id))
                        .await
                        .expect("insert");
                })
            })
            .collect();
        for h in handles {
            h.await.expect("task ok");
        }

        let stored = mgr.get_all_nodes().await.expect("get_all_nodes");
        assert_eq!(
            stored.len(),
            n,
            "every concurrent insert must land — node_mutex regression if not"
        );
    }

    /// Concurrent insert + update on different nodes must both
    /// be visible after the storm.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_insert_and_update_dont_lose_either() {
        let mgr = fresh();
        // Seed an existing node so the update has a target.
        mgr.insert_node("a".to_string(), node("a")).await.unwrap();

        let m1 = Arc::clone(&mgr);
        let m2 = Arc::clone(&mgr);
        let (r1, r2) = tokio::join!(
            tokio::spawn(async move { m1.insert_node("b".to_string(), node("b")).await }),
            tokio::spawn(async move {
                let mut updated = node("a");
                updated.name = "renamed".to_string();
                m2.update_node("a", updated).await
            }),
        );
        r1.unwrap().unwrap();
        r2.unwrap().unwrap();

        let stored = mgr.get_all_nodes().await.unwrap();
        assert!(stored.contains_key("a"), "update target should still exist");
        assert!(
            stored.contains_key("b"),
            "concurrent insert must not be lost"
        );
        assert_eq!(stored.get("a").unwrap().name, "renamed");
    }
}

#[cfg(test)]
mod node_cache_tests {
    //! The node map is parsed once per distinct blob, and never once too few.
    //!
    //! Every group broadcast re-authorises every recipient, and each
    //! authorization calls `get_all_nodes` three times — `resolve_group_node`,
    //! `check_entity_permission`, `is_member_of_domain`. The blob they parse
    //! carries every node's `mdx_content`, so the parse is proportional to every
    //! document in the workspace, and it was paid 3*C times per message.
    //!
    //! The risk in fixing that with a cache is the opposite failure: serving a
    //! map that no longer reflects the tree, in a path that decides who may read
    //! a room. So both directions are asserted here, and the staleness direction
    //! is asserted on the value, not just on the pointer.
    use super::*;
    use citadel_sdk::prelude::StackedRatchet;
    use citadel_workspace_types::structs::NodeEntityType;

    fn fresh() -> BackendTransactionManager<StackedRatchet> {
        BackendTransactionManager::new()
    }

    fn node(id: &str, chat: Option<&str>) -> DomainNode {
        DomainNode {
            id: id.to_string(),
            parent_id: None,
            entity_type: NodeEntityType::Child("Office".to_string()),
            depth: 1,
            name: id.to_string(),
            description: String::new(),
            owner_id: "owner".to_string(),
            members: vec![],
            children: vec![],
            mdx_content: String::new(),
            mdx_content_hash: None,
            rules: None,
            chat_enabled: chat.is_some(),
            chat_channel_id: chat.map(str::to_string),
            default_permissions: citadel_workspace_types::structs::DomainPermissions::default(),
            metadata: vec![],
            allowed_child_types: None,
            is_default: false,
            created_at: 0,
            updated_at: 0,
        }
    }

    fn map(nodes: Vec<DomainNode>) -> HashMap<String, DomainNode> {
        nodes.into_iter().map(|n| (n.id.clone(), n)).collect()
    }

    #[tokio::test]
    async fn unchanged_nodes_are_parsed_once_and_shared() {
        let mgr = fresh();
        mgr.save_nodes(&map(vec![node("a", Some("chan-a"))]))
            .await
            .unwrap();

        let first = mgr.get_all_nodes_shared().await.unwrap();
        let second = mgr.get_all_nodes_shared().await.unwrap();
        let third = mgr.get_all_nodes_shared().await.unwrap();

        // Pointer equality is the assertion: the same allocation, so the same
        // single parse, which is exactly what the three authorization calls per
        // recipient were each doing for themselves.
        assert!(Arc::ptr_eq(&first, &second));
        assert!(Arc::ptr_eq(&first, &third));
    }

    #[tokio::test]
    async fn a_changed_tree_is_reparsed_not_served_from_cache() {
        let mgr = fresh();
        mgr.save_nodes(&map(vec![node("a", Some("chan-a"))]))
            .await
            .unwrap();
        let before = mgr.get_all_nodes_shared().await.unwrap();
        assert_eq!(before.len(), 1);

        mgr.save_nodes(&map(vec![
            node("a", Some("chan-a")),
            node("b", Some("chan-b")),
        ]))
        .await
        .unwrap();

        let after = mgr.get_all_nodes_shared().await.unwrap();
        assert!(
            !Arc::ptr_eq(&before, &after),
            "the cache was served after a write"
        );
        assert_eq!(
            after.len(),
            2,
            "the second node is missing from the reparse"
        );
        assert!(after.contains_key("b"));
    }

    #[tokio::test]
    async fn a_removed_node_does_not_survive_in_the_cache() {
        // The direction that matters for authorization: `resolve_group_node`
        // denies an unknown channel, and a deleted node's chat must not stay
        // resolvable. A TTL cache would fail this for the length of the TTL.
        let mgr = fresh();
        mgr.save_nodes(&map(vec![
            node("a", Some("chan-a")),
            node("b", Some("chan-b")),
        ]))
        .await
        .unwrap();
        let _warm = mgr.get_all_nodes_shared().await.unwrap();

        mgr.save_nodes(&map(vec![node("a", Some("chan-a"))]))
            .await
            .unwrap();

        let after = mgr.get_all_nodes_shared().await.unwrap();
        assert!(
            !after.contains_key("b"),
            "a deleted node was still served, so its chat channel still resolves",
        );
    }

    #[tokio::test]
    async fn a_shrinking_edit_is_still_seen() {
        // A same-length blob would defeat a length check; a different-length one
        // would defeat nothing. This covers the case a cheaper validity test
        // (length, or a count) would get wrong, since only the bytes differ in
        // content while the shape stays the same.
        let mgr = fresh();
        let mut before = node("a", Some("chan-a"));
        before.name = "xxxx".to_string();
        mgr.save_nodes(&map(vec![before])).await.unwrap();
        let _warm = mgr.get_all_nodes_shared().await.unwrap();

        let mut after = node("a", Some("chan-a"));
        after.name = "yyyy".to_string();
        mgr.save_nodes(&map(vec![after])).await.unwrap();

        let seen = mgr.get_all_nodes_shared().await.unwrap();
        assert_eq!(seen.get("a").unwrap().name, "yyyy");
    }

    #[tokio::test]
    async fn mutators_still_get_an_owned_map() {
        // `get_all_nodes` is the mutators' entry point and must keep handing back
        // something they can modify without touching what readers are sharing.
        let mgr = fresh();
        mgr.save_nodes(&map(vec![node("a", None)])).await.unwrap();
        let shared = mgr.get_all_nodes_shared().await.unwrap();

        let mut owned = mgr.get_all_nodes().await.unwrap();
        owned.insert("scratch".to_string(), node("scratch", None));

        assert_eq!(shared.len(), 1, "a mutator's edit reached the shared map");
    }
}

#[cfg(test)]
mod group_lock_tests {
    //! The message lock is per group, and there is no state to get wrong.
    //!
    //! It used to be one mutex across ALL groups, on the recorded grounds that
    //! "group message ops are infrequent compared to index ops". They are chat.
    //! And the work held under the lock is a full parse and re-serialise of the
    //! room's whole history, plus `backend_save`'s 100/200/400ms retry sleeps —
    //! so one busy room throttled sending for every room on the server.
    //!
    //! Splitting it is the easy half. The half that goes wrong is whatever holds
    //! the pieces. The first version was a map keyed by group id, pruned by
    //! `Arc::strong_count`, capped, with a fallback that shared a lock at
    //! saturation — and that fallback did not RECORD which group it had been
    //! handed to, so the next caller for the same group could mint a fresh lock
    //! and run its read-modify-write against the first. The lost update the
    //! mutex exists to prevent, restored by the code meant to bound it.
    //!
    //! Striping has no such state. A group's stripe is a pure function of its id,
    //! so the tests below are about that function and about the property it
    //! buys, not about a cache.
    use super::*;
    use citadel_sdk::prelude::StackedRatchet;

    fn fresh() -> BackendTransactionManager<StackedRatchet> {
        BackendTransactionManager::new()
    }

    /// Two group ids that land on different stripes, for the tests that need
    /// non-collision. Found rather than assumed: any fixed pair could collide.
    fn two_groups_on_different_stripes() -> (String, String) {
        let first = "room-0".to_string();
        for i in 1..1000 {
            let candidate = format!("room-{i}");
            if group_stripe(&candidate) != group_stripe(&first) {
                return (first, candidate);
            }
        }
        panic!("group_stripe put 1000 distinct ids on one stripe; it is not distributing");
    }

    #[tokio::test]
    async fn one_group_always_gets_the_same_lock() {
        // The whole point of the lock, and the property the map version lost at
        // saturation. If this ever returns distinct mutexes, two concurrent
        // sends to one room both load the prior list, both push, and the second
        // save drops the first message on the floor.
        let mgr = fresh();
        let first = mgr.group_lock("room-a");
        let second = mgr.group_lock("room-a");
        assert!(Arc::ptr_eq(&first, &second));

        // Including while one is held, and after many other groups have asked.
        let held = first.lock().await;
        for i in 0..10_000 {
            let _ = mgr.group_lock(&format!("other-{i}"));
        }
        let third = mgr.group_lock("room-a");
        assert!(
            Arc::ptr_eq(&first, &third),
            "a group's lock changed identity under load, which is how the map version failed",
        );
        drop(held);
    }

    #[tokio::test]
    async fn two_groups_can_be_written_at_once() {
        let mgr = fresh();
        let (a, b) = two_groups_on_different_stripes();
        assert!(
            !Arc::ptr_eq(&mgr.group_lock(&a), &mgr.group_lock(&b)),
            "two rooms on different stripes share a lock, so one busy room blocks the other",
        );
    }

    #[tokio::test]
    async fn the_lock_set_does_not_grow_with_the_number_of_groups() {
        // The reason for striping rather than a map: an entry per group id is an
        // unbounded collection keyed by user-supplied data.
        let mgr = fresh();
        for i in 0..50_000 {
            let _ = mgr.group_lock(&format!("room-{i}"));
        }
        assert_eq!(mgr.group_msg_mutex.len(), GROUP_LOCK_STRIPES);
    }

    #[tokio::test]
    async fn the_stripe_function_distributes() {
        // A constant stripe would satisfy every correctness test above while
        // reinstating the single global lock this replaced.
        let used: std::collections::HashSet<usize> = (0..10_000)
            .map(|i| group_stripe(&format!("room-{i}")))
            .collect();
        assert_eq!(
            used.len(),
            GROUP_LOCK_STRIPES,
            "10k ids reached only {} of {GROUP_LOCK_STRIPES} stripes",
            used.len(),
        );
    }

    #[tokio::test]
    async fn concurrent_sends_to_different_rooms_do_not_serialise() {
        // Holding one room's lock must not delay a send to a room on another
        // stripe. Asserted by completing the second while the first is held:
        // with one global mutex this deadlocks rather than failing, so the outer
        // timeout is the discriminator.
        let mgr = Arc::new(fresh());
        let (a, b) = two_groups_on_different_stripes();
        let first = mgr.group_lock(&a);
        let _held = first.lock().await;

        let mgr2 = mgr.clone();
        let second = tokio::time::timeout(std::time::Duration::from_secs(5), async move {
            let lock = mgr2.group_lock(&b);
            let _guard = lock.lock().await;
        })
        .await;

        assert!(
            second.is_ok(),
            "a send to another room waited on a lock held for {a}"
        );
    }
}
