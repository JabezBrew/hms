-- Distinguish source-prescription holds from independently held doses. This
-- permits future-only resume without resurrecting elapsed or clinician-held work.
ALTER TABLE medication_administrations
    ADD COLUMN prescription_held boolean NOT NULL DEFAULT false;

CREATE INDEX medication_administrations_prescription_pending_idx
    ON medication_administrations (facility_id, prescription_id, status)
    WHERE prescription_id IS NOT NULL AND status IN ('scheduled', 'held');

-- Capture timing evidence for new safety checks. Legacy courses are accepted
-- only if their coverage still fits the current prescribed start and duration.
ALTER TABLE medication_courses
    ADD COLUMN prescription_start_date date,
    ADD COLUMN prescription_duration_days integer,
    ADD COLUMN prescription_first_dose_at timestamptz;

UPDATE medication_courses c
SET prescription_start_date = p.start_date,
    prescription_duration_days = p.duration_days,
    prescription_first_dose_at = p.first_dose_at,
    status = CASE WHEN
        (p.inventory_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inventory_items i WHERE i.id = p.inventory_item_id AND i.facility_id = p.facility_id))
        OR
        (p.start_date IS NOT NULL AND c.first_dose_at < p.start_date::timestamp AT TIME ZONE 'UTC')
        OR (p.first_dose_at IS NOT NULL AND c.first_dose_at < p.first_dose_at)
        OR (p.duration_days IS NOT NULL AND
            extract(epoch FROM (c.generation_window_end -
                COALESCE(p.first_dose_at, p.start_date::timestamp AT TIME ZONE 'UTC', c.first_dose_at)))
                > p.duration_days::bigint * 86400)
        THEN 'stopped' ELSE c.status END
FROM prescriptions p
WHERE p.id = c.prescription_id AND p.facility_id = c.facility_id;

-- Existing releases did not reconcile the source status or copied regimen.
-- Retire unsafe planned work without rewriting administered/dispensing history.
UPDATE medication_administrations m
SET status = 'held',
    prescription_held = COALESCE(p.status = 'on_hold'
        AND m.patient_id = p.patient_id
        AND m.medication_name = p.medication_name AND m.dose = p.dose
        AND m.route = p.route AND m.frequency = p.frequency
        AND EXISTS (SELECT 1 FROM medication_courses c
            WHERE c.id = m.medication_course_id AND c.facility_id = m.facility_id
              AND c.prescription_id = p.id AND c.patient_id = p.patient_id
              AND c.admission_case_id = m.admission_case_id
              AND c.status IN ('active', 'on_hold')
              AND c.medication_name = p.medication_name AND c.dose = p.dose
              AND c.route = p.route AND c.frequency = p.frequency
              AND c.inventory_item_id IS NOT DISTINCT FROM p.inventory_item_id), false),
    updated_at = now()
FROM prescriptions p
WHERE p.id = m.prescription_id AND p.facility_id = m.facility_id
  AND m.status = 'scheduled'
  AND (p.status <> 'active' OR m.patient_id <> p.patient_id OR m.medication_name IS DISTINCT FROM p.medication_name
      OR m.dose IS DISTINCT FROM p.dose OR m.route IS DISTINCT FROM p.route
      OR m.frequency IS DISTINCT FROM p.frequency
      OR NOT EXISTS (SELECT 1 FROM medication_courses c
          WHERE c.id = m.medication_course_id AND c.facility_id = m.facility_id
            AND c.prescription_id = p.id AND c.patient_id = p.patient_id
              AND c.admission_case_id = m.admission_case_id
              AND c.status IN ('active', 'on_hold')
            AND c.medication_name = p.medication_name AND c.dose = p.dose
            AND c.route = p.route AND c.frequency = p.frequency
            AND c.inventory_item_id IS NOT DISTINCT FROM p.inventory_item_id));

UPDATE medication_courses c
SET status = CASE WHEN c.status = 'stopped' THEN 'stopped' WHEN p.status <> 'active' THEN p.status ELSE 'stopped' END,
    updated_at = now()
FROM prescriptions p
WHERE p.id = c.prescription_id AND p.facility_id = c.facility_id
  AND (p.status <> 'active' OR c.medication_name IS DISTINCT FROM p.medication_name
      OR c.dose IS DISTINCT FROM p.dose OR c.route IS DISTINCT FROM p.route
      OR c.frequency IS DISTINCT FROM p.frequency
      OR c.inventory_item_id IS DISTINCT FROM p.inventory_item_id);

UPDATE pharmacy_fulfillments f
SET status = 'cancelled', updated_at = now()
FROM prescriptions p
WHERE p.id = f.prescription_id AND p.facility_id = f.facility_id
  AND f.status IN ('pending', 'partially_dispensed')
  AND (p.status IN ('stopped', 'completed')
      OR EXISTS (SELECT 1 FROM medication_courses c WHERE c.id = f.medication_course_id AND c.facility_id = f.facility_id AND c.status = 'stopped')
      OR f.medication_name IS DISTINCT FROM p.medication_name OR f.dose IS DISTINCT FROM p.dose
      OR f.route IS DISTINCT FROM p.route OR f.frequency IS DISTINCT FROM p.frequency
      OR f.inventory_item_id IS DISTINCT FROM p.inventory_item_id);
