-- Nullable legacy basis is deliberately unknown. No textual dose arithmetic,
-- inferred one-unit policy, historical stock quantity or outcome rewrite.
ALTER TABLE prescriptions ADD COLUMN scheduled_stock_policy jsonb;
ALTER TABLE medication_courses ADD COLUMN prescription_scheduled_stock_policy jsonb;
ALTER TABLE medication_administrations
    ADD COLUMN scheduled_stock_policy jsonb,
    ADD COLUMN dispensed_stock_quantity bigint CHECK(dispensed_stock_quantity IS NULL OR dispensed_stock_quantity>0),
    ADD COLUMN dispensed_stock_unit text;
ALTER TABLE stock_movements ADD COLUMN stock_unit text;
ALTER TABLE pharmacy_dispenses ADD COLUMN stock_unit text;
ALTER TABLE stock_batches ADD COLUMN received_unit text;
ALTER TABLE prescriptions ADD CONSTRAINT prescription_scheduled_stock_policy_check CHECK (
    scheduled_stock_policy IS NULL OR (
        lower(trim(frequency))<>'prn' AND inventory_item_id IS NOT NULL
        AND jsonb_typeof(scheduled_stock_policy)='object'
        AND scheduled_stock_policy ?& ARRAY['stock_unit','stock_units_per_dose']
        AND NOT jsonb_path_exists(scheduled_stock_policy,'$.* ? (@ == null)')
        AND length(trim(scheduled_stock_policy->>'stock_unit')) BETWEEN 1 AND 100
        AND (scheduled_stock_policy->>'stock_units_per_dose')::bigint BETWEEN 1 AND 9007199254740991
    )
);
-- New supplied-dose evidence is paired; old supplied rows remain unknown.
ALTER TABLE medication_administrations ADD CONSTRAINT medication_dispensed_stock_basis_check CHECK (
    (dispensed_stock_quantity IS NULL AND dispensed_stock_unit IS NULL)
    OR (is_dispensed AND dispensed_stock_quantity IS NOT NULL AND dispensed_stock_unit IS NOT NULL
        AND dispensed_stock_quantity>0 AND length(trim(dispensed_stock_unit)) BETWEEN 1 AND 100)
);

-- The unit guard must remain bounded by indexed item history probes.
CREATE INDEX stock_movements_item_unit_history_idx ON stock_movements(facility_id,item_id);
CREATE INDEX pharmacy_dispenses_item_unit_history_idx ON pharmacy_dispenses(facility_id,item_id);
