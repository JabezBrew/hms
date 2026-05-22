CREATE UNIQUE INDEX jobs_dashboard_projection_refresh_active_idx
    ON jobs (
        kind,
        (payload ->> 'facility_id'),
        (payload ->> 'snapshot_key')
    )
    WHERE kind = 'dashboard_projection_refresh'
      AND status IN ('queued', 'running');
