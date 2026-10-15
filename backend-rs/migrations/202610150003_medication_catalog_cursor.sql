-- Bounded clinical catalog reads use a minimal projection and never join stock.
CREATE INDEX inventory_items_prescribing_cursor_idx
    ON inventory_items (facility_id, updated_at DESC, id DESC)
    WHERE is_active AND item_type IN ('medication', 'controlled_substance');
