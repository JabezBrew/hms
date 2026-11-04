//! Exact supplier publication/reference/receipt layout for breaking epoch032.
use super::{
    committed_checksum, INVENTORY_CATEGORIES_BREAKING_EPOCH, INVENTORY_SUPPLIERS_BREAKING_EPOCH,
};
use sqlx::{Postgres, Transaction};

pub(super) async fn committed_epoch(
    tx: &mut Transaction<'_, Postgres>,
    history: bool,
    previous: i64,
) -> anyhow::Result<i64> {
    let (any,complete):(bool,bool)=sqlx::query_as(r#"
WITH relations AS(SELECT to_regclass('public.inventory_suppliers') suppliers,to_regclass('public.inventory_supplier_commands') commands),
required_columns(relation,name,kind,required) AS(VALUES
(to_regclass('public.inventory_suppliers'),'id','uuid'::regtype,true),
(to_regclass('public.inventory_suppliers'),'facility_id','uuid'::regtype,true),
(to_regclass('public.inventory_suppliers'),'code','text'::regtype,true),
(to_regclass('public.inventory_suppliers'),'name','text'::regtype,true),
(to_regclass('public.inventory_suppliers'),'contact_name','text'::regtype,false),
(to_regclass('public.inventory_suppliers'),'phone','text'::regtype,false),
(to_regclass('public.inventory_suppliers'),'email','text'::regtype,false),
(to_regclass('public.inventory_suppliers'),'is_active','bool'::regtype,true),
(to_regclass('public.inventory_suppliers'),'created_at','timestamptz'::regtype,true),
(to_regclass('public.inventory_suppliers'),'updated_at','timestamptz'::regtype,true),
(to_regclass('public.inventory_suppliers'),'address','text'::regtype,false),
(to_regclass('public.inventory_suppliers'),'version','int8'::regtype,true),
(to_regclass('public.inventory_suppliers'),'catalog_changed_at','timestamptz'::regtype,false),
(to_regclass('public.inventory_suppliers'),'created_by_user_id','uuid'::regtype,false),
(to_regclass('public.inventory_suppliers'),'updated_by_user_id','uuid'::regtype,false),
(to_regclass('public.inventory_supplier_commands'),'id','uuid'::regtype,true),
(to_regclass('public.inventory_supplier_commands'),'facility_id','uuid'::regtype,true),
(to_regclass('public.inventory_supplier_commands'),'request_key_hash','bytea'::regtype,true),
(to_regclass('public.inventory_supplier_commands'),'actor_user_id','uuid'::regtype,true),
(to_regclass('public.inventory_supplier_commands'),'supplier_id','uuid'::regtype,true),
(to_regclass('public.inventory_supplier_commands'),'action','text'::regtype,true),
(to_regclass('public.inventory_supplier_commands'),'payload_digest','bytea'::regtype,true),
(to_regclass('public.inventory_supplier_commands'),'receipt','jsonb'::regtype,true),
(to_regclass('public.inventory_supplier_commands'),'recorded_at','timestamptz'::regtype,true)),
required_functions(signature,result,volatility,defaults,default_value) AS(VALUES
('public.inventory_supplier_identity_gate(uuid)','void'::regtype,'v',0,NULL::text),
('public.inventory_supplier_code_gate(uuid,text)','void'::regtype,'v',0,NULL::text),
('public.inventory_supplier_publication_gate(uuid,uuid,text)','void'::regtype,'v',0,NULL::text),
('public.inventory_supplier_has_item_reference(uuid)','bool'::regtype,'v',0,NULL::text),
('public.inventory_supplier_text_valid(text,integer,integer,integer,boolean)','bool'::regtype,'i',1,'false'),
('public.inventory_supplier_snapshot_valid(jsonb)','bool'::regtype,'i',0,NULL::text),
('public.inventory_supplier_identity_guard()','trigger'::regtype,'v',0,NULL::text),
('public.inventory_item_supplier_source_guard()','trigger'::regtype,'v',0,NULL::text),
('public.inventory_supplier_command_guard()','trigger'::regtype,'v',0,NULL::text),
('public.inventory_supplier_command_complete_guard()','trigger'::regtype,'v',0,NULL::text),
('public.inventory_supplier_refresh_search(uuid,uuid)','void'::regtype,'v',0,NULL::text),
('public.inventory_supplier_search_guard()','trigger'::regtype,'v',0,NULL::text)),
required_triggers(relation,name,guard_function,kind,deferred,columns) AS(VALUES
(to_regclass('public.inventory_suppliers'),'inventory_supplier_identity','public.inventory_supplier_identity_guard()',31,false,ARRAY[]::text[]),
(to_regclass('public.inventory_items'),'inventory_item_supplier_source','public.inventory_item_supplier_source_guard()',23,false,ARRAY['facility_id','primary_supplier_id']::text[]),
(to_regclass('public.inventory_supplier_commands'),'inventory_supplier_command_immutable','public.inventory_supplier_command_guard()',31,false,ARRAY[]::text[]),
(to_regclass('public.inventory_supplier_commands'),'inventory_supplier_command_complete','public.inventory_supplier_command_complete_guard()',5,true,ARRAY[]::text[]),
(to_regclass('public.inventory_suppliers'),'inventory_supplier_search','public.inventory_supplier_search_guard()',21,false,ARRAY[]::text[])),
required_indexes(relation,name,is_unique,keys,predicate) AS(VALUES
(to_regclass('public.inventory_suppliers'),'inventory_suppliers_pkey',true,ARRAY['id']::text[],NULL::text),
(to_regclass('public.inventory_suppliers'),'inventory_suppliers_facility_id_code_key',true,ARRAY['facility_id','code']::text[],NULL::text),
(to_regclass('public.inventory_suppliers'),'inventory_supplier_administration_page_idx',false,ARRAY['facility_id','created_at','id']::text[],NULL::text),
(to_regclass('public.inventory_suppliers'),'inventory_suppliers_facility_active_created_idx',false,ARRAY['facility_id','is_active','created_at','id']::text[],NULL::text),
(to_regclass('public.inventory_items'),'inventory_supplier_item_reference_idx',false,ARRAY['primary_supplier_id']::text[],'(primary_supplier_id IS NOT NULL)'::text),
(to_regclass('public.inventory_supplier_commands'),'inventory_supplier_commands_pkey',true,ARRAY['facility_id','request_key_hash']::text[],NULL::text),
(to_regclass('public.inventory_supplier_commands'),'inventory_supplier_commands_id_key',true,ARRAY['id']::text[],NULL::text),
(to_regclass('public.inventory_supplier_commands'),'inventory_supplier_commands_history_idx',false,ARRAY['facility_id','supplier_id','recorded_at','id']::text[],NULL::text)),
required_search_indexes(name,column_name) AS(VALUES
('inventory_suppliers_name_search_trgm_idx','name'),('inventory_suppliers_code_search_trgm_idx','code'),
('inventory_suppliers_contact_name_search_trgm_idx','contact_name'),('inventory_suppliers_phone_search_trgm_idx','phone'),('inventory_suppliers_email_search_trgm_idx','email')),
required_fks(relation,column_name,target,target_column) AS(VALUES
(to_regclass('public.inventory_suppliers'),'facility_id',to_regclass('public.facilities'),'id'),
(to_regclass('public.inventory_suppliers'),'created_by_user_id',to_regclass('public.users'),'id'),
(to_regclass('public.inventory_suppliers'),'updated_by_user_id',to_regclass('public.users'),'id'),
(to_regclass('public.inventory_items'),'primary_supplier_id',to_regclass('public.inventory_suppliers'),'id'),
(to_regclass('public.inventory_supplier_commands'),'facility_id',to_regclass('public.facilities'),'id'),
(to_regclass('public.inventory_supplier_commands'),'actor_user_id',to_regclass('public.users'),'id'),
(to_regclass('public.inventory_supplier_commands'),'supplier_id',to_regclass('public.inventory_suppliers'),'id')),
required_checks(relation,name,expression) AS(VALUES
(to_regclass('public.inventory_suppliers'),'inventory_supplier_version_positive','(version > 0)'),
(to_regclass('public.inventory_supplier_commands'),'inventory_supplier_commands_request_key_hash_check','(octet_length(request_key_hash) = 32)'),
(to_regclass('public.inventory_supplier_commands'),'inventory_supplier_commands_payload_digest_check','(octet_length(payload_digest) = 32)'),
(to_regclass('public.inventory_supplier_commands'),'inventory_supplier_commands_receipt_check','(jsonb_typeof(receipt) = ''object''::text)'),
(to_regclass('public.inventory_supplier_commands'),'inventory_supplier_commands_action_check','(action = ANY (ARRAY[''create''::text, ''correct''::text, ''retire''::text, ''reactivate''::text]))'))
SELECT commands IS NOT NULL OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=suppliers AND attname IN('version','address') AND NOT attisdropped),
suppliers IS NOT NULL AND commands IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM required_columns r WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=r.relation AND a.attname=r.name AND a.atttypid=r.kind AND a.attnotnull=r.required AND NOT a.attisdropped))
AND NOT EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid=suppliers AND a.attname IN('address','catalog_changed_at','created_by_user_id','updated_by_user_id'))
AND EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid=suppliers AND a.attname='version' AND pg_get_expr(d.adbin,d.adrelid)='1')
AND NOT EXISTS(SELECT 1 FROM required_functions r WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r.signature) AND p.prorettype=r.result AND p.prokind='f' AND NOT p.prosecdef AND NOT p.proisstrict AND p.proconfig IS NULL AND p.proparallel='u' AND p.provolatile::text=r.volatility AND p.pronargdefaults=r.defaults AND pg_get_expr(p.proargdefaults,0) IS NOT DISTINCT FROM r.default_value))
AND NOT EXISTS(SELECT 1 FROM required_triggers r WHERE NOT EXISTS(SELECT 1 FROM pg_trigger g WHERE g.tgrelid=r.relation AND g.tgname=r.name AND g.tgenabled IN('O','A') AND g.tgtype=r.kind AND g.tgdeferrable=r.deferred AND g.tginitdeferred=r.deferred AND g.tgargs=decode('','hex') AND g.tgfoid=to_regprocedure(r.guard_function) AND g.tgqual IS NULL AND(g.tgconstraint<>0)=r.deferred AND coalesce((SELECT array_agg(attribute.attname::text ORDER BY attribute.attname) FROM unnest(g.tgattr::smallint[]) column_number(attnum) JOIN pg_attribute attribute ON attribute.attrelid=g.tgrelid AND attribute.attnum=column_number.attnum),ARRAY[]::text[])=r.columns))
AND NOT EXISTS(SELECT 1 FROM required_indexes r WHERE NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am a ON a.oid=c.relam WHERE i.indrelid=r.relation AND c.relname=r.name AND a.amname='btree' AND i.indisvalid AND i.indisready AND i.indisunique=r.is_unique AND pg_get_expr(i.indpred,i.indrelid) IS NOT DISTINCT FROM r.predicate AND i.indnkeyatts=cardinality(r.keys) AND(SELECT array_agg(a.attname::text ORDER BY k.ordinality) FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE k.ordinality<=i.indnkeyatts)=r.keys))
AND NOT EXISTS(SELECT 1 FROM required_search_indexes r WHERE NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am a ON a.oid=c.relam JOIN pg_attribute attribute ON attribute.attrelid=i.indrelid AND attribute.attnum=i.indkey[0] WHERE i.indrelid=suppliers AND c.relname=r.name AND attribute.attname=r.column_name AND i.indisvalid AND i.indisready AND NOT i.indisunique AND i.indnkeyatts=1 AND a.amname='gin' AND i.indexprs IS NULL AND i.indpred IS NULL AND EXISTS(SELECT 1 FROM pg_opclass o WHERE o.oid=i.indclass[0] AND o.opcname='gin_trgm_ops')))
AND NOT EXISTS(SELECT 1 FROM required_fks r WHERE NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute source ON source.attrelid=c.conrelid AND source.attname=r.column_name JOIN pg_attribute target ON target.attrelid=c.confrelid AND target.attname=r.target_column WHERE c.conrelid=r.relation AND c.confrelid=r.target AND c.contype='f' AND c.convalidated AND NOT c.condeferrable AND c.confdeltype='r' AND c.conkey=ARRAY[source.attnum]::smallint[] AND c.confkey=ARRAY[target.attnum]::smallint[]))
AND NOT EXISTS(SELECT 1 FROM required_checks r WHERE NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=r.relation AND c.conname=r.name AND c.contype='c' AND c.convalidated AND pg_get_expr(c.conbin,c.conrelid)=r.expression))
AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=to_regclass('public.audit_events') AND c.relname='inventory_supplier_audit_command_idx' AND i.indisvalid AND i.indisready AND NOT i.indisunique AND i.indnkeyatts=2 AND pg_get_indexdef(i.indexrelid,1,true)='facility_id' AND c.relam=(SELECT oid FROM pg_am WHERE amname='btree') AND pg_get_expr(i.indexprs,i.indrelid)='(metadata ->> ''command_id''::text)' AND pg_get_expr(i.indpred,i.indrelid)='(resource_type = ''inventory_supplier''::text)')
FROM relations
"#).fetch_one(&mut **tx).await?;
    let applied: Option<(bool, Vec<u8>)> = if history {
        sqlx::query_as("SELECT success,checksum FROM public._sqlx_migrations WHERE version=$1")
            .bind(INVENTORY_SUPPLIERS_BREAKING_EPOCH)
            .fetch_optional(&mut **tx)
            .await?
    } else {
        None
    };
    let bodies = if any {
        exact_function_bodies(tx).await?
    } else {
        true
    };
    match (applied, any, complete && bodies) {
        (None, false, false) => Ok(previous),
        (Some((true, checksum)), true, true)
            if previous == INVENTORY_CATEGORIES_BREAKING_EPOCH
                && committed_checksum(INVENTORY_SUPPLIERS_BREAKING_EPOCH, &checksum) =>
        {
            Ok(INVENTORY_SUPPLIERS_BREAKING_EPOCH)
        }
        _ => anyhow::bail!("Database schema compatibility could not be confirmed."),
    }
}
async fn exact_function_bodies(tx: &mut Transaction<'_, Postgres>) -> anyhow::Result<bool> {
    let source =
        include_str!("../../../../migrations/202611020032_inventory_supplier_governance.sql");
    let expected: std::collections::BTreeMap<String, String> = source
        .split("CREATE FUNCTION ")
        .skip(1)
        .map(|part| {
            (
                part.split('(')
                    .next()
                    .expect("migration function name")
                    .to_owned(),
                part.split("$$")
                    .nth(1)
                    .expect("migration function body")
                    .to_owned(),
            )
        })
        .collect();
    let names: Vec<String> = expected.keys().cloned().collect();
    let actual:Vec<(String,String)>=sqlx::query_as("SELECT proname::text,prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname::text=ANY($1)").bind(names).fetch_all(&mut **tx).await?;
    Ok(actual.len() == expected.len()
        && actual
            .into_iter()
            .all(|(name, body)| expected.get(&name) == Some(&body)))
}
