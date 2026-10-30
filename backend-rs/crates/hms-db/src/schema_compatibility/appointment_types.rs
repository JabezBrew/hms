//! Exact governed type/version/receipt and new-reference publication layout.
use super::{
    committed_checksum, APPOINTMENT_TYPES_BREAKING_EPOCH, STORAGE_LOCATIONS_BREAKING_EPOCH,
};
use sqlx::{Postgres, Transaction};

pub(super) async fn committed_epoch(
    tx: &mut Transaction<'_, Postgres>,
    history: bool,
    previous: i64,
) -> anyhow::Result<i64> {
    let(any,complete):(bool,bool)=sqlx::query_as(r#"
WITH relations AS (
 SELECT to_regclass('public.appointment_types') types,to_regclass('public.appointment_type_commands') commands
), required_columns AS (
 SELECT types relation,'version' name,'int8'::regtype kind,true required FROM relations
 UNION ALL SELECT types,'updated_at','timestamptz'::regtype,true FROM relations
 UNION ALL SELECT commands,name,kind::regtype,true FROM relations,
 (VALUES('facility_id','uuid'),('request_key_hash','bytea'),('actor_user_id','uuid'),('type_id','uuid'),('action','text'),('payload_digest','bytea'),('receipt','jsonb'),('recorded_at','timestamptz')) c(name,kind)
), required_triggers(relation,name,guard_function,kind,args) AS (
 VALUES
 (to_regclass('public.appointment_types'),'appointment_type_identity_lifecycle','public.appointment_type_identity_lifecycle_guard()',31,decode('','hex')),
 (to_regclass('public.appointments'),'appointment_type_appointment_reference','public.appointment_type_reference_guard()',23,convert_to('appointment_type_id','UTF8')||decode('00','hex')),
 (to_regclass('public.appointment_series'),'appointment_type_series_reference','public.appointment_type_reference_guard()',23,convert_to('service_id','UTF8')||decode('00','hex')),
 (to_regclass('public.clinic_session_appointment_types'),'appointment_type_session_allowed_reference','public.appointment_type_reference_guard()',23,convert_to('appointment_type_id','UTF8')||decode('00','hex')||convert_to('clinic_session_id','UTF8')||decode('00','hex')),
 (to_regclass('public.clinic_session_template_appointment_types'),'appointment_type_template_allowed_reference','public.appointment_type_reference_guard()',23,convert_to('appointment_type_id','UTF8')||decode('00','hex')||convert_to('clinic_session_template_id','UTF8')||decode('00','hex')),
 (to_regclass('public.clinic_sessions'),'appointment_type_session_owner_reference','public.appointment_type_session_owner_guard()',23,decode('','hex')),
 (to_regclass('public.clinic_session_templates'),'appointment_type_template_owner_reference','public.appointment_type_session_owner_guard()',23,decode('','hex')),
 (to_regclass('public.clinic_session_appointment_types'),'appointment_type_session_allowed_membership','public.appointment_type_membership_guard()',31,convert_to('clinic_session_id','UTF8')||decode('00','hex')),
 (to_regclass('public.clinic_session_template_appointment_types'),'appointment_type_template_allowed_membership','public.appointment_type_membership_guard()',31,convert_to('clinic_session_template_id','UTF8')||decode('00','hex')),
 (to_regclass('public.appointment_type_commands'),'appointment_type_command_immutable','public.appointment_type_command_immutable_guard()',31,decode('','hex'))
), required_indexes(relation,name,is_unique,keys,predicate) AS (
 VALUES
 (to_regclass('public.appointment_type_commands'),'appointment_type_commands_pkey',true,ARRAY['facility_id','request_key_hash']::text[],NULL::text),
 (to_regclass('public.appointment_type_commands'),'appointment_type_commands_type_idx',false,ARRAY['facility_id','type_id','recorded_at']::text[],NULL::text),
 (to_regclass('public.appointment_types'),'appointment_type_administration_page_idx',false,ARRAY['facility_id','created_at','id']::text[],NULL::text),
 (to_regclass('public.clinic_session_template_appointment_types'),'appointment_type_template_allowed_reference_idx',false,ARRAY['appointment_type_id','clinic_session_template_id']::text[],NULL::text),
 (to_regclass('public.clinic_session_templates'),'appointment_type_active_template_owner_idx',false,ARRAY['facility_id','owner_id']::text[],'((owner_type = ''service''::text) AND is_active)'::text)
)
SELECT commands IS NOT NULL OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=types AND attname='version' AND NOT attisdropped),
 types IS NOT NULL AND commands IS NOT NULL
 AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.appointment_type_has_future_generator(uuid,uuid,timestamptz)') AND prorettype='bool'::regtype AND provolatile='v')
 AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.appointment_type_require_active(uuid,uuid[])') AND prorettype='void'::regtype)
 AND NOT EXISTS(SELECT 1 FROM required_columns r WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=r.relation AND a.attname=r.name AND a.atttypid=r.kind AND a.attnotnull=r.required AND NOT a.attisdropped))
 AND NOT EXISTS(SELECT 1 FROM required_triggers r WHERE NOT EXISTS(SELECT 1 FROM pg_trigger g WHERE g.tgrelid=r.relation AND g.tgname=r.name AND g.tgenabled IN('O','A') AND g.tgtype=r.kind AND NOT g.tgdeferrable AND NOT g.tginitdeferred AND g.tgargs=r.args AND g.tgfoid=to_regprocedure(r.guard_function)))
 AND NOT EXISTS(SELECT 1 FROM required_indexes r WHERE NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=r.relation AND c.relname=r.name AND i.indisvalid AND i.indisready AND i.indisunique=r.is_unique AND pg_get_expr(i.indpred,i.indrelid) IS NOT DISTINCT FROM r.predicate AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality) FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE k.ordinality<=i.indnkeyatts)=r.keys))
FROM relations
    "#).fetch_one(&mut **tx).await?;
    let applied: Option<(bool, Vec<u8>)> = if history {
        sqlx::query_as("SELECT success,checksum FROM public._sqlx_migrations WHERE version=$1")
            .bind(APPOINTMENT_TYPES_BREAKING_EPOCH)
            .fetch_optional(&mut **tx)
            .await?
    } else {
        None
    };
    match (applied, any, complete) {
        (None, false, false) => Ok(previous),
        (Some((true, checksum)), true, true)
            if previous == STORAGE_LOCATIONS_BREAKING_EPOCH
                && committed_checksum(APPOINTMENT_TYPES_BREAKING_EPOCH, &checksum) =>
        {
            Ok(APPOINTMENT_TYPES_BREAKING_EPOCH)
        }
        _ => anyhow::bail!("Database schema compatibility could not be confirmed."),
    }
}
