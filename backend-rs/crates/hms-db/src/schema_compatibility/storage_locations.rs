//! Required retained storage-location command and reference-publication layout.
use super::{
    committed_checksum, ORGANIZATION_UNITS_BREAKING_EPOCH, STORAGE_LOCATIONS_BREAKING_EPOCH,
};
use sqlx::{Postgres, Transaction};

pub(super) async fn committed_epoch(
    tx: &mut Transaction<'_, Postgres>,
    migration_history_exists: bool,
    previous_epoch: i64,
) -> anyhow::Result<i64> {
    let (any_layout, complete_layout): (bool, bool) = sqlx::query_as(
        r#"
        WITH relations AS (
          SELECT to_regclass('public.storage_locations') AS locations,
                 to_regclass('public.storage_location_commands') AS commands
        ), required_columns AS (
          SELECT locations AS relation,'version' AS name,'int8'::regtype AS kind,
                 true AS required FROM relations
          UNION ALL SELECT locations,'updated_at','timestamptz'::regtype,true FROM relations
          UNION ALL SELECT commands,name,kind::regtype,true FROM relations,
            (VALUES ('facility_id','uuid'),('request_key_hash','bytea'),
                    ('actor_user_id','uuid'),('location_id','uuid'),('action','text'),
                    ('payload_digest','bytea'),('receipt','jsonb'),
                    ('recorded_at','timestamptz')) col(name,kind)
        ), required_triggers(relation,name,guard_function,kind,args) AS (
          VALUES
          (to_regclass('public.storage_locations'),'storage_location_identity_lifecycle',
             'public.storage_location_identity_lifecycle_guard()',31,decode('','hex')),
          (to_regclass('public.stock_batches'),'storage_location_batch_reference',
             'public.storage_location_operational_reference_guard()',23,decode('6c6f636174696f6e5f696400','hex')),
          (to_regclass('public.stock_movements'),'storage_location_movement_reference',
             'public.storage_location_operational_reference_guard()',23,decode('6c6f636174696f6e5f696400','hex')),
          (to_regclass('public.stock_transfers'),'storage_location_transfer_reference',
             'public.storage_location_operational_reference_guard()',23,decode('66726f6d5f6c6f636174696f6e5f696400746f5f6c6f636174696f6e5f696400','hex')),
          (to_regclass('public.stock_requisitions'),'storage_location_requisition_reference',
             'public.storage_location_operational_reference_guard()',23,decode('72657175657374696e675f6c6f636174696f6e5f69640066756c66696c6c696e675f6c6f636174696f6e5f696400','hex')),
          (to_regclass('public.controlled_substance_register'),'storage_location_controlled_reference',
             'public.storage_location_operational_reference_guard()',23,decode('6c6f636174696f6e5f696400','hex')),
          (to_regclass('public.pharmacy_dispenses'),'storage_location_dispense_reference',
             'public.storage_location_operational_reference_guard()',23,decode('6c6f636174696f6e5f696400','hex')),
          (to_regclass('public.inventory_standing_orders'),'storage_location_standing_reference',
             'public.storage_location_operational_reference_guard()',23,decode('72657175657374696e675f6c6f636174696f6e5f696400','hex')),
          (to_regclass('public.stock_check_queue'),'storage_location_check_reference',
             'public.storage_location_operational_reference_guard()',23,decode('6c6f636174696f6e5f696400','hex')),
          (to_regclass('public.pharmacy_fulfillments'),'storage_location_fulfillment_reference',
             'public.storage_location_operational_reference_guard()',23,decode('64697370656e73696e675f6c6f636174696f6e5f696400','hex')),
          (to_regclass('public.inventory_standing_order_templates'),'storage_location_template_reference',
             'public.storage_location_operational_reference_guard()',23,decode('72657175657374696e675f6c6f636174696f6e5f69640066756c66696c6c696e675f6c6f636174696f6e5f696400','hex')),
          (to_regclass('public.storage_location_commands'),'storage_location_command_immutable',
             'public.storage_location_command_immutable_guard()',31,decode('','hex'))
        ), required_indexes(relation,name,is_unique,keys) AS (
          VALUES
          (to_regclass('public.storage_location_commands'),'storage_location_commands_pkey',true,
             ARRAY['facility_id','request_key_hash']::text[]),
          (to_regclass('public.storage_locations'),'storage_location_administration_page_idx',false,
             ARRAY['facility_id','created_at','id']::text[]),
          (to_regclass('public.stock_batches'),'storage_location_batch_location_id_reference_idx',false,
             ARRAY['location_id']::text[]),
          (to_regclass('public.stock_movements'),'storage_location_movement_location_id_reference_idx',false,
             ARRAY['location_id']::text[]),
          (to_regclass('public.stock_transfers'),'storage_location_transfer_from_location_id_reference_idx',false,
             ARRAY['from_location_id']::text[]),
          (to_regclass('public.stock_transfers'),'storage_location_transfer_to_location_id_reference_idx',false,
             ARRAY['to_location_id']::text[]),
          (to_regclass('public.stock_requisitions'),'storage_location_requisition_requesting_reference_idx',false,
             ARRAY['requesting_location_id']::text[]),
          (to_regclass('public.stock_requisitions'),'storage_location_requisition_fulfilling_reference_idx',false,
             ARRAY['fulfilling_location_id']::text[]),
          (to_regclass('public.controlled_substance_register'),'storage_location_controlled_location_id_reference_idx',false,
             ARRAY['location_id']::text[]),
          (to_regclass('public.pharmacy_dispenses'),'storage_location_dispense_location_id_reference_idx',false,
             ARRAY['location_id']::text[]),
          (to_regclass('public.inventory_standing_orders'),'storage_location_standing_requesting_location_id_reference_idx',false,
             ARRAY['requesting_location_id']::text[]),
          (to_regclass('public.stock_check_queue'),'storage_location_check_location_id_reference_idx',false,
             ARRAY['location_id']::text[]),
          (to_regclass('public.pharmacy_fulfillments'),'storage_location_fulfillment_dispensing_reference_idx',false,
             ARRAY['dispensing_location_id']::text[]),
          (to_regclass('public.inventory_standing_order_templates'),'storage_location_template_requesting_location_id_reference_idx',false,
             ARRAY['requesting_location_id']::text[]),
          (to_regclass('public.inventory_standing_order_templates'),'storage_location_template_fulfilling_location_id_reference_idx',false,
             ARRAY['fulfilling_location_id']::text[]),
          (to_regclass('public.storage_location_commands'),'storage_location_commands_location_idx',false,
             ARRAY['facility_id','location_id','recorded_at']::text[])
        )
        SELECT commands IS NOT NULL
                 OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=locations
                   AND attname IN('version','updated_at') AND NOT attisdropped)
                 OR EXISTS(SELECT 1 FROM required_triggers r JOIN pg_trigger g
                   ON g.tgrelid=r.relation AND g.tgname=r.name),
               locations IS NOT NULL AND commands IS NOT NULL
                 AND EXISTS(SELECT 1 FROM pg_proc
                   WHERE oid=to_regprocedure('public.storage_location_has_operational_history(uuid)')
                     AND prorettype='bool'::regtype)
                 AND NOT EXISTS(SELECT 1 FROM required_columns r WHERE NOT EXISTS(
                   SELECT 1 FROM pg_attribute a WHERE a.attrelid=r.relation
                     AND a.attname=r.name AND a.atttypid=r.kind
                     AND a.attnotnull=r.required AND NOT a.attisdropped))
                 AND NOT EXISTS(SELECT 1 FROM required_triggers r WHERE NOT EXISTS(
                   SELECT 1 FROM pg_trigger g WHERE g.tgrelid=r.relation
                     AND g.tgname=r.name AND g.tgenabled IN ('O','A')
                     AND g.tgtype=r.kind AND NOT g.tgdeferrable
                     AND NOT g.tginitdeferred AND g.tgargs=r.args
                     AND g.tgfoid=to_regprocedure(r.guard_function)))
                 AND NOT EXISTS(SELECT 1 FROM required_indexes r WHERE NOT EXISTS(
                   SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
                   WHERE i.indrelid=r.relation AND c.relname=r.name
                     AND i.indisvalid AND i.indisready AND i.indisunique=r.is_unique
                     AND i.indpred IS NULL
                     AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality)
                       FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,ordinality)
                       JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
                       WHERE k.ordinality<=i.indnkeyatts)=r.keys))
        FROM relations
        "#,
    )
    .fetch_one(&mut **tx)
    .await?;
    let applied: Option<(bool, Vec<u8>)> = if migration_history_exists {
        sqlx::query_as("SELECT success,checksum FROM public._sqlx_migrations WHERE version=$1")
            .bind(STORAGE_LOCATIONS_BREAKING_EPOCH)
            .fetch_optional(&mut **tx)
            .await?
    } else {
        None
    };
    match (applied, any_layout, complete_layout) {
        (None, false, false) => Ok(previous_epoch),
        (Some((true, checksum)), true, true)
            if previous_epoch == ORGANIZATION_UNITS_BREAKING_EPOCH
                && committed_checksum(STORAGE_LOCATIONS_BREAKING_EPOCH, &checksum) =>
        {
            Ok(STORAGE_LOCATIONS_BREAKING_EPOCH)
        }
        _ => anyhow::bail!("Database schema compatibility could not be confirmed."),
    }
}
