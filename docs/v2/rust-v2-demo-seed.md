# Rust V2 Demo Seed

The Rust V2 demo seed is selected with `HMS_DEMO_SEED_PROFILE` and is separate
from `HMS_PERF_SEED_SCALE`. It is deterministic, demo-owned by `DEMO-*`
patient/invoice/claim prefixes and fixed UUID ranges, and blocked when
`HMS_ENV=production`.

Profiles:

| Profile | Patients | Years | Purpose |
| --- | ---: | ---: | --- |
| `smoke` | 9 | 1 | One patient per legacy archetype with longitudinal sanity coverage. |
| `staging` | 90 | 1 | Useful local UI/demo dataset with active ward-round patients. |
| `small` | 270 | 2 | Bounded hundreds-scale legacy-like dataset for local development. |

The port covers all legacy archetypes: `healthy_adult`, `hypertensive`,
`diabetic`, `chronic_complex`, `respiratory`, `surgical`, `maternity`,
`pediatric`, and `infectious`.

Journey mapping:

- Outpatient journeys create appointments, visits, encounters, encounter care
  team assignments, signed encounter-linked clinical notes, vitals/chart
  entries, prescriptions, lab orders/specimens/results, invoices, payments, and
  NHIS claims where appropriate.
- Inpatient journeys create admission cases, inpatient encounters, nursing
  tasks, medication administrations, treatment sheets, discharge cases where
  appropriate, active admissions, committed/draft ward rounds, ward-round
  actions, and ward-round artifact links.
- Rust V2 currently stores `encounter_id` on `clinical_notes`; `chart_entries`,
  `prescriptions`, `lab_orders`, and billing rows do not yet have encounter
  foreign keys. The seed aligns those rows by deterministic encounter timing and
  patient journey sequence, and clinical notes are the direct encounter-linked
  Chronicle artifact.
