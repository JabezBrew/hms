CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE inventory_items
    ADD COLUMN IF NOT EXISTS primary_supplier_id uuid REFERENCES inventory_suppliers(id) ON DELETE SET NULL;

WITH ranked_suppliers AS (
    SELECT id,
           facility_id,
           row_number() OVER (PARTITION BY facility_id ORDER BY code ASC, id ASC) AS rn
    FROM inventory_suppliers
    WHERE is_active = TRUE
)
UPDATE inventory_items
SET primary_supplier_id = ranked_suppliers.id
FROM ranked_suppliers
WHERE ranked_suppliers.facility_id = inventory_items.facility_id
  AND ranked_suppliers.rn = 1
  AND inventory_items.primary_supplier_id IS NULL;

CREATE INDEX IF NOT EXISTS inventory_items_facility_supplier_updated_idx
    ON inventory_items (facility_id, primary_supplier_id, updated_at DESC, id);

CREATE INDEX IF NOT EXISTS inventory_items_name_lower_search_trgm_idx
    ON inventory_items USING gin ((lower(name)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS inventory_items_code_lower_search_trgm_idx
    ON inventory_items USING gin ((lower(code)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS stock_batches_positive_item_location_idx
    ON stock_batches (facility_id, item_id, location_id, expires_on, id)
    WHERE quantity_on_hand > 0;

CREATE INDEX IF NOT EXISTS storage_locations_name_search_trgm_idx
    ON storage_locations USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS storage_locations_code_search_trgm_idx
    ON storage_locations USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS purchase_orders_supplier_name_search_trgm_idx
    ON purchase_orders USING gin (supplier_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS inventory_suppliers_name_search_trgm_idx
    ON inventory_suppliers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS inventory_suppliers_code_search_trgm_idx
    ON inventory_suppliers USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS inventory_suppliers_contact_name_search_trgm_idx
    ON inventory_suppliers USING gin (contact_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS lab_tests_name_search_trgm_idx
    ON lab_tests USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS lab_tests_code_search_trgm_idx
    ON lab_tests USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS lab_panels_name_search_trgm_idx
    ON lab_panels USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS lab_panels_code_search_trgm_idx
    ON lab_panels USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS lab_orders_facility_patient_status_idx
    ON lab_orders (facility_id, patient_id, status, ordered_at DESC, id);

CREATE INDEX IF NOT EXISTS lab_results_facility_patient_verified_idx
    ON lab_results (facility_id, patient_id, verified_at, entered_at DESC, id);

CREATE INDEX IF NOT EXISTS cash_sessions_facility_status_opened_idx
    ON cash_sessions (facility_id, status, opened_at DESC, id);

CREATE INDEX IF NOT EXISTS cash_sessions_facility_variance_opened_idx
    ON cash_sessions (facility_id, variance_minor, opened_at DESC, id);

CREATE INDEX IF NOT EXISTS cash_drawers_name_search_trgm_idx
    ON cash_drawers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS cash_drawers_code_search_trgm_idx
    ON cash_drawers USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_display_name_search_trgm_idx
    ON users USING gin (display_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS staff_profiles_employee_id_search_trgm_idx
    ON staff_profiles USING gin (employee_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS staff_profiles_department_search_trgm_idx
    ON staff_profiles USING gin (department gin_trgm_ops);

CREATE INDEX IF NOT EXISTS staff_profiles_position_search_trgm_idx
    ON staff_profiles USING gin (position gin_trgm_ops);

CREATE INDEX IF NOT EXISTS appointment_types_name_search_trgm_idx
    ON appointment_types USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS appointment_types_code_search_trgm_idx
    ON appointment_types USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS appointments_facility_status_starts_idx
    ON appointments (facility_id, status, starts_at ASC, id);

CREATE INDEX IF NOT EXISTS appointments_facility_clinic_starts_idx
    ON appointments (facility_id, clinic_id, starts_at ASC, id);

CREATE INDEX IF NOT EXISTS appointments_facility_practitioner_starts_idx
    ON appointments (facility_id, practitioner_user_id, starts_at ASC, id);

CREATE INDEX IF NOT EXISTS encounters_facility_status_started_idx
    ON encounters (facility_id, status, started_at ASC, id);

CREATE INDEX IF NOT EXISTS encounters_facility_type_started_idx
    ON encounters (facility_id, encounter_type, started_at ASC, id);

CREATE INDEX IF NOT EXISTS care_team_assignments_encounter_active_idx
    ON encounter_care_team_assignments (encounter_id, is_active, user_id);

CREATE INDEX IF NOT EXISTS controlled_register_facility_item_location_time_idx
    ON controlled_substance_register (facility_id, item_id, location_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS controlled_register_facility_time_idx
    ON controlled_substance_register (facility_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS controlled_register_facility_location_time_idx
    ON controlled_substance_register (facility_id, location_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS controlled_register_facility_count_idx
    ON controlled_substance_register (facility_id, item_id, location_id, created_at DESC)
    WHERE movement_type = 'count';

CREATE INDEX IF NOT EXISTS controlled_register_facility_discrepancy_idx
    ON controlled_substance_register (facility_id, item_id, location_id)
    WHERE movement_type = 'count' AND quantity_delta <> 0;

CREATE INDEX IF NOT EXISTS ward_board_admission_facility_status_admitted_idx
    ON admission_cases (facility_id, status, admitted_at ASC, id);

CREATE INDEX IF NOT EXISTS nursing_alerts_open_admission_count_idx
    ON nursing_alerts (admission_case_id)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS nursing_alerts_open_critical_admission_idx
    ON nursing_alerts (admission_case_id)
    WHERE status = 'open' AND severity IN ('critical', 'high');

CREATE INDEX IF NOT EXISTS beds_bed_code_search_trgm_idx
    ON beds USING gin (bed_code gin_trgm_ops);
