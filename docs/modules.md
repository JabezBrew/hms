# HMS Commercial Module Contract

The active Rust V2 capability registry lives in
`backend-rs/crates/hms-domain/src/capabilities.rs` and
`backend-rs/crates/hms-domain/src/deployment.rs`.

This document is commercial/module-planning reference. It was originally
mirrored from the legacy Django feature manifest and still contains historical
sellable-module keys that may not map one-to-one to Rust V2 `FeatureKey` values.
Do not infer backend behavior from this file; update `hms-domain` first, then
revise this planning contract. Treat the old
`backend/hms_backend/feature_manifest.py` as reference only unless the task
explicitly asks for legacy Django maintenance.

## Contract Categories

- `core`: included in every deployment and not toggleable.
- `platform`: deployment-tier capability or guardrail.
- `sellable_module`: independently sellable module.
- `sellable_add_on`: sellable add-on that requires another module/capability.
- `integration_add_on`: external integration add-on.
- `ai_add_on`: AI add-on that requires clinical module entitlement.

## Non-Toggleable Core

- `patient_registration`
- `patient_chronicle`
- `audit`

Attempts to disable these keys are normalized back to enabled.

## Sellable Keys

- `outpatient_encounters`
- `inpatient_admissions`
- `wards`
- `emergency_encounters`
- `nursing_workflows`
- `appointments`
- `billing`
- `inventory`
- `laboratory`
- `pharmacy`
- `referrals`
- `clinical_notes`
- `department_rosters`
- `bed_management`
- `discharge_workflows`
- `insurance_claims`
- `cross_facility_referrals`
- `cross_facility_record_exchange`
- `fhir_claims`
- `ai_omni_nl`
- `ai_chronicle_copilot`

## Dependency Rules

Dependent features fail closed. If a dependency is disabled, the dependent
feature is normalized to disabled.

- `facility_switcher` requires `multi_facility`
- `cross_facility_referrals` requires `cross_facility_access`, `referrals`
- `cross_facility_record_exchange` requires `cross_facility_access`
- `outpatient_encounters` requires `patient_registration`, `patient_chronicle`
- `outpatient_active_clinic_required` requires `outpatient_encounters`
- `department_rosters` requires `outpatient_encounters`
- `inpatient_admissions` requires `patient_registration`, `patient_chronicle`, `wards`
- `wards` requires `patient_chronicle`
- `bed_management` requires `wards`
- `nursing_workflows` requires `patient_chronicle`, `wards`
- `discharge_workflows` requires `inpatient_admissions`, `wards`, `clinical_notes`
- `appointments` requires `patient_registration`
- `billing` requires `patient_registration`
- `insurance_claims` requires `billing`
- `fhir_claims` requires `billing`, `insurance_claims`
- `laboratory` requires `patient_chronicle`
- `pharmacy` requires `patient_chronicle`
- `referrals` requires `patient_registration`
- `clinical_notes` requires `patient_chronicle`
- `ai_omni_nl` requires `patient_chronicle`
- `ai_chronicle_copilot` requires `patient_chronicle`, `clinical_notes`

`cross_facility_access` intentionally does not require `multi_facility`; platform
administrators can have cross-facility entitlement without enabling the
multi-facility UX mode.
