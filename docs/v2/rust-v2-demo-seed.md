# Rust V2 Production-Style Seed

The Rust V2 production-style clinical seed is selected with
`HMS_DEMO_SEED_PROFILE` and is separate from `HMS_PERF_SEED_SCALE`. It is
deterministic, demo-owned by `DEMO-*` patient/invoice/claim prefixes and fixed
UUID ranges, and blocked when `HMS_ENV=production`.

Profiles:

| Profile | Patients | Years | Purpose |
| --- | ---: | ---: | --- |
| `smoke` | 50 | 1 | Fast production-style sanity dataset; guarantees all legacy archetypes are present, then continues weighted generation. |
| `staging` | 150 | 1 | Useful local UI/demo dataset with active ward-round patients. |
| `small` | 500 | 2 | Bounded hundreds-scale production-like dataset for local development. |
| `medium` | 2,000 | 3 | Richer clinical workflow dataset for staging-scale product validation. |
| `large` | 10,000 | 5 | Large rich clinical workflow dataset modeled after the legacy production seeder. Use the performance seed only for synthetic load shape. |

Clinical seeding runs atomically: if a reseed fails, the previous demo-owned
graph remains in place instead of leaving a partially rebuilt facility. Treat
`large` as an intentional staging validation run on suitably provisioned
database capacity, not the routine load-test path; use `HMS_PERF_SEED_SCALE`
only for high-volume synthetic performance datasets.

The port covers the legacy production seeder's facility operating graph for the
active facility: nine departments, six department clinics, deterministic clinic
sessions, the nine-ward Ghanaian hospital catalog, and the legacy staff mix of
35 inactive staff users per facility (12 doctors, 16 nurses, 3 lab scientists, 2
pharmacists, and 2 receptionists). Doctor and nurse users receive practitioner
profiles, and patient journeys reference those staff actors rather than the
admin/owner user. The admin/owner keeps assigned patient context so existing
admin login and demo-patient access remain intact after reseeds.

The patient graph covers all legacy production archetypes with the same
production-seeder weights: `healthy_adult`, `hypertensive`, `diabetic`,
`chronic_complex`, `respiratory`, `surgical`, `maternity`, `pediatric`, and
`infectious`. Production-sized profiles can create multiple historical
admissions for high acuity archetypes; at most one seeded admission per patient
remains active. Outpatient and inpatient billing journeys use separate
deterministic sequence slots so invoice, receipt, claim, and invoice-line
identifiers remain stable and collision-free as history depth grows.

Journey mapping:

- Outpatient journeys create appointments linked to department clinic sessions,
  visits, encounters, encounter care team assignments, signed encounter-linked
  clinical notes, vitals/chart entries, prescriptions, lab
  orders/specimens/results, invoices, payments, and NHIS claims where
  appropriate. Receptionists check patients in and issue bills; doctors see
  patients, write notes, order labs, and prescribe; nurses record vitals; lab
  scientists collect and verify lab results.
- Inpatient journeys create admission cases, inpatient encounters, nursing
  tasks, medication administrations, treatment sheets, discharge cases where
  appropriate, active admissions, committed/draft ward rounds, ward-round
  actions, and ward-round artifact links. Attending doctors, ward nurses,
  pharmacists, and lab scientists are assigned from the seeded staff graph.
- Inpatient nursing operations also create numeric inpatient vitals,
  monitoring events, nursing alerts, fluid balance entries, ward stock requests,
  and shift handoffs so ward, nursing, and operational surfaces have realistic
  activity texture.
- Rust V2 stores care context on `clinical_notes`, `chart_entries`, new
  prescriptions, lab orders, admission/discharge cases, and billing rows through
  optional encounter/visit/admission fields. Older rows that predate those
  columns may still rely on deterministic encounter timing and patient journey
  sequence until they are backfilled.
