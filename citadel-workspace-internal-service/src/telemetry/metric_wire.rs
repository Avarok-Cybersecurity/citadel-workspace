//! The agent's metrics as the workspace protocol carries them (citadel-workspace-types
//! `telemetry_metric`), field for field.

use citadel_internal_service::telemetry::{
    PathReport as AgentPathReport, TelemetryMetric as AgentMetric,
};
use citadel_sdk::prelude::{IpTranslationClass, NatClass, P2pPath, PortTranslationClass};
use citadel_workspace_types::telemetry_metric::{
    NatClassReport, NatTranslation, PathReport, PathStageReport, PathTaken, TelemetryMetric,
};

pub(super) fn wire_metric(metric: AgentMetric) -> TelemetryMetric {
    match metric {
        AgentMetric::PathReport(report) => TelemetryMetric::PathReport(wire_path_report(report)),
    }
}

fn wire_path_report(report: AgentPathReport) -> PathReport {
    PathReport {
        attempt: report.attempt,
        plan: report.plan,
        path: match report.path {
            P2pPath::Direct => PathTaken::Direct,
            P2pPath::Turn => PathTaken::Turn,
            P2pPath::ServerRelay => PathTaken::ServerRelay,
        },
        relayed_both: report.relayed_both,
        time_to_connect_ms: report.time_to_connect_ms,
        stages: report
            .stages
            .into_iter()
            .map(|s| PathStageReport {
                stage: s.stage,
                failure: s.failure,
                elapsed_ms: s.elapsed_ms,
            })
            .collect(),
        local_nat: wire_nat(report.local_nat),
        peer_nat: wire_nat(report.peer_nat),
    }
}

fn wire_nat(nat: NatClass) -> NatClassReport {
    NatClassReport {
        ip_translation: match nat.ip_translation {
            IpTranslationClass::Identity => NatTranslation::Identity,
            IpTranslationClass::Constant => NatTranslation::Constant,
            IpTranslationClass::DeltaIndependentOffset => NatTranslation::DeltaIndependentOffset,
            IpTranslationClass::Unpredictable => NatTranslation::Unpredictable,
        },
        port_translation: match nat.port_translation {
            PortTranslationClass::Identity => NatTranslation::Identity,
            PortTranslationClass::DeltaConstantOffset => NatTranslation::DeltaConstantOffset,
            PortTranslationClass::DeltaIndependentOffset => NatTranslation::DeltaIndependentOffset,
            PortTranslationClass::Unpredictable => NatTranslation::Unpredictable,
        },
        ipv6_enabled: nat.ipv6_enabled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use citadel_internal_service::telemetry::StageReport;

    fn nat(ip: IpTranslationClass, port: PortTranslationClass) -> NatClass {
        NatClass {
            ip_translation: ip,
            port_translation: port,
            ipv6_enabled: true,
        }
    }

    #[test]
    fn a_path_report_crosses_field_for_field() {
        let agent = AgentMetric::PathReport(AgentPathReport {
            attempt: 3,
            plan: "DirectThenTurn".into(),
            path: P2pPath::Turn,
            relayed_both: true,
            time_to_connect_ms: Some(1_200),
            stages: vec![StageReport {
                stage: "Direct".into(),
                failure: Some("PunchFailed".into()),
                elapsed_ms: 800,
            }],
            local_nat: nat(IpTranslationClass::Constant, PortTranslationClass::Identity),
            peer_nat: nat(
                IpTranslationClass::Unpredictable,
                PortTranslationClass::DeltaConstantOffset,
            ),
        });
        let TelemetryMetric::PathReport(wire) = wire_metric(agent);
        assert_eq!(wire.attempt, 3);
        assert_eq!(wire.plan, "DirectThenTurn");
        assert_eq!(wire.path, PathTaken::Turn);
        assert!(wire.relayed_both);
        assert_eq!(wire.time_to_connect_ms, Some(1_200));
        assert_eq!(
            wire.stages,
            vec![PathStageReport {
                stage: "Direct".into(),
                failure: Some("PunchFailed".into()),
                elapsed_ms: 800,
            }]
        );
        assert_eq!(wire.local_nat.ip_translation, NatTranslation::Constant);
        assert_eq!(wire.local_nat.port_translation, NatTranslation::Identity);
        assert_eq!(wire.peer_nat.ip_translation, NatTranslation::Unpredictable);
        assert_eq!(
            wire.peer_nat.port_translation,
            NatTranslation::DeltaConstantOffset
        );
        assert!(wire.peer_nat.ipv6_enabled);
    }
}
