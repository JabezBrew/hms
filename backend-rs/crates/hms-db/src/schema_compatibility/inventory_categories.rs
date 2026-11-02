//! Exact governed category and retained direct-parent layout for breaking epoch031.
use super::{
    committed_checksum, INVENTORY_CATEGORIES_BREAKING_EPOCH, INVENTORY_ITEMS_BREAKING_EPOCH,
};
use sqlx::{Postgres, Transaction};
pub(super) async fn committed_epoch(
    tx: &mut Transaction<'_, Postgres>,
    history: bool,
    previous: i64,
) -> anyhow::Result<i64> {
    let(any,complete):(bool,bool)=sqlx::query_as(r#"
 WITH relations AS(SELECT to_regclass('public.inventory_categories') categories,to_regclass('public.inventory_category_commands') commands),
 required_columns(relation,name,kind,required)AS(VALUES
(to_regclass('public.inventory_categories'),'description','text'::regtype,false),
(to_regclass('public.inventory_categories'),'parent_id','uuid'::regtype,false),
(to_regclass('public.inventory_categories'),'version','int8'::regtype,true),
(to_regclass('public.inventory_categories'),'catalog_changed_at','timestamptz'::regtype,false),
(to_regclass('public.inventory_categories'),'created_by_user_id','uuid'::regtype,false),
(to_regclass('public.inventory_categories'),'updated_by_user_id','uuid'::regtype,false),
(to_regclass('public.inventory_category_commands'),'id','uuid'::regtype,true),
(to_regclass('public.inventory_category_commands'),'facility_id','uuid'::regtype,true),
(to_regclass('public.inventory_category_commands'),'request_key_hash','bytea'::regtype,true),
(to_regclass('public.inventory_category_commands'),'actor_user_id','uuid'::regtype,true),
(to_regclass('public.inventory_category_commands'),'category_id','uuid'::regtype,true),
(to_regclass('public.inventory_category_commands'),'action','text'::regtype,true),
(to_regclass('public.inventory_category_commands'),'payload_digest','bytea'::regtype,true),
(to_regclass('public.inventory_category_commands'),'receipt','jsonb'::regtype,true),
(to_regclass('public.inventory_category_commands'),'recorded_at','timestamptz'::regtype,true)),required_triggers(relation,name,guard_function,kind,deferred)AS(VALUES
(to_regclass('public.inventory_categories'),'inventory_category_identity','public.inventory_category_identity_guard()',31,false),
(to_regclass('public.inventory_category_commands'),'inventory_category_command_immutable','public.inventory_category_command_guard()',31,false),
(to_regclass('public.inventory_category_commands'),'inventory_category_command_complete','public.inventory_category_command_complete_guard()',5,true)),required_indexes(relation,name,is_unique,keys,predicate)AS(VALUES
(to_regclass('public.inventory_categories'),'inventory_category_administration_page_idx',false,ARRAY['facility_id','created_at','id']::text[],NULL::text),
(to_regclass('public.inventory_items'),'inventory_category_item_reference_idx',false,ARRAY['category_id']::text[],NULL::text),
(to_regclass('public.inventory_categories'),'inventory_category_child_reference_idx',false,ARRAY['parent_id']::text[],'(parent_id IS NOT NULL)'::text),
(to_regclass('public.inventory_category_commands'),'inventory_category_commands_pkey',true,ARRAY['facility_id','request_key_hash']::text[],NULL::text),
(to_regclass('public.inventory_category_commands'),'inventory_category_commands_id_key',true,ARRAY['id']::text[],NULL::text),
(to_regclass('public.inventory_category_commands'),'inventory_category_commands_history_idx',false,ARRAY['facility_id','category_id','recorded_at','id']::text[],NULL::text) ) SELECT commands IS NOT NULL OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=categories AND attname='version' AND NOT attisdropped),
 categories IS NOT NULL AND commands IS NOT NULL
 AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.inventory_category_identity_gate(uuid)') AND prorettype='void'::regtype AND provolatile='v')
 AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.inventory_category_graph_gate(uuid)') AND prorettype='void'::regtype AND provolatile='v')
 AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.inventory_category_parent_proof(uuid,uuid,uuid,bigint)') AND prorettype='void'::regtype AND provolatile='v')
 AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.inventory_category_has_item_reference(uuid)') AND prorettype='bool'::regtype AND provolatile='v')
 AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.inventory_category_has_child_reference(uuid)') AND prorettype='bool'::regtype AND provolatile='v')
 AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.inventory_category_text_valid(text,integer,integer,boolean)') AND prorettype='bool'::regtype AND provolatile='i')
 AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=to_regclass('public.audit_events') AND c.relname='inventory_category_audit_command_idx' AND i.indisvalid AND i.indisready AND NOT i.indisunique AND i.indnkeyatts=2 AND pg_get_indexdef(i.indexrelid,1,true)='facility_id' AND c.relam=(SELECT oid FROM pg_am WHERE amname='btree') AND pg_get_expr(i.indexprs,i.indrelid)='(metadata ->> ''command_id''::text)' AND pg_get_expr(i.indpred,i.indrelid)='(resource_type = ''inventory_category''::text)')
 AND NOT EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid=categories AND a.attname IN('description','parent_id','catalog_changed_at','created_by_user_id','updated_by_user_id'))
 AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.inventory_category_parent_proof(uuid,uuid,uuid,bigint)') AND pronargdefaults=1 AND pg_get_expr(proargdefaults,0)='NULL::bigint')
 AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.inventory_category_text_valid(text,integer,integer,boolean)') AND pronargdefaults=1 AND pg_get_expr(proargdefaults,0)='false')
 AND EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid=categories AND a.attname='version' AND pg_get_expr(d.adbin,d.adrelid)='1')
 AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=categories AND conname='inventory_category_version_positive' AND contype='c' AND convalidated AND pg_get_expr(conbin,conrelid)='(version > 0)')
 AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am a ON a.oid=c.relam WHERE i.indrelid=categories AND c.relname='inventory_category_search_idx' AND i.indisvalid AND i.indisready AND a.amname='gin' AND EXISTS(SELECT 1 FROM pg_opclass o WHERE o.oid=i.indclass[0] AND o.opcname='gin_trgm_ops') AND pg_get_expr(i.indexprs,i.indrelid)='((code || '' ''::text) || name)')
 AND NOT EXISTS(SELECT 1 FROM required_columns r WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=r.relation AND a.attname=r.name AND a.atttypid=r.kind AND a.attnotnull=r.required AND NOT a.attisdropped))
 AND NOT EXISTS(SELECT 1 FROM required_triggers r WHERE NOT EXISTS(SELECT 1 FROM pg_trigger g WHERE g.tgrelid=r.relation AND g.tgname=r.name AND g.tgenabled IN('O','A') AND g.tgtype=r.kind AND g.tgdeferrable=r.deferred AND g.tginitdeferred=r.deferred AND g.tgargs=decode('','hex') AND g.tgfoid=to_regprocedure(r.guard_function)))
 AND NOT EXISTS(SELECT 1 FROM required_indexes r WHERE NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=r.relation AND c.relname=r.name AND i.indisvalid AND i.indisready AND i.indisunique=r.is_unique AND pg_get_expr(i.indpred,i.indrelid) IS NOT DISTINCT FROM r.predicate AND(SELECT array_agg(a.attname::text ORDER BY k.ordinality)FROM unnest(i.indkey::smallint[])WITH ORDINALITY k(attnum,ordinality)JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE k.ordinality<=i.indnkeyatts)=r.keys)) FROM relations
 "#).fetch_one(&mut **tx).await?;
    let applied: Option<(bool, Vec<u8>)> = if history {
        sqlx::query_as("SELECT success,checksum FROM public._sqlx_migrations WHERE version=$1")
            .bind(INVENTORY_CATEGORIES_BREAKING_EPOCH)
            .fetch_optional(&mut **tx)
            .await?
    } else {
        None
    };
    // The packaged migration is also the exact source of the intrinsic guards.
    // Matching names/signatures alone must not accept a replaced no-op body.
    let functions_match = if any {
        exact_function_bodies(tx).await?
    } else {
        true
    };
    match (applied, any, complete && functions_match) {
        (None, false, false) => Ok(previous),
        (Some((true, checksum)), true, true)
            if previous == INVENTORY_ITEMS_BREAKING_EPOCH
                && committed_checksum(INVENTORY_CATEGORIES_BREAKING_EPOCH, &checksum) =>
        {
            Ok(INVENTORY_CATEGORIES_BREAKING_EPOCH)
        }
        _ => anyhow::bail!("Database schema compatibility could not be confirmed."),
    }
}

async fn exact_function_bodies(tx: &mut Transaction<'_, Postgres>) -> anyhow::Result<bool> {
    let source =
        include_str!("../../../../migrations/202610310031_inventory_category_governance.sql");
    let expected: std::collections::BTreeMap<String, String> = source
        .split("CREATE FUNCTION ")
        .skip(1)
        .map(|part| {
            let name = part
                .split('(')
                .next()
                .expect("migration function name")
                .to_owned();
            let body = part
                .split("$$")
                .nth(1)
                .expect("migration function body")
                .to_owned();
            (name, body)
        })
        .collect();
    let names: Vec<String> = expected.keys().cloned().collect();
    let actual:Vec<(String,String)>=sqlx::query_as("SELECT proname::text,prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname::text=ANY($1)").bind(names).fetch_all(&mut **tx).await?;
    Ok(actual.len() == expected.len()
        && actual
            .into_iter()
            .all(|(name, body)| expected.get(&name) == Some(&body)))
}
