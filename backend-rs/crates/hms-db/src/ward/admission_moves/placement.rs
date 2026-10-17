use super::*;
#[derive(FromRow)]
struct Current {
    id: Uuid,
    placement_revision: i64,
    started_at: DateTime<Utc>,
    origin: String,
    legacy_unknown_prefix: bool,
}
pub(super) async fn current(
    tx: &mut Tx<'_>,
    actor: &AdmissionMoveActor,
    r: &Root,
) -> anyhow::Result<Option<AdmissionPlacementSnapshot>> {
    let row:Option<Current>=observe_db_query("ward.moves.placement.current",sqlx::query_as("SELECT id,placement_revision,started_at,origin,legacy_unknown_prefix FROM admission_placements WHERE facility_id=$1 AND admission_case_id=$2 AND patient_id=$3 AND ward_id=$4 AND bed_id=$5 AND ended_at IS NULL").bind(actor.facility_id).bind(r.id).bind(r.patient_id).bind(r.ward_id).bind(r.bed_id).fetch_optional(&mut **tx)).await?;
    row.map(|v| {
        Ok(AdmissionPlacementSnapshot {
            id: v.id,
            placement_revision: v.placement_revision,
            labels: r.labels()?,
            started_at: v.started_at,
            origin: codec::decode(&v.origin)?,
            legacy_unknown_prefix: v.legacy_unknown_prefix,
        })
    })
    .transpose()
}
/// Canonical activation/admit caller has already locked and updated its case/bed.
pub(crate) async fn open_activation_tx(
    tx: &mut Tx<'_>,
    facility: Uuid,
    case: Uuid,
    at: DateTime<Utc>,
) -> anyhow::Result<()> {
    let changed=observe_db_query("ward.moves.placement.activation",sqlx::query("INSERT INTO admission_placements(id,facility_id,admission_case_id,patient_id,ward_id,bed_id,placement_revision,started_at,origin,legacy_unknown_prefix) SELECT gen_random_uuid(),facility_id,id,patient_id,ward_id,bed_id,placement_revision,$3,'activation',false FROM admission_cases WHERE facility_id=$1 AND id=$2 AND status='admitted' AND bed_id IS NOT NULL AND placement_revision>0").bind(facility).bind(case).bind(at).execute(&mut **tx)).await?;
    if changed.rows_affected() != 1 {
        return Err(MoveError::SourceChanged.into());
    }
    observe_db_query("ward.moves.placement.coverage",sqlx::query("UPDATE admission_cases SET placement_known_from=COALESCE(placement_known_from,$3) WHERE facility_id=$1 AND id=$2").bind(facility).bind(case).bind(at).execute(&mut **tx)).await?;
    Ok(())
}
pub(crate) async fn close_discharge_tx(
    tx: &mut Tx<'_>,
    facility: Uuid,
    case: Uuid,
    discharge: Uuid,
    at: DateTime<Utc>,
) -> anyhow::Result<()> {
    observe_db_query("ward.moves.placement.discharge",sqlx::query("UPDATE admission_placements SET ended_at=$4,close_kind='discharge',closing_discharge_case_id=$3 WHERE facility_id=$1 AND admission_case_id=$2 AND ended_at IS NULL").bind(facility).bind(case).bind(discharge).bind(at).execute(&mut **tx)).await?;
    Ok(())
}
#[derive(Clone, FromRow)]
pub(super) struct Candidate {
    pub id: Uuid,
    pub ward_id: Uuid,
    pub ward_name: String,
    pub bed_code: String,
    pub section_id: Option<Uuid>,
    pub section_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub ward_updated_at: DateTime<Utc>,
    pub section_updated_at: Option<DateTime<Utc>>,
}
impl Candidate {
    pub(super) fn labels(&self) -> AdmissionPlacementLabels {
        AdmissionPlacementLabels {
            ward_id: self.ward_id,
            ward_name: self.ward_name.clone(),
            bed_id: self.id,
            bed_code: self.bed_code.clone(),
            section_id: self.section_id,
            section_name: self.section_name.clone(),
        }
    }
    pub(super) fn token(&self, actor: &AdmissionMoveActor, r: &Root) -> anyhow::Result<String> {
        token(&serde_json::json!([
            actor.facility_id,
            r.patient_id,
            r.id,
            r.placement_revision,
            self.id,
            self.ward_id,
            self.ward_name,
            self.bed_code,
            self.section_id,
            self.section_name,
            self.updated_at,
            self.ward_updated_at,
            self.section_updated_at
        ]))
    }
}
pub(super) const CANDIDATE_SELECT:&str="SELECT b.id,b.ward_id,w.name AS ward_name,b.bed_code,b.section_id,s.name AS section_name,b.created_at,b.updated_at,w.updated_at AS ward_updated_at,s.updated_at AS section_updated_at FROM beds b JOIN wards w ON w.id=b.ward_id AND w.facility_id=b.facility_id LEFT JOIN ward_sections s ON s.id=b.section_id AND s.facility_id=b.facility_id AND s.ward_id=b.ward_id WHERE b.facility_id=";
pub(super) async fn lock_resources(
    tx: &mut Tx<'_>,
    actor: &AdmissionMoveActor,
    r: &Root,
    destination: Uuid,
) -> anyhow::Result<Candidate> {
    // Do not block after holding reviewed children/case. Metadata publishers and
    // older case->bed writers may hold the opposite resource already.
    let target: Option<(Uuid, Option<Uuid>)> = observe_db_query(
        "ward.moves.destination.identity",
        sqlx::query_as("SELECT ward_id,section_id FROM beds WHERE facility_id=$1 AND id=$2")
            .bind(actor.facility_id)
            .bind(destination)
            .fetch_optional(&mut **tx),
    )
    .await?;
    let (target_ward, target_section) = target.ok_or(MoveError::DestinationChanged)?;
    let mut wards = vec![r.ward_id, target_ward];
    wards.sort();
    wards.dedup();
    let ward_rows:Vec<(Uuid,String)>=observe_db_query("ward.moves.lock.wards",sqlx::query_as("SELECT id,status FROM wards WHERE facility_id=$1 AND id=ANY($2) ORDER BY id FOR SHARE NOWAIT").bind(actor.facility_id).bind(&wards).fetch_all(&mut **tx)).await.map_err(lock_error)?;
    if ward_rows.len() != wards.len()
        || ward_rows
            .iter()
            .any(|(id, status)| *id == target_ward && status != "active")
    {
        return Err(MoveError::DestinationChanged.into());
    }
    let mut sections: Vec<Uuid> = r.section_id.into_iter().chain(target_section).collect();
    sections.sort();
    sections.dedup();
    if !sections.is_empty() {
        let rows:Vec<(Uuid,String)>=observe_db_query("ward.moves.lock.sections",sqlx::query_as("SELECT id,status FROM ward_sections WHERE facility_id=$1 AND id=ANY($2) ORDER BY id FOR SHARE NOWAIT").bind(actor.facility_id).bind(&sections).fetch_all(&mut **tx)).await.map_err(lock_error)?;
        if rows.len() != sections.len()
            || rows
                .iter()
                .any(|(id, status)| Some(*id) == target_section && status != "active")
        {
            return Err(MoveError::DestinationChanged.into());
        }
    }
    let mut beds = vec![r.bed_id.ok_or(MoveError::SourceChanged)?, destination];
    beds.sort();
    beds.dedup();
    let locked: Vec<Uuid> = observe_db_query(
        "ward.moves.lock.beds",
        sqlx::query_scalar(
            "SELECT id FROM beds WHERE facility_id=$1 AND id=ANY($2) ORDER BY id FOR UPDATE NOWAIT",
        )
        .bind(actor.facility_id)
        .bind(&beds)
        .fetch_all(&mut **tx),
    )
    .await
    .map_err(lock_error)?;
    if locked.len() != 2 {
        return Err(MoveError::DestinationChanged.into());
    }
    let mut q = sqlx::QueryBuilder::new(CANDIDATE_SELECT);
    q.push_bind(actor.facility_id).push(" AND b.id=").push_bind(destination).push(" AND b.status='available' AND w.status='active' AND (b.section_id IS NULL OR s.status='active') AND NOT EXISTS(SELECT 1 FROM admission_cases a WHERE a.facility_id=b.facility_id AND a.bed_id=b.id AND a.status IN('ready_for_activation','admitted','discharge_pending'))");
    observe_db_query(
        "ward.moves.destination.current",
        q.build_query_as::<Candidate>().fetch_optional(&mut **tx),
    )
    .await?
    .ok_or_else(|| MoveError::DestinationChanged.into())
}
