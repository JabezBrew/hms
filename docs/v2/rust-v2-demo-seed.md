# Rust V2 Production-Style Seed

The Rust V2 production-style clinical seed is selected with
`HMS_DEMO_SEED_PROFILE` and is separate from `HMS_PERF_SEED_SCALE`. It is
deterministic, demo-owned by `DEMO-*` patient/invoice/claim prefixes and fixed
UUID ranges, and blocked when `HMS_ENV=production`.

Profiles:

| Profile | Patients | Years | Purpose |
| --- | ---: | ---: | --- |
| `smoke` | 9 | 1 | One patient per legacy archetype with longitudinal sanity coverage. |
| `staging` | 150 | 1 | Useful local UI/demo dataset with active ward-round patients. |
| `small` | 500 | 2 | Bounded hundreds-scale production-like dataset for local development. |
| `medium` | 2,000 | 3 | Richer clinical workflow dataset for staging-scale product validation. |
| `large` | 10,000 | 5 | Large rich clinical workflow dataset modeled after the legacy production seeder. Use the performance seed only for synthetic load shape. |

Clinical seeding runs atomically: if a reseed fails, the previous demo-owned
graph remains in place instead of leaving a partially rebuilt facility. Treat
`large` as an intentional staging validation run on suitably provisioned
database capacity, not the routine load-test path; use `HMS_PERF_SEED_SCALE`
only for high-volume synthetic performance datasets.

The port covers all legacy production archetypes with the same production-seeder
weights: `healthy_adult`, `hypertensive`, `diabetic`, `chronic_complex`,
`respiratory`, `surgical`, `maternity`, `pediatric`, and `infectious`.
Production-sized profiles can create multiple historical admissions for high
acuity archetypes; at most one seeded admission per patient remains active.

Journey mapping:

- Outpatient journeys create appointments, visits, encounters, encounter care
  team assignments, signed encounter-linked clinical notes, vitals/chart
  entries, prescriptions, lab orders/specimens/results, invoices, payments, and
  NHIS claims where appropriate.
- Inpatient journeys create admission cases, inpatient encounters, nursing
  tasks, medication administrations, treatment sheets, discharge cases where
  appropriate, active admissions, committed/draft ward rounds, ward-round
  actions, and ward-round artifact links.
- Inpatient nursing operations also create numeric inpatient vitals,
  monitoring events, nursing alerts, fluid balance entries, ward stock requests,
  and shift handoffs so ward, nursing, and operational surfaces have realistic
  activity texture.
- Rust V2 stores care context on `clinical_notes` and, for newly recorded
  observations, on `chart_entries` through optional `encounter_id`/`visit_id`.
  `prescriptions`, `lab_orders`, and billing rows do not yet have encounter
  foreign keys. The seed aligns those rows by deterministic encounter timing and
  patient journey sequence.
