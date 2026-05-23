use hms_db::ops::{
    pg_stat_statements_availability_for_sqlstate, PgStatStatementAggregate,
    PgStatStatementsAvailability, PgStatStatementsSnapshot, PG_STAT_STATEMENTS_AGGREGATE_SQL,
};

#[test]
fn ops_pg_stat_projection_never_selects_query_text() {
    let select_list = PG_STAT_STATEMENTS_AGGREGATE_SQL
        .split_once("FROM pg_stat_statements")
        .expect("query reads from pg_stat_statements")
        .0;
    let projected_columns: Vec<String> = select_list
        .trim_start()
        .trim_start_matches("SELECT")
        .trim()
        .split(',')
        .map(|column| {
            column
                .split_whitespace()
                .next()
                .unwrap_or_default()
                .to_owned()
        })
        .collect();

    assert_eq!(
        projected_columns,
        vec![
            "queryid",
            "calls",
            "total_exec_time",
            "mean_exec_time",
            "rows"
        ]
    );
    assert!(!projected_columns.iter().any(|column| column == "query"));
}

#[test]
fn ops_pg_stat_snapshot_serializes_only_fingerprints_and_aggregates() {
    let snapshot = PgStatStatementsSnapshot {
        availability: PgStatStatementsAvailability::Available,
        statements: vec![PgStatStatementAggregate {
            fingerprint_id: "pgq_safe_fingerprint".to_owned(),
            calls: 12,
            total_exec_ms: 345.5,
            mean_exec_ms: 28.8,
            rows: 42,
        }],
    };

    let serialized = serde_json::to_string(&snapshot).expect("snapshot serializes");
    assert!(serialized.contains("pgq_safe_fingerprint"));
    assert!(serialized.contains("total_exec_ms"));
    assert!(serialized.contains("mean_exec_ms"));
    assert!(!serialized.contains("SELECT"));
    assert!(!serialized.contains("FROM patients"));
    assert!(!serialized.contains("queryid"));
    assert!(!serialized.contains("\"query\""));
}

#[test]
fn ops_pg_stat_maps_missing_extension_and_permission_states_safely() {
    assert_eq!(
        pg_stat_statements_availability_for_sqlstate(Some("42P01")),
        PgStatStatementsAvailability::ExtensionUnavailable
    );
    assert_eq!(
        pg_stat_statements_availability_for_sqlstate(Some("55000")),
        PgStatStatementsAvailability::ExtensionUnavailable
    );
    assert_eq!(
        pg_stat_statements_availability_for_sqlstate(Some("42501")),
        PgStatStatementsAvailability::PermissionDenied
    );
    assert_eq!(
        pg_stat_statements_availability_for_sqlstate(None),
        PgStatStatementsAvailability::ExtensionUnavailable
    );

    let not_configured = PgStatStatementsAvailability::NotConfigured;
    assert_eq!(not_configured.as_str(), "not_configured");
}
