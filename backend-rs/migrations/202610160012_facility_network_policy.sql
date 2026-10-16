-- No implicit onsite ranges. An operator must explicitly bootstrap each facility.
CREATE TABLE facility_network_policies (
 facility_id uuid PRIMARY KEY REFERENCES facilities(id) ON DELETE RESTRICT,
 version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 onsite_cidrs cidr[] NOT NULL DEFAULT '{}',
 offsite_mode text NOT NULL DEFAULT 'readonly' CHECK(offsite_mode IN ('readonly','deny','fresh_reauth')),
 updated_at timestamptz,
 updated_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 CHECK((version=0 AND cardinality(onsite_cidrs)=0) OR (version>0 AND cardinality(onsite_cidrs) BETWEEN 1 AND 64)),
 CHECK(array_position(onsite_cidrs,NULL) IS NULL),
 CHECK(NOT('0.0.0.0/0'::cidr=ANY(onsite_cidrs) OR '::/0'::cidr=ANY(onsite_cidrs)))
);
CREATE TABLE facility_network_policy_versions (
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 version bigint NOT NULL CHECK(version>0),
 onsite_cidrs cidr[] NOT NULL CHECK(cardinality(onsite_cidrs) BETWEEN 1 AND 64),
 offsite_mode text NOT NULL CHECK(offsite_mode IN ('readonly','deny','fresh_reauth')),
 updated_at timestamptz NOT NULL,
 updated_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 source_kind text NOT NULL CHECK(source_kind IN ('admin','operator')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
 PRIMARY KEY(facility_id,version),
 CHECK((source_kind='operator')=(updated_by_user_id IS NULL))
);
CREATE TABLE facility_network_policy_commands (
 facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
 request_key_hash bytea NOT NULL CHECK(octet_length(request_key_hash)=32),
 actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
 source_kind text NOT NULL CHECK(source_kind IN ('admin','operator')),
 payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
 result_version bigint,
 PRIMARY KEY(facility_id,request_key_hash),
 FOREIGN KEY(facility_id,result_version) REFERENCES facility_network_policy_versions(facility_id,version),
 CHECK((source_kind='operator')=(actor_user_id IS NULL))
);
