# Fluid access and authority lifetime

This phase applies the active nursing authority contract to both fluid API families. It changes access and care-context safety, while retaining the existing append-only correction/void evidence, effective totals, facility rules, UTC day policy, and exact request receipts.

## Visibility and ward scope

All fluid patient operations require the Nursing feature, explicit facility `nursing.task.manage`, demographic patient access, and an actual current admission-ward relationship. Full clinical visibility is required for observation rows, narrative metadata, correction reasons, detail/history, category totals, derived assessments, and every patient write. It is also required for the legacy entry list, which contains patient display fields.

Clinical summary visibility deliberately permits only the scalar compatibility endpoints:

- `GET /api/v2/nursing/fluid-balance/summary`
- `GET /api/v2/nursing/fluid-balance/trends`

Those responses contain counts, measured intake/output, net volume, and UTC dates. They do not expose notes, categories, actors, names, correction reasons or derived rule assessments. Demographic-only visibility does not permit scalar clinical measurements.

Ward access means an active ward assignment or existing explicit all-ward authority. Lists and aggregates join each entry to its actual same-facility, same-patient admission and apply that admission's current ward before pagination or aggregation. These older observations have no captured historical ward; the API does not invent one. Explicit admission scope is verified and locked even when it currently contains no fluid rows. Patient history includes only admissions within current ward authority. Recorded-time ranges use indexed half-open `[from, before)` comparisons; UTC day conversion is used for trend grouping. Every page is bounded and uses one shaped data query; no per-row access queries are added. Query count remains constant with page size, which does not claim a constant number of scanned rows or a measured latency percentile.

## Fresh admission context

`GET /api/v2/nursing/fluid-observations/context` accepts exactly `patient_id` and `admission_case_id`. After current Full/nursing/patient/ward proof, it returns only those identities, the saved admission status, and `can_record_observation`. The boolean requires an admitted/discharge-pending admission, an active local ward, and current offsite write eligibility. It is a current UI fact, not permission to bypass the locked checks during a later POST.

Both create DTOs accept an optional reviewed `patient_id` for compatibility; the active UI supplies it. A mismatch is rejected before inserting anything. New observations require the locked admission to remain active and local to the same patient. Historical discharged observations remain readable and correctable/voidable under current authority. All-history has no implicit active-admission write target.

## Proof after waits

Handlers extract mandatory `NetworkContext`, including the resolved authorization deadline. Repositories carry an exact session/version/profile proof and cap it at the refresh session's actual expiry. Source reads acquire the fluid root `FOR SHARE`; changes acquire it `FOR UPDATE`, then prove the facility, active actor, session, feature and current ward/admission relationship. Lists and aggregates use the same proof and scope before their shaped data query. Authority is checked using the database clock after waits and immediately before commit. Revoked sessions, changed permission/session versions, expired managed authority, disabled features and withdrawn assignments cannot use an earlier HTTP decision to expose narrative or commit a write.

Facility feature writers and these readers share the existing parent-facility lock ordering. No optional/unverified actor path is exposed by active HTTP services. Older pool-only repository helpers remain for trusted fixtures/import compatibility; active routes call mandatory actor variants.

Exact UUID/actor/payload replay still returns the original immutable result pointer after later corrections or admission closure. It still requires current access and current session authority. An absent optional reviewed patient field is omitted when hashing a create command, preserving the old command digest shape. No request key is fabricated for the legacy non-idempotent create route. Unknown write responses retain the existing `fluid_write_unconfirmed` review contract.

## Facility monitoring configuration

Rule publication requires explicit `admin.authority.manage` and the Admin feature. It does not infer Nursing, patient or FullClinical permission. A separate locked administrative session/version/profile/feature proof is checked after waits and before commit. Existing optimistic rule version, bounded reason, immutable version history, actor/payload/UUID replay and atomic audit are retained. Rule settings can be read with this administrative authority or the existing Nursing workflow authority. This configuration read does not expose patient observations.

## Validation boundary

Owned typed queries and bodies reject unsupported fields with a generic PHI-free `400`; rejected values are never echoed. No schema migration or deployment setting is required. This phase adds no threshold defaults, signing, new alert delivery, patient narrative exports, or clinical decision automation.

## Regression evidence

Focused tests exercise disjoint wards with 125 newer excluded observations, complete scalar/category aggregates, stable cursor pages, actual current-ward transfer, active versus historical context, wrong reviewed patient, no-write closure waits, session revocation and natural managed-permission expiry during root waits, admin-only rules without Nursing/Full, rule deadline waits, exact immutable replay, audit rollback, paired legacy evidence, effective counters and existing monitoring semantics. Full acceptance is performed on the parent's frozen source snapshot after independent review.

Focused final-source validation: 12 repository tests and 12 actual HTTP tests passed. Owned Rust formatting and diff checks passed. Independent source review reported no remaining blocker; full snapshot acceptance remains the parent's release gate.
