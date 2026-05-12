CREATE INDEX stock_batches_location_time_idx
    ON stock_batches (facility_id, location_id, received_at DESC, item_id);
