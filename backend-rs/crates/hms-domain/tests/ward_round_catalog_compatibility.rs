//! Static/unrun serialization controls; not proof of a historical runtime receipt.
use hms_domain::ward_rounds::WardRoundReviewedTarget;
#[test]
fn unknown_old_review_remains_absent_and_new_real_version_is_explicit() {
    let legacy = serde_json::json!({"resource_type":"lab_test","resource_id":"33333333-3333-4333-8333-333333333333","display_name":"Synthetic source","code":"S33","selected":true,"prescription":null});
    let mut review: WardRoundReviewedTarget = serde_json::from_value(legacy.clone()).unwrap();
    assert!(review.catalog_version.is_none());
    assert_eq!(
        serde_json::to_value(&review).unwrap(),
        legacy,
        "unknown is omitted rather than silently filled or reserialized as null"
    );
    review.catalog_version = Some(4);
    assert_eq!(serde_json::to_value(review).unwrap()["catalog_version"], 4);
}
