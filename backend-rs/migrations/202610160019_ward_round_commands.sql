-- Original command results contain clinical evidence and remain within protected Chronicle reads.
ALTER TABLE ward_round_actions ADD COLUMN draft_position integer CHECK (draft_position>=0);
ALTER TABLE ward_round_actions ADD COLUMN reviewed_targets jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reviewed_targets)='array');
CREATE TABLE ward_round_commands (
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    request_key_hash bytea NOT NULL CHECK (octet_length(request_key_hash)=32),
    actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    ward_round_id uuid NOT NULL REFERENCES ward_rounds(id) ON DELETE RESTRICT,
    command_type text NOT NULL CHECK (command_type IN ('saved_draft','committed')),
    payload_digest bytea NOT NULL CHECK (octet_length(payload_digest)=32),
    receipt jsonb NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (facility_id,request_key_hash)
);
CREATE INDEX ward_round_commands_patient_idx ON ward_round_commands(facility_id,patient_id,actor_user_id,recorded_at,request_key_hash) INCLUDE (ward_round_id);

CREATE FUNCTION protect_ward_round_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ward_round_command_immutable';
END;
$$;
CREATE TRIGGER ward_round_commands_immutable BEFORE UPDATE OR DELETE ON ward_round_commands
    FOR EACH ROW EXECUTE FUNCTION protect_ward_round_command();
