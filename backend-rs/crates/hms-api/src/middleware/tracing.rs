pub fn init_tracing() {
    hms_observability::init_json_tracing("hms_api=info");
}
