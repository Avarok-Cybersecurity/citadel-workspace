//! Reading one node cloned every document in the workspace.
//!
//! `DomainNode` holds the body inline (`structs.rs`: `pub mdx_content: String`)
//! and every node lives under one backend key, so "the node map" is the whole
//! document corpus. `get_node` was:
//!
//! ```ignore
//! let nodes = self.get_all_nodes().await?;   // (*shared).clone() -- ALL of them
//! Ok(nodes.get(node_id).cloned())
//! ```
//!
//! Opening a member roster cloned megabytes of MDX to read one `members`
//! field, and dropped the rest immediately.
//!
//! Measured rather than argued: a counting allocator records bytes allocated
//! across the call. The assertion is on the SHAPE of the growth -- reading one
//! node out of a big corpus must not cost proportionally more than reading one
//! out of a small corpus. A timing test would be flaky; this is not.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use citadel_workspace_types::structs::{DomainNode, DomainPermissions, NodeEntityType};
use common::workspace_test_utils::{create_test_kernel, TEST_ADMIN_USER_ID};

struct Counting;

static ALLOCATED: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ALLOCATED.fetch_add(l.size(), Ordering::Relaxed);
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l)
    }
}

#[global_allocator]
static A: Counting = Counting;

/// Bytes allocated while `f` runs.
async fn bytes_for<F, Fut>(f: F) -> usize
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    let before = ALLOCATED.load(Ordering::Relaxed);
    f().await;
    ALLOCATED.load(Ordering::Relaxed).saturating_sub(before)
}

const BODY: usize = 4096;

async fn seed(kernel: &common::member_test_utils::GateKernel, count: usize) {
    for i in 0..count {
        let id = format!("n{i}");
        let node = DomainNode {
            id: id.clone(),
            parent_id: None,
            entity_type: NodeEntityType::Child("Office".to_string()),
            depth: 1,
            name: id.clone(),
            description: String::new(),
            owner_id: TEST_ADMIN_USER_ID.to_string(),
            members: vec![],
            children: vec![],
            mdx_content: "x".repeat(BODY),
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
        };
        kernel
            .domain_operations
            .backend_tx_manager
            .insert_node(id, node)
            .await
            .expect("seed");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 1)]
async fn get_node_does_not_pay_for_the_parsed_clone() {
    // ONE test in this binary on purpose: the counter is process-wide and
    // cargo runs tests in a binary concurrently, so a second test here would
    // measure both.
    let kernel = create_test_kernel().await;
    seed(&kernel, 200).await;

    // Warm the parse cache so neither measurement below includes the first parse.
    let _ = kernel
        .domain_operations
        .backend_tx_manager
        .get_all_nodes()
        .await;

    let one = bytes_for(|| async {
        let _ = kernel
            .domain_operations
            .backend_tx_manager
            .get_node("n0")
            .await;
    })
    .await;
    let all = bytes_for(|| async {
        let _ = kernel
            .domain_operations
            .backend_tx_manager
            .get_all_nodes()
            .await;
    })
    .await;

    // Both still pay one raw-blob fetch: `get_all_nodes_shared` re-reads the
    // backend every call and only the parse is cached (see the note in
    // transaction/mod.rs). That half is NOT fixed here. What is fixed is the
    // deep clone of every parsed DomainNode -- including every `mdx_content`
    // String -- which `get_node` used to pay to return one node and drop the
    // rest. So the assertion is relative: reading one node must cost
    // materially less than reading them all. Reverting `get_node` to
    // `get_all_nodes()` makes these two identical.
    assert!(
        one + one / 2 < all,
        "get_node allocated {one} bytes and get_all_nodes {all}; reading one node is \
         paying the same deep clone as reading all {} of them",
        200
    );

    // An allocation assertion is satisfied by a get_node that returns nothing,
    // so pin the behaviour too.
    let got = kernel
        .domain_operations
        .backend_tx_manager
        .get_node("n1")
        .await
        .expect("backend read")
        .expect("n1 exists");
    assert_eq!(got.id, "n1");
    assert_eq!(got.mdx_content.len(), BODY);
    assert!(kernel
        .domain_operations
        .backend_tx_manager
        .get_node("nope")
        .await
        .expect("backend read")
        .is_none());
}
