use super::*;
#[tokio::test]
async fn no_visit_rejects_ignored_nested_fields_before_any_start_effect_and_valid_wire_still_starts(
) {
    let f = F::new().await;
    let referral = f.referral().await;
    let context = f.context(referral, NO_VISIT).await;
    let before = f.counts().await;
    let marker = "SYNTHETIC_IGNORED_VISIT_MARKER";
    let mut source = no_visit();
    source["visit"][marker] = json!(true);
    let response = f.start(referral, f.input(&context, source)).await;
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 8192).await.unwrap();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    let echo = bytes
        .windows(marker.len())
        .any(|window| window == marker.as_bytes());
    let unchanged = f.counts().await == before;
    let valid_referral = f.referral().await;
    let valid_context = f.context(valid_referral, NO_VISIT).await;
    let positive = f
        .start(valid_referral, f.input(&valid_context, no_visit()))
        .await;
    let positive_status = positive.status();
    let saved = ok(positive).await;
    println!("consultation no_visit strict nested input: rejected_status={}, positive_status={}, marker_echo={}, effects_unchanged={}",status.as_u16(),positive_status.as_u16(),echo,unchanged);
    assert_eq!(positive_status, StatusCode::OK);
    assert!(saved["link"]["encounter_id"].is_string());
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(value["error"]["code"], "invalid_referral_consultation");
    assert!(!echo);
    assert!(unchanged);
}
