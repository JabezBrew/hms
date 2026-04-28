"""
Declarative product-tier feature manifest.

This file is import-safe during Django settings initialization. Keep it free of
Django model imports.
"""

FEATURE_MANIFEST = {
    # Tenancy and facility scope
    'facility_context_required': {
        'label': 'Facility context required',
        'kind': 'platform',
        'profile_default': True,
    },
    'multi_facility': {
        'label': 'Multi-facility mode',
        'kind': 'platform',
        'profile_default': False,
    },
    'facility_switcher': {
        'label': 'Facility switcher',
        'kind': 'platform',
        'profile_default': False,
    },
    'cross_facility_access': {
        'label': 'Cross-facility access',
        'kind': 'platform',
        'profile_default': False,
    },
    'cross_facility_referrals': {
        'label': 'Cross-facility referrals',
        'kind': 'subfeature',
        'profile_default': False,
        'api_prefixes': ['/api/consent/'],
    },
    'cross_facility_record_exchange': {
        'label': 'Cross-facility record exchange',
        'kind': 'subfeature',
        'profile_default': False,
        'api_prefixes': ['/api/interop/'],
    },

    # Care delivery
    'patient_registration': {
        'label': 'Patient registration',
        'kind': 'module',
        'profile_default': True,
    },
    'patient_chronicle': {
        'label': 'Patient chronicle',
        'kind': 'module',
        'profile_default': True,
    },
    'outpatient_encounters': {
        'label': 'Outpatient encounters',
        'kind': 'module',
        'profile_default': True,
    },
    'outpatient_active_clinic_required': {
        'label': 'Active clinic schedule required',
        'kind': 'subfeature',
        'profile_default': True,
    },
    'department_rosters': {
        'label': 'Department rosters',
        'kind': 'subfeature',
        'profile_default': True,
        'api_prefixes': [
            '/api/organization/department-duty-types/',
            '/api/organization/on-duty/',
            '/api/organization/roster/',
            '/api/organization/rotation-rules/',
            '/api/organization/validation-rules/',
        ],
    },
    'inpatient_admissions': {
        'label': 'Inpatient admissions',
        'kind': 'module',
        'profile_default': True,
        'api_prefixes': ['/api/admissions/', '/api/dashboards/inpatient/'],
    },
    'wards': {
        'label': 'Wards and beds',
        'kind': 'module',
        'profile_default': True,
        'api_prefixes': [
            '/api/organization/ward-allocations/',
            '/api/wards/',
            '/api/workflows/ward-round',
        ],
    },
    'bed_management': {
        'label': 'Bed management',
        'kind': 'subfeature',
        'profile_default': True,
    },
    'emergency_encounters': {
        'label': 'Emergency encounters',
        'kind': 'module',
        'profile_default': True,
    },
    'nursing_workflows': {
        'label': 'Nursing workflows',
        'kind': 'module',
        'profile_default': True,
        'api_prefixes': ['/api/dashboards/nurse/', '/api/nursing/'],
    },
    'discharge_workflows': {
        'label': 'Discharge workflows',
        'kind': 'subfeature',
        'profile_default': True,
        'api_prefixes': ['/api/discharges/', '/api/workflows/discharge'],
    },

    # Operational modules
    'appointments': {
        'label': 'Appointments',
        'kind': 'module',
        'profile_default': True,
        'api_prefixes': ['/api/appointments/'],
        'celery_beat_jobs': ['generate-slots-weekly'],
    },
    'billing': {
        'label': 'Billing',
        'kind': 'module',
        'profile_default': True,
        'api_prefixes': ['/api/billing/'],
    },
    'insurance_claims': {
        'label': 'Insurance claims',
        'kind': 'subfeature',
        'profile_default': True,
        'parent': 'billing',
    },
    'fhir_claims': {
        'label': 'FHIR claims',
        'kind': 'integration',
        'profile_default': False,
        'parent': 'billing',
    },
    'inventory': {
        'label': 'Inventory',
        'kind': 'module',
        'profile_default': True,
        'api_prefixes': ['/api/inventory/'],
    },
    'laboratory': {
        'label': 'Laboratory',
        'kind': 'module',
        'profile_default': True,
        'api_prefixes': ['/api/laboratory/'],
    },
    'pharmacy': {
        'label': 'Pharmacy',
        'kind': 'module',
        'profile_default': True,
        'api_prefixes': ['/api/pharmacy/'],
    },
    'referrals': {
        'label': 'Referrals',
        'kind': 'module',
        'profile_default': True,
    },
    'clinical_notes': {
        'label': 'Clinical notes',
        'kind': 'module',
        'profile_default': True,
        'api_prefixes': ['/api/charts/', '/api/clinical-notes/'],
    },
    'audit': {
        'label': 'Audit logs',
        'kind': 'platform',
        'profile_default': True,
        'api_prefixes': ['/api/admin/audit-logs/'],
    },
    'ai_omni_nl': {
        'label': 'AI natural-language search',
        'kind': 'subfeature',
        'profile_default': False,
    },
    'ai_chronicle_copilot': {
        'label': 'AI chronicle copilot',
        'kind': 'subfeature',
        'profile_default': False,
    },
}


PROFILE_FEATURE_OVERRIDES = {
    'clinic': {
        'outpatient_active_clinic_required': False,
        'department_rosters': False,
        'inpatient_admissions': False,
        'wards': False,
        'bed_management': False,
        'nursing_workflows': False,
        'discharge_workflows': False,
        'cross_facility_referrals': False,
        'cross_facility_record_exchange': False,
    },
    'hospital': {},
    'hospital_network': {
        'multi_facility': True,
        'facility_switcher': True,
        'cross_facility_access': True,
        'cross_facility_referrals': True,
        'cross_facility_record_exchange': True,
    },
}


def feature_keys():
    return tuple(FEATURE_MANIFEST.keys())


def base_feature_defaults():
    return {
        key: bool(config.get('profile_default', False))
        for key, config in FEATURE_MANIFEST.items()
    }


def api_feature_prefixes():
    prefixes = []
    for feature_key, config in FEATURE_MANIFEST.items():
        for prefix in config.get('api_prefixes', ()):
            prefixes.append((prefix, feature_key))
    return tuple(prefixes)
