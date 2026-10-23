//! What each uploaded entry must be, with no I/O: a metric entry carries its measurement and a
//! log line carries none, so an admin never reads a "metric" with nothing in it, or a log line
//! whose level hides a payload the filters cannot see.

use citadel_workspace_types::telemetry::{TelemetryEntry, TelemetryLevel};

pub(crate) fn validate_entries(entries: &[TelemetryEntry]) -> Result<(), String> {
    for (index, entry) in entries.iter().enumerate() {
        let is_metric = entry.level == TelemetryLevel::Metric;
        if is_metric != entry.metric.is_some() {
            return Err(format!(
                "Telemetry entry {index}: a metric entry must carry its metric, and a log line none"
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use citadel_workspace_types::telemetry_metric::{
        NatClassReport, NatTranslation, PathReport, PathTaken, TelemetryMetric,
    };

    fn nat() -> NatClassReport {
        NatClassReport {
            ip_translation: NatTranslation::Constant,
            port_translation: NatTranslation::Identity,
            ipv6_enabled: false,
        }
    }

    fn entry(level: TelemetryLevel, metric: bool) -> TelemetryEntry {
        TelemetryEntry {
            time_ms: 1,
            level,
            target: "citadel::path".into(),
            message: "path report".into(),
            peer_cid: Some(9),
            metric: metric.then(|| {
                TelemetryMetric::PathReport(PathReport {
                    attempt: 1,
                    plan: "DirectThenTurn".into(),
                    path: PathTaken::Direct,
                    relayed_both: false,
                    time_to_connect_ms: Some(120),
                    stages: Vec::new(),
                    local_nat: nat(),
                    peer_nat: nat(),
                })
            }),
        }
    }

    #[test]
    fn metrics_carry_a_metric_and_log_lines_carry_none() {
        assert!(validate_entries(&[entry(TelemetryLevel::Metric, true)]).is_ok());
        assert!(validate_entries(&[entry(TelemetryLevel::Warn, false)]).is_ok());
        assert!(validate_entries(&[entry(TelemetryLevel::Metric, false)]).is_err());
        assert!(validate_entries(&[entry(TelemetryLevel::Error, true)]).is_err());
    }

    #[test]
    fn the_refusal_names_the_entry() {
        let batch = [
            entry(TelemetryLevel::Warn, false),
            entry(TelemetryLevel::Metric, false),
        ];
        assert!(validate_entries(&batch).unwrap_err().contains("entry 1"));
    }
}
