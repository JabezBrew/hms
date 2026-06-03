ALTER TABLE lab_tests
    ADD COLUMN IF NOT EXISTS category text,
    ADD COLUMN IF NOT EXISTS is_system_default boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_facility_modified boolean NOT NULL DEFAULT false;

UPDATE lab_tests
SET category = CASE
        WHEN code IN ('FBC', 'GS', 'COAG') THEN 'hematology'
        WHEN code IN ('RBG', 'FBS', 'HBA1C', 'U&E', 'CRE', 'LFT', 'LIPID', 'TSH', 'CRP') THEN 'chemistry'
        WHEN code IN ('MP', 'WIDAL', 'AFB') THEN 'microbiology'
        WHEN code IN ('HBS', 'HIV') THEN 'serology'
        WHEN code = 'URE' THEN 'urinalysis'
        ELSE COALESCE(category, 'other')
    END,
    is_system_default = TRUE
WHERE category IS NULL
   OR code IN (
       'FBC', 'GS', 'COAG', 'RBG', 'FBS', 'HBA1C', 'U&E', 'CRE', 'LFT', 'LIPID',
       'TSH', 'CRP', 'MP', 'WIDAL', 'AFB', 'HBS', 'HIV', 'URE'
   );

ALTER TABLE lab_tests
    ALTER COLUMN category SET DEFAULT 'other';

ALTER TABLE lab_panels
    ADD COLUMN IF NOT EXISTS is_system_default boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_facility_modified boolean NOT NULL DEFAULT false;

UPDATE lab_panels
SET is_system_default = TRUE
WHERE code IN ('BASIC_HEME');

ALTER TABLE lab_results
    ADD COLUMN IF NOT EXISTS is_critical boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS lab_tests_facility_catalog_filter_idx
    ON lab_tests (
        facility_id,
        is_active,
        category,
        is_system_default,
        is_facility_modified,
        created_at DESC,
        id
    );

CREATE INDEX IF NOT EXISTS lab_tests_search_trgm_idx
    ON lab_tests USING gin (lower(code || ' ' || name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS lab_panels_facility_catalog_filter_idx
    ON lab_panels (
        facility_id,
        is_active,
        is_system_default,
        is_facility_modified,
        created_at DESC,
        id
    );

CREATE INDEX IF NOT EXISTS lab_panels_search_trgm_idx
    ON lab_panels USING gin (lower(code || ' ' || name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS lab_orders_facility_status_time_idx
    ON lab_orders (facility_id, status, ordered_at DESC, id);

CREATE INDEX IF NOT EXISTS lab_orders_facility_priority_time_idx
    ON lab_orders (facility_id, priority, ordered_at DESC, id);

CREATE INDEX IF NOT EXISTS lab_orders_facility_provider_time_idx
    ON lab_orders (facility_id, ordered_by_user_id, ordered_at DESC, id);

CREATE INDEX IF NOT EXISTS lab_results_facility_status_time_idx
    ON lab_results (facility_id, status, entered_at DESC, id);

CREATE INDEX IF NOT EXISTS lab_results_facility_verified_time_idx
    ON lab_results (facility_id, verified_at, entered_at DESC, id);

CREATE INDEX IF NOT EXISTS lab_results_facility_critical_time_idx
    ON lab_results (facility_id, is_critical, entered_at DESC, id);
