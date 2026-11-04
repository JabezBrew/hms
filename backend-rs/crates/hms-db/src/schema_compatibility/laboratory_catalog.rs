//! Exact all-writer laboratory source/receipt layout for breaking epoch033.
use super::{
    committed_checksum, INVENTORY_SUPPLIERS_BREAKING_EPOCH, LABORATORY_CATALOG_BREAKING_EPOCH,
};
use sqlx::{Postgres, Transaction};

pub(super) async fn committed_epoch(
    tx: &mut Transaction<'_, Postgres>,
    history: bool,
    previous: i64,
) -> anyhow::Result<i64> {
    let (any,complete):(bool,bool)=sqlx::query_as(r#"
WITH relations AS(SELECT to_regclass('public.lab_tests') tests,to_regclass('public.lab_panels') panels,to_regclass('public.laboratory_catalog_commands') commands),
required_columns(relation,name,kind,required) AS(VALUES
(to_regclass('public.lab_tests'),'category','text'::regtype,false),
(to_regclass('public.lab_tests'),'specimen_type','text'::regtype,true),
(to_regclass('public.lab_tests'),'result_unit','text'::regtype,false),
(to_regclass('public.lab_tests'),'is_system_default','bool'::regtype,true),
(to_regclass('public.lab_tests'),'is_facility_modified','bool'::regtype,true),
(to_regclass('public.lab_panels'),'is_system_default','bool'::regtype,true),
(to_regclass('public.lab_panels'),'is_facility_modified','bool'::regtype,true),
(to_regclass('public.lab_panel_tests'),'panel_id','uuid'::regtype,true),
(to_regclass('public.lab_panel_tests'),'test_id','uuid'::regtype,true),
(to_regclass('public.lab_order_tests'),'order_id','uuid'::regtype,true),
(to_regclass('public.lab_order_tests'),'test_id','uuid'::regtype,true),
(to_regclass('public.lab_orders'),'id','uuid'::regtype,true),
(to_regclass('public.lab_orders'),'facility_id','uuid'::regtype,true),
(to_regclass('public.lab_tests'),'id','uuid'::regtype,true),
(to_regclass('public.lab_tests'),'facility_id','uuid'::regtype,true),
(to_regclass('public.lab_tests'),'code','text'::regtype,true),
(to_regclass('public.lab_tests'),'name','text'::regtype,true),
(to_regclass('public.lab_tests'),'is_active','bool'::regtype,true),
(to_regclass('public.lab_tests'),'created_at','timestamptz'::regtype,true),
(to_regclass('public.lab_tests'),'updated_at','timestamptz'::regtype,true),
(to_regclass('public.lab_tests'),'version','int8'::regtype,true),
(to_regclass('public.lab_tests'),'catalog_changed_at','timestamptz'::regtype,false),
(to_regclass('public.lab_tests'),'catalog_changed_by_user_id','uuid'::regtype,false),
(to_regclass('public.lab_panels'),'id','uuid'::regtype,true),
(to_regclass('public.lab_panels'),'facility_id','uuid'::regtype,true),
(to_regclass('public.lab_panels'),'code','text'::regtype,true),
(to_regclass('public.lab_panels'),'name','text'::regtype,true),
(to_regclass('public.lab_panels'),'is_active','bool'::regtype,true),
(to_regclass('public.lab_panels'),'created_at','timestamptz'::regtype,true),
(to_regclass('public.lab_panels'),'updated_at','timestamptz'::regtype,true),
(to_regclass('public.lab_panels'),'version','int8'::regtype,true),
(to_regclass('public.lab_panels'),'catalog_changed_at','timestamptz'::regtype,false),
(to_regclass('public.lab_panels'),'catalog_changed_by_user_id','uuid'::regtype,false),
(to_regclass('public.lab_panels'),'membership_generation','int8'::regtype,true),
(to_regclass('public.laboratory_catalog_commands'),'id','uuid'::regtype,true),
(to_regclass('public.laboratory_catalog_commands'),'facility_id','uuid'::regtype,true),
(to_regclass('public.laboratory_catalog_commands'),'request_key_hash','bytea'::regtype,true),
(to_regclass('public.laboratory_catalog_commands'),'actor_user_id','uuid'::regtype,true),
(to_regclass('public.laboratory_catalog_commands'),'subject_kind','text'::regtype,true),
(to_regclass('public.laboratory_catalog_commands'),'subject_id','uuid'::regtype,true),
(to_regclass('public.laboratory_catalog_commands'),'test_id','uuid'::regtype,false),
(to_regclass('public.laboratory_catalog_commands'),'panel_id','uuid'::regtype,false),
(to_regclass('public.laboratory_catalog_commands'),'payload_digest','bytea'::regtype,true),
(to_regclass('public.laboratory_catalog_commands'),'receipt','jsonb'::regtype,true),
(to_regclass('public.laboratory_catalog_commands'),'recorded_at','timestamptz'::regtype,true)),
required_functions(signature,result,volatility) AS(VALUES
('public.laboratory_catalog_identity_gate(text,uuid)','void'::regtype,'v'),
('public.laboratory_catalog_code_gate(text,uuid,text)','void'::regtype,'v'),
('public.laboratory_catalog_request_gate(uuid,uuid)','void'::regtype,'v'),
('public.laboratory_catalog_panel_gates(uuid[],boolean)','void'::regtype,'v'),
('public.laboratory_catalog_definition_guard()','trigger'::regtype,'v'),
('public.laboratory_catalog_membership_guard()','trigger'::regtype,'v'),
('public.laboratory_catalog_membership_changed()','trigger'::regtype,'v'),
('public.laboratory_order_test_source_guard()','trigger'::regtype,'v'),
('public.laboratory_catalog_receipt_valid(jsonb)','bool'::regtype,'i'),
('public.laboratory_catalog_command_guard()','trigger'::regtype,'v'),
('public.laboratory_catalog_command_complete_guard()','trigger'::regtype,'v'),
('public.laboratory_catalog_refresh_document(uuid,text,uuid)','void'::regtype,'v'),
('public.laboratory_catalog_search_guard()','trigger'::regtype,'v')),
required_triggers(relation,name,guard_function,kind,deferred) AS(VALUES
(to_regclass('public.lab_tests'),'laboratory_test_definition','public.laboratory_catalog_definition_guard()',31,false),
(to_regclass('public.lab_panels'),'laboratory_panel_definition','public.laboratory_catalog_definition_guard()',31,false),
(to_regclass('public.lab_panel_tests'),'laboratory_panel_membership','public.laboratory_catalog_membership_guard()',31,false),
(to_regclass('public.lab_panel_tests'),'laboratory_panel_membership_changed','public.laboratory_catalog_membership_changed()',29,false),
(to_regclass('public.lab_order_tests'),'laboratory_order_test_source','public.laboratory_order_test_source_guard()',23,false),
(to_regclass('public.laboratory_catalog_commands'),'laboratory_catalog_command_immutable','public.laboratory_catalog_command_guard()',31,false),
(to_regclass('public.laboratory_catalog_commands'),'laboratory_catalog_command_complete','public.laboratory_catalog_command_complete_guard()',5,true),
(to_regclass('public.lab_tests'),'laboratory_test_search','public.laboratory_catalog_search_guard()',21,false),
(to_regclass('public.lab_panels'),'laboratory_panel_search','public.laboratory_catalog_search_guard()',21,false)),
required_indexes(relation,name,is_unique,keys,options) AS(VALUES
(to_regclass('public.lab_tests'),'lab_tests_pkey',true,ARRAY['id']::text[],ARRAY[0]::smallint[]),
(to_regclass('public.lab_tests'),'lab_tests_facility_id_code_key',true,ARRAY['facility_id','code']::text[],ARRAY[0,0]::smallint[]),
(to_regclass('public.lab_panels'),'lab_panels_pkey',true,ARRAY['id']::text[],ARRAY[0]::smallint[]),
(to_regclass('public.lab_panels'),'lab_panels_facility_id_code_key',true,ARRAY['facility_id','code']::text[],ARRAY[0,0]::smallint[]),
(to_regclass('public.lab_panel_tests'),'lab_panel_tests_pkey',true,ARRAY['panel_id','test_id']::text[],ARRAY[0,0]::smallint[]),
(to_regclass('public.lab_order_tests'),'lab_order_tests_pkey',true,ARRAY['order_id','test_id']::text[],ARRAY[0,0]::smallint[]),
(to_regclass('public.lab_orders'),'lab_orders_pkey',true,ARRAY['id']::text[],ARRAY[0]::smallint[]),
(to_regclass('public.lab_tests'),'laboratory_test_administration_page_idx',false,ARRAY['facility_id','created_at','id']::text[],ARRAY[0,0,0]::smallint[]),
(to_regclass('public.lab_panels'),'laboratory_panel_administration_page_idx',false,ARRAY['facility_id','created_at','id']::text[],ARRAY[0,0,0]::smallint[]),
(to_regclass('public.laboratory_catalog_commands'),'laboratory_catalog_commands_pkey',true,ARRAY['facility_id','request_key_hash']::text[],ARRAY[0,0]::smallint[]),
(to_regclass('public.laboratory_catalog_commands'),'laboratory_catalog_commands_id_key',true,ARRAY['id']::text[],ARRAY[0]::smallint[]),
(to_regclass('public.laboratory_catalog_commands'),'laboratory_catalog_commands_history_idx',false,ARRAY['facility_id','subject_kind','subject_id','recorded_at','id']::text[],ARRAY[0,0,0,3,3]::smallint[])),
required_fks(relation,column_name,target,delete_action) AS(VALUES
(to_regclass('public.lab_tests'),'facility_id',to_regclass('public.facilities'),'r'),
(to_regclass('public.lab_panels'),'facility_id',to_regclass('public.facilities'),'r'),
(to_regclass('public.lab_panel_tests'),'panel_id',to_regclass('public.lab_panels'),'c'),
(to_regclass('public.lab_panel_tests'),'test_id',to_regclass('public.lab_tests'),'r'),
(to_regclass('public.lab_order_tests'),'order_id',to_regclass('public.lab_orders'),'c'),
(to_regclass('public.lab_order_tests'),'test_id',to_regclass('public.lab_tests'),'r'),
(to_regclass('public.lab_tests'),'catalog_changed_by_user_id',to_regclass('public.users'),'r'),
(to_regclass('public.lab_panels'),'catalog_changed_by_user_id',to_regclass('public.users'),'r'),
(to_regclass('public.laboratory_catalog_commands'),'facility_id',to_regclass('public.facilities'),'r'),
(to_regclass('public.laboratory_catalog_commands'),'actor_user_id',to_regclass('public.users'),'r'),
(to_regclass('public.laboratory_catalog_commands'),'test_id',to_regclass('public.lab_tests'),'r'),
(to_regclass('public.laboratory_catalog_commands'),'panel_id',to_regclass('public.lab_panels'),'r')),
required_checks(relation,name,expression) AS(VALUES
(to_regclass('public.lab_tests'),'laboratory_test_version_positive','(version > 0)'),
(to_regclass('public.lab_panels'),'laboratory_panel_version_positive','(version > 0)'),
(to_regclass('public.lab_panels'),'laboratory_panel_membership_generation_nonnegative','(membership_generation >= 0)'),
(to_regclass('public.laboratory_catalog_commands'),'laboratory_catalog_commands_request_key_hash_check','(octet_length(request_key_hash) = 32)'),
(to_regclass('public.laboratory_catalog_commands'),'laboratory_catalog_commands_payload_digest_check','(octet_length(payload_digest) = 32)'),
(to_regclass('public.laboratory_catalog_commands'),'laboratory_catalog_commands_receipt_check','(jsonb_typeof(receipt) = ''object''::text)'),
(to_regclass('public.laboratory_catalog_commands'),'laboratory_catalog_commands_subject_kind_check','(subject_kind = ANY (ARRAY[''test''::text, ''panel''::text]))'),
(to_regclass('public.laboratory_catalog_commands'),'laboratory_catalog_command_subject','(((subject_kind = ''test''::text) AND (test_id = subject_id) AND (test_id IS NOT NULL) AND (panel_id IS NULL)) OR ((subject_kind = ''panel''::text) AND (panel_id = subject_id) AND (panel_id IS NOT NULL) AND (test_id IS NULL)))') )
SELECT commands IS NOT NULL OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid IN(tests,panels) AND attname IN('version','catalog_changed_at','catalog_changed_by_user_id','membership_generation') AND NOT attisdropped),
tests IS NOT NULL AND panels IS NOT NULL AND commands IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM required_columns r WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=r.relation AND a.attname=r.name AND a.atttypid=r.kind AND a.attnotnull=r.required AND NOT a.attisdropped))
AND NOT EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid IN(tests,panels) AND a.attname IN('catalog_changed_at','catalog_changed_by_user_id'))
AND(SELECT count(*) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid IN(tests,panels) AND a.attname='version' AND pg_get_expr(d.adbin,d.adrelid)='1')=2
AND EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid=panels AND a.attname='membership_generation' AND pg_get_expr(d.adbin,d.adrelid)='0')
AND NOT EXISTS(SELECT 1 FROM required_functions r WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r.signature) AND p.prorettype=r.result AND p.prokind='f' AND NOT p.prosecdef AND NOT p.proisstrict AND p.proconfig IS NULL AND p.proparallel='u' AND p.provolatile::text=r.volatility AND p.pronargdefaults=0))
AND NOT EXISTS(SELECT 1 FROM required_triggers r WHERE NOT EXISTS(SELECT 1 FROM pg_trigger g WHERE g.tgrelid=r.relation AND g.tgname=r.name AND g.tgenabled IN('O','A') AND g.tgtype=r.kind AND g.tgdeferrable=r.deferred AND g.tginitdeferred=r.deferred AND g.tgargs=decode('','hex') AND g.tgfoid=to_regprocedure(r.guard_function) AND g.tgqual IS NULL AND(g.tgconstraint<>0)=r.deferred AND cardinality(g.tgattr::smallint[])=0))
AND NOT EXISTS(SELECT 1 FROM required_indexes r WHERE NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am a ON a.oid=c.relam WHERE i.indrelid=r.relation AND c.relname=r.name AND a.amname='btree' AND i.indisvalid AND i.indisready AND i.indisunique=r.is_unique AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=cardinality(r.keys) AND ARRAY(SELECT v FROM unnest(i.indoption::smallint[])v)=r.options AND(SELECT array_agg(a.attname::text ORDER BY k.ordinality) FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE k.ordinality<=i.indnkeyatts)=r.keys))
AND NOT EXISTS(SELECT 1 FROM required_fks r WHERE NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute source ON source.attrelid=c.conrelid AND source.attname=r.column_name JOIN pg_attribute target ON target.attrelid=c.confrelid AND target.attname='id' WHERE c.conrelid=r.relation AND c.confrelid=r.target AND c.contype='f' AND c.convalidated AND NOT c.condeferrable AND c.confdeltype::text=r.delete_action AND c.confkey=ARRAY[target.attnum]::smallint[] AND c.conkey=ARRAY[source.attnum]::smallint[]))
AND NOT EXISTS(SELECT 1 FROM required_checks r WHERE NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=r.relation AND c.conname=r.name AND c.contype='c' AND c.convalidated AND pg_get_expr(c.conbin,c.conrelid)=r.expression))
AND EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid=to_regclass('public.audit_events') AND c.relname='laboratory_catalog_audit_command_idx' AND i.indisvalid AND i.indisready AND NOT i.indisunique AND i.indnkeyatts=2 AND pg_get_indexdef(i.indexrelid,1,true)='facility_id' AND c.relam=(SELECT oid FROM pg_am WHERE amname='btree') AND pg_get_expr(i.indexprs,i.indrelid)='(metadata ->> ''command_id''::text)' AND pg_get_expr(i.indpred,i.indrelid)='(resource_type = ''laboratory_catalog''::text)')
FROM relations
"#).fetch_one(&mut **tx).await?;
    let applied: Option<(bool, Vec<u8>)> = if history {
        sqlx::query_as("SELECT success,checksum FROM public._sqlx_migrations WHERE version=$1")
            .bind(LABORATORY_CATALOG_BREAKING_EPOCH)
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
            if previous == INVENTORY_SUPPLIERS_BREAKING_EPOCH
                && committed_checksum(LABORATORY_CATALOG_BREAKING_EPOCH, &checksum) =>
        {
            Ok(LABORATORY_CATALOG_BREAKING_EPOCH)
        }
        _ => anyhow::bail!("Database schema compatibility could not be confirmed."),
    }
}
async fn exact_function_bodies(tx: &mut Transaction<'_, Postgres>) -> anyhow::Result<bool> {
    let source =
        include_str!("../../../../migrations/202611030033_laboratory_catalog_governance.sql");
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
