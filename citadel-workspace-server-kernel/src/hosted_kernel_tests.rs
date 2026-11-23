//! A hosted kernel meters apps into the meter its host passed (the tenant Durable Object's
//! billing period), not the native server's `CountingMeter`, and the kernel the host is handed is
//! the one that does.

use crate::config::ServerConfig;
use crate::hosted_kernel::hosted_kernel;
use crate::kernel::apps::usage_meter::{CountingMeter, Usage, UsageMeter};
use crate::kernel::async_kernel::AsyncWorkspaceServerKernel;
use crate::kernel::telemetry::HostedTelemetry;
use citadel_sdk::prelude::{BackendType, StackedRatchet};
use parking_lot::Mutex;
use std::sync::Arc;

/// Every use the kernel reported, as it reported it.
#[derive(Default)]
struct RecordingMeter(Mutex<Vec<(Option<u64>, Usage, u64)>>);

impl UsageMeter for RecordingMeter {
    fn add(&self, cid: Option<u64>, usage: Usage, bytes: u64) {
        self.0.lock().push((cid, usage, bytes));
    }
}

/// The shipped kernel.toml as a hosted tenant's would be: what the native server reads from it
/// that a host supplies instead (sign-in, STUN, path policy) is removed, and the seeded content
/// directory, which is relative to that file, is not read.
fn hosted_config() -> ServerConfig {
    let mut config: ServerConfig =
        toml::from_str(include_str!("../../docker/workspace-server/kernel.toml"))
            .expect("the shipped kernel.toml parses");
    config.sign_in = None;
    config.stun_servers = None;
    config.path_policy = None;
    config.content_base_dir = None;
    config.workspace_master_password = "hosted-kernel-test".to_string();
    if let Some(identity) = config.identity.as_mut() {
        identity.server_key_file = None;
    }
    config
}

/// The host's identity for `config`: a fixed test seed (never a real key), as a Durable Object
/// would hand over the one it keeps.
fn identity(config: &ServerConfig) -> Arc<crate::kernel::server_identity::ServerIdentity> {
    Arc::new(
        crate::kernel::server_identity::hosted_identity(config.identity.as_ref(), &[0x42; 32])
            .expect("the shipped [identity], hosted"),
    )
}

type Slot = Arc<Mutex<Option<AsyncWorkspaceServerKernel<StackedRatchet>>>>;

async fn hosted_with(meter: Arc<dyn UsageMeter>) -> Slot {
    let slot: Slot = Arc::default();
    let handed = slot.clone();
    let telemetry = HostedTelemetry {
        support_grants: None,
        turn_usage: None,
        usage_meter: meter,
        kernel_ready: Box::new(move |kernel| *handed.lock() = Some(kernel)),
    };
    let config = hosted_config();
    hosted_kernel(
        &config,
        &BackendType::InMemory,
        None,
        None,
        telemetry,
        None,
        None,
        None,
        None,
        identity(&config),
        None,
    )
    .await
    .expect("the hosted kernel builds");
    slot
}

fn meter_through(slot: &Slot, usage: Usage, bytes: u64) {
    let kernel = slot.lock();
    let kernel = kernel.as_ref().expect("the host was handed the kernel");
    kernel.meter(Some(7), usage, bytes);
}

#[tokio::test]
async fn a_hosted_kernel_meters_into_the_host_s_meter() {
    let meter = Arc::new(RecordingMeter::default());
    let slot = hosted_with(meter.clone()).await;
    meter_through(&slot, Usage::RelayIhttp, 42);
    meter_through(&slot, Usage::EgressIn, 5);
    assert_eq!(
        *meter.0.lock(),
        vec![
            (Some(7), Usage::RelayIhttp, 42),
            (Some(7), Usage::EgressIn, 5)
        ]
    );
}

#[tokio::test]
async fn a_counting_meter_passed_in_is_the_one_that_counts() {
    // The native server passes a `CountingMeter`: the kernel counts into the one it was given.
    let meter = Arc::new(CountingMeter::default());
    let slot = hosted_with(meter.clone()).await;
    meter_through(&slot, Usage::EgressIn, 9);
    assert_eq!(meter.total(Some(7), Usage::EgressIn), 9);
}

#[tokio::test]
async fn a_hosted_kernel_keeps_chat_files_only_as_large_as_its_config_says() {
    let built = |config: ServerConfig| async move {
        let telemetry = HostedTelemetry {
            support_grants: None,
            turn_usage: None,
            usage_meter: Arc::new(CountingMeter::default()),
            kernel_ready: Box::new(|_| {}),
        };
        hosted_kernel(
            &config,
            &BackendType::InMemory,
            None,
            None,
            telemetry,
            None,
            None,
            None,
            None,
            identity(&config),
            None,
        )
        .await
    };
    let kernel = built(hosted_config())
        .await
        .expect("the shipped config builds");
    assert_eq!(
        kernel.chat_attachment_limits(),
        Some(crate::kernel::chat_attachments::ChatAttachmentLimits {
            max_bytes: 25 * 1024 * 1024,
            max_files_per_node: 2048,
        })
    );

    for (unset, key) in [
        (
            (|c: &mut ServerConfig| c.chat_attachment_max_bytes = None) as fn(&mut ServerConfig),
            "chat_attachment_max_bytes",
        ),
        (
            |c: &mut ServerConfig| c.chat_attachment_max_files_per_node = None,
            "chat_attachment_max_files_per_node",
        ),
    ] {
        let mut unsaid = hosted_config();
        unset(&mut unsaid);
        let error = format!("{:?}", built(unsaid).await.err().expect("built without it"));
        assert!(error.contains(key), "{error}");
    }
}
