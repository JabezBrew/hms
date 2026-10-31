//! Exact governed catalog and retained publication layout for breaking epoch030.
use super::{committed_checksum, APPOINTMENT_TYPES_BREAKING_EPOCH, INVENTORY_ITEMS_BREAKING_EPOCH};
use sqlx::{Postgres, Transaction};
pub(super) async fn committed_epoch(
    tx: &mut Transaction<'_, Postgres>,
    history: bool,
    previous: i64,
) -> anyhow::Result<i64> {
    let(any,complete):(bool,bool)=sqlx::query_as(r#"
 WITH relations AS(SELECT to_regclass('public.inventory_items') items,to_regclass('public.inventory_item_commands') commands,to_regclass('public.inventory_item_catalog_revisions') revisions),
 required_columns(relation,name,kind,required)AS(VALUES
 (to_regclass('public.inventory_items'),'version','int8'::regtype,true),
(to_regclass('public.inventory_items'),'catalog_changed_at','timestamptz'::regtype,false),
(to_regclass('public.stock_transfers'),'requested_unit','text'::regtype,false),
(to_regclass('public.inventory_item_commands'),'facility_id','uuid'::regtype,true),
(to_regclass('public.inventory_item_commands'),'request_key_hash','bytea'::regtype,true),
(to_regclass('public.inventory_item_commands'),'actor_user_id','uuid'::regtype,true),
(to_regclass('public.inventory_item_commands'),'item_id','uuid'::regtype,true),
(to_regclass('public.inventory_item_commands'),'action','text'::regtype,true),
(to_regclass('public.inventory_item_commands'),'payload_digest','bytea'::regtype,true),
(to_regclass('public.inventory_item_commands'),'receipt','jsonb'::regtype,true),
(to_regclass('public.inventory_item_commands'),'recorded_at','timestamptz'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'id','uuid'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'facility_id','uuid'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'item_id','uuid'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'request_key_hash','bytea'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'reviewed_effective_from','date'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'recorded_at','timestamptz'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'before_code','text'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'before_name','text'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'before_unit','text'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'before_version','int8'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'after_code','text'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'after_name','text'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'after_unit','text'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'after_version','int8'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'projection_changed','bool'::regtype,true),
(to_regclass('public.inventory_item_catalog_revisions'),'reason_present','bool'::regtype,true)
 ),required_triggers(relation,name,guard_function,kind,args,deferred)AS(VALUES
 (to_regclass('public.inventory_items'),'inventory_item_identity_catalog','public.inventory_item_identity_catalog_guard()',31,decode('','hex'),false),
(to_regclass('public.inventory_item_catalog_versions'),'inventory_item_legacy_catalog_closed','public.inventory_item_legacy_catalog_closed_guard()',31,decode('','hex'),false),
(to_regclass('public.inventory_item_commands'),'inventory_item_command_immutable','public.inventory_item_command_guard()',31,decode('','hex'),false),
(to_regclass('public.inventory_item_catalog_revisions'),'inventory_item_revision_immutable','public.inventory_item_revision_guard()',31,decode('','hex'),false),
(to_regclass('public.inventory_item_commands'),'inventory_item_command_complete','public.inventory_item_command_complete_guard()',5,decode('','hex'),true),
(to_regclass('public.stock_batches'),'inventory_item_batch_reference','public.inventory_item_operational_reference_guard()',23,convert_to('item_id','UTF8')||decode('00','hex'),false),
(to_regclass('public.stock_movements'),'inventory_item_movement_reference','public.inventory_item_operational_reference_guard()',23,convert_to('item_id','UTF8')||decode('00','hex'),false),
(to_regclass('public.stock_transfers'),'inventory_item_transfer_reference','public.inventory_item_operational_reference_guard()',23,convert_to('item_id','UTF8')||decode('00','hex'),false),
(to_regclass('public.controlled_substance_register'),'inventory_item_controlled_reference','public.inventory_item_operational_reference_guard()',23,convert_to('item_id','UTF8')||decode('00','hex'),false),
(to_regclass('public.pharmacy_dispenses'),'inventory_item_dispense_reference','public.inventory_item_operational_reference_guard()',23,convert_to('item_id','UTF8')||decode('00','hex'),false),
(to_regclass('public.prescriptions'),'inventory_item_prescription_reference','public.inventory_item_operational_reference_guard()',23,convert_to('inventory_item_id','UTF8')||decode('00','hex'),false),
(to_regclass('public.medication_courses'),'inventory_item_course_reference','public.inventory_item_operational_reference_guard()',23,convert_to('inventory_item_id','UTF8')||decode('00','hex'),false),
(to_regclass('public.pharmacy_fulfillments'),'inventory_item_fulfillment_reference','public.inventory_item_operational_reference_guard()',23,convert_to('inventory_item_id','UTF8')||decode('00','hex'),false),
(to_regclass('public.inventory_standing_order_template_items'),'inventory_item_template_reference','public.inventory_item_operational_reference_guard()',23,convert_to('item_id','UTF8')||decode('00','hex'),false),
(to_regclass('public.stock_requisition_items'),'inventory_item_requisition_reference','public.inventory_item_operational_reference_guard()',23,convert_to('item_id','UTF8')||decode('00','hex'),false)
 ),required_indexes(relation,name,is_unique,keys,predicate)AS(VALUES
 (to_regclass('public.inventory_items'),'inventory_item_administration_page_idx',false,ARRAY['facility_id','created_at','id']::text[],NULL::text),
(to_regclass('public.inventory_item_catalog_versions'),'inventory_item_legacy_history_page_idx',false,ARRAY['facility_id','item_id','created_at','id']::text[],NULL::text),
(to_regclass('public.inventory_item_commands'),'inventory_item_commands_pkey',true,ARRAY['facility_id','request_key_hash']::text[],NULL::text),
(to_regclass('public.inventory_item_commands'),'inventory_item_commands_item_idx',false,ARRAY['facility_id','item_id','recorded_at']::text[],NULL::text),
(to_regclass('public.inventory_item_catalog_revisions'),'inventory_item_catalog_revisions_pkey',true,ARRAY['id']::text[],NULL::text),
(to_regclass('public.inventory_item_catalog_revisions'),'inventory_item_revision_command_unique',true,ARRAY['facility_id','request_key_hash']::text[],NULL::text),
(to_regclass('public.inventory_item_catalog_revisions'),'inventory_item_correction_history_page_idx',false,ARRAY['facility_id','item_id','recorded_at','id']::text[],NULL::text),
(to_regclass('public.stock_batches'),'inventory_item_batch_reference_idx',false,ARRAY['item_id']::text[],NULL::text),
(to_regclass('public.stock_movements'),'inventory_item_movement_reference_idx',false,ARRAY['item_id']::text[],NULL::text),
(to_regclass('public.stock_transfers'),'inventory_item_transfer_reference_idx',false,ARRAY['item_id']::text[],NULL::text),
(to_regclass('public.controlled_substance_register'),'inventory_item_controlled_reference_idx',false,ARRAY['item_id']::text[],NULL::text),
(to_regclass('public.pharmacy_dispenses'),'inventory_item_dispense_reference_idx',false,ARRAY['item_id']::text[],NULL::text),
(to_regclass('public.prescriptions'),'inventory_item_prescription_reference_idx',false,ARRAY['inventory_item_id']::text[],'(inventory_item_id IS NOT NULL)'::text),
(to_regclass('public.medication_courses'),'inventory_item_course_reference_idx',false,ARRAY['inventory_item_id']::text[],'(inventory_item_id IS NOT NULL)'::text),
(to_regclass('public.pharmacy_fulfillments'),'inventory_item_fulfillment_reference_idx',false,ARRAY['inventory_item_id']::text[],'(inventory_item_id IS NOT NULL)'::text),
(to_regclass('public.inventory_standing_order_template_items'),'inventory_item_template_reference_idx',false,ARRAY['item_id']::text[],NULL::text),
(to_regclass('public.stock_requisition_items'),'inventory_item_requisition_reference_idx',false,ARRAY['item_id']::text[],NULL::text)
 )
 SELECT commands IS NOT NULL OR revisions IS NOT NULL OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=items AND attname='version' AND NOT attisdropped) OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.stock_transfers') AND attname='requested_unit' AND NOT attisdropped),
 items IS NOT NULL AND commands IS NOT NULL AND revisions IS NOT NULL
 AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.inventory_item_has_operational_history(uuid)') AND prorettype='bool'::regtype AND provolatile='v')
 AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.inventory_item_reserve_codes(uuid,text[])') AND prorettype='void'::regtype AND provolatile='v')
 AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=items AND conname='inventory_item_version_positive' AND contype='c' AND convalidated AND pg_get_expr(conbin,conrelid)='(version > 0)')
 AND NOT EXISTS(SELECT 1 FROM required_columns r WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=r.relation AND a.attname=r.name AND a.atttypid=r.kind AND a.attnotnull=r.required AND NOT a.attisdropped))
 AND NOT EXISTS(SELECT 1 FROM required_triggers r WHERE NOT EXISTS(SELECT 1 FROM pg_trigger g WHERE g.tgrelid=r.relation AND g.tgname=r.name AND g.tgenabled IN('O','A') AND g.tgtype=r.kind AND g.tgdeferrable=r.deferred AND g.tginitdeferred=r.deferred AND g.tgargs=r.args AND g.tgfoid=to_regprocedure(r.guard_function)))
 AND NOT EXISTS(SELECT 1 FROM required_indexes r WHERE NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=r.relation AND c.relname=r.name AND i.indisvalid AND i.indisready AND i.indisunique=r.is_unique AND pg_get_expr(i.indpred,i.indrelid) IS NOT DISTINCT FROM r.predicate AND(SELECT array_agg(a.attname::text ORDER BY k.ordinality)FROM unnest(i.indkey::smallint[])WITH ORDINALITY k(attnum,ordinality)JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE k.ordinality<=i.indnkeyatts)=r.keys))
 FROM relations
 "#).fetch_one(&mut **tx).await?;
    let applied: Option<(bool, Vec<u8>)> = if history {
        sqlx::query_as("SELECT success,checksum FROM public._sqlx_migrations WHERE version=$1")
            .bind(INVENTORY_ITEMS_BREAKING_EPOCH)
            .fetch_optional(&mut **tx)
            .await?
    } else {
        None
    };
    match (applied, any, complete) {
        (None, false, false) => Ok(previous),
        (Some((true, checksum)), true, true)
            if previous == APPOINTMENT_TYPES_BREAKING_EPOCH
                && committed_checksum(INVENTORY_ITEMS_BREAKING_EPOCH, &checksum) =>
        {
            Ok(INVENTORY_ITEMS_BREAKING_EPOCH)
        }
        _ => anyhow::bail!("Database schema compatibility could not be confirmed."),
    }
}
