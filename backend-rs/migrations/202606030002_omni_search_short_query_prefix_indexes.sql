CREATE INDEX IF NOT EXISTS search_documents_title_prefix_idx
    ON search_documents (
        facility_id,
        resource_type,
        permission_code,
        feature_key,
        lower(title) text_pattern_ops,
        source_updated_at DESC,
        id
    )
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS search_documents_patient_code_prefix_idx
    ON search_documents (
        facility_id,
        resource_type,
        permission_code,
        feature_key,
        lower(patient_code) text_pattern_ops,
        source_updated_at DESC,
        id
    )
    WHERE is_active = true
      AND patient_code IS NOT NULL;
