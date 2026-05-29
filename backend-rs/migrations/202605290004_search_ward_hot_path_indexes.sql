CREATE INDEX IF NOT EXISTS nursing_tasks_open_admission_count_idx
    ON nursing_tasks (admission_case_id)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS medication_administrations_due_count_idx
    ON medication_administrations (admission_case_id, scheduled_at)
    WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS search_documents_active_access_order_idx
    ON search_documents (
        facility_id,
        resource_type,
        permission_code,
        feature_key,
        source_updated_at DESC,
        id
    )
    WHERE is_active = true;
