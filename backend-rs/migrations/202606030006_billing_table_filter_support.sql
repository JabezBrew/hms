CREATE INDEX IF NOT EXISTS invoices_facility_status_issued_idx
    ON invoices (facility_id, status, issued_at DESC, id);

CREATE INDEX IF NOT EXISTS invoices_number_search_trgm_idx
    ON invoices USING gin (lower(invoice_number) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS payments_facility_status_paid_idx
    ON payments (facility_id, status, paid_at DESC, id);

CREATE INDEX IF NOT EXISTS payments_facility_method_paid_idx
    ON payments (facility_id, method, paid_at DESC, id);

CREATE INDEX IF NOT EXISTS payments_receipt_search_trgm_idx
    ON payments USING gin (lower(receipt_number) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS nhis_claims_facility_status_created_idx
    ON nhis_claims (facility_id, status, created_at DESC, id);

CREATE INDEX IF NOT EXISTS nhis_claims_number_search_trgm_idx
    ON nhis_claims USING gin (lower(claim_number) gin_trgm_ops);
