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
        'api_prefixes': [
            '/api/wards/allocation-logs/',
            '/api/wards/amenities/',
            '/api/wards/beds/',
            '/api/wards/transfers/',
        ],
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
    'ward_task_board': {
        'label': 'Ward clinical task board',
        'kind': 'subfeature',
        'profile_default': True,
        'api_prefixes': ['/api/ward-board/'],
        'optional_lanes': (
            'laboratory',
            'discharge_workflows',
            'pharmacy',
            'referrals',
        ),
    },

    # Operational modules
    'appointments': {
        'label': 'Appointments',
        'kind': 'module',
        'profile_default': True,
        'api_prefixes': ['/api/appointments/'],
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
        'api_prefixes': ['/api/referrals/'],
    },
    'clinical_notes': {
        'label': 'Clinical notes',
        'kind': 'module',
        'profile_default': True,
        'api_prefixes': ['/api/charts/', '/api/clinical-notes/'],
    },
    'problem_list': {
        'label': 'Problem list',
        'kind': 'module',
        'profile_default': True,
        'api_prefixes': ['/api/problems/'],
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


COMMERCIAL_CONTRACTS = {
    'core': 'Included in every deployment; not separately sellable.',
    'platform': 'Platform capability or guardrail; controlled by deployment tier.',
    'sellable_module': 'Commercial module that can be sold and entitled.',
    'sellable_add_on': 'Commercial add-on that depends on another module.',
    'integration_add_on': 'External-system integration add-on.',
    'ai_add_on': 'AI add-on that depends on clinical module entitlement.',
}


FEATURE_CONTRACT = {
    # Core product baseline
    'patient_registration': {
        'contract': 'core',
        'sellable': False,
        'toggleable': False,
    },
    'patient_chronicle': {
        'contract': 'core',
        'sellable': False,
        'toggleable': False,
    },
    'audit': {
        'contract': 'core',
        'sellable': False,
        'toggleable': False,
    },

    # Platform tier controls
    'facility_context_required': {
        'contract': 'platform',
        'sellable': False,
        'toggleable': True,
    },
    'multi_facility': {
        'contract': 'platform',
        'sellable': False,
        'toggleable': True,
    },
    'facility_switcher': {
        'contract': 'platform',
        'sellable': False,
        'toggleable': True,
    },
    'cross_facility_access': {
        'contract': 'platform',
        'sellable': False,
        'toggleable': True,
    },

    # Sellable care and operations modules
    'outpatient_encounters': {
        'contract': 'sellable_module',
        'sellable': True,
        'toggleable': True,
    },
    'inpatient_admissions': {
        'contract': 'sellable_module',
        'sellable': True,
        'toggleable': True,
    },
    'wards': {
        'contract': 'sellable_module',
        'sellable': True,
        'toggleable': True,
    },
    'emergency_encounters': {
        'contract': 'sellable_module',
        'sellable': True,
        'toggleable': True,
    },
    'nursing_workflows': {
        'contract': 'sellable_module',
        'sellable': True,
        'toggleable': True,
    },
    'appointments': {
        'contract': 'sellable_module',
        'sellable': True,
        'toggleable': True,
    },
    'billing': {
        'contract': 'sellable_module',
        'sellable': True,
        'toggleable': True,
    },
    'inventory': {
        'contract': 'sellable_module',
        'sellable': True,
        'toggleable': True,
    },
    'laboratory': {
        'contract': 'sellable_module',
        'sellable': True,
        'toggleable': True,
    },
    'pharmacy': {
        'contract': 'sellable_module',
        'sellable': True,
        'toggleable': True,
    },
    'referrals': {
        'contract': 'sellable_module',
        'sellable': True,
        'toggleable': True,
    },
    'clinical_notes': {
        'contract': 'sellable_module',
        'sellable': True,
        'toggleable': True,
    },
    'problem_list': {
        'contract': 'sellable_module',
        'sellable': True,
        'toggleable': True,
    },

    # Sellable add-ons
    'outpatient_active_clinic_required': {
        'contract': 'platform',
        'sellable': False,
        'toggleable': True,
    },
    'department_rosters': {
        'contract': 'sellable_add_on',
        'sellable': True,
        'toggleable': True,
    },
    'bed_management': {
        'contract': 'sellable_add_on',
        'sellable': True,
        'toggleable': True,
    },
    'discharge_workflows': {
        'contract': 'sellable_add_on',
        'sellable': True,
        'toggleable': True,
    },
    'ward_task_board': {
        'contract': 'sellable_add_on',
        'sellable': True,
        'toggleable': True,
    },
    'insurance_claims': {
        'contract': 'sellable_add_on',
        'sellable': True,
        'toggleable': True,
    },
    'cross_facility_referrals': {
        'contract': 'sellable_add_on',
        'sellable': True,
        'toggleable': True,
    },
    'cross_facility_record_exchange': {
        'contract': 'sellable_add_on',
        'sellable': True,
        'toggleable': True,
    },

    # Integrations and AI
    'fhir_claims': {
        'contract': 'integration_add_on',
        'sellable': True,
        'toggleable': True,
    },
    'ai_omni_nl': {
        'contract': 'ai_add_on',
        'sellable': True,
        'toggleable': True,
    },
    'ai_chronicle_copilot': {
        'contract': 'ai_add_on',
        'sellable': True,
        'toggleable': True,
    },
}


FEATURE_DEPENDENCIES = {
    'facility_switcher': ('multi_facility',),
    'cross_facility_referrals': ('cross_facility_access', 'referrals'),
    'cross_facility_record_exchange': ('cross_facility_access',),
    'outpatient_encounters': ('patient_registration', 'patient_chronicle'),
    'outpatient_active_clinic_required': ('outpatient_encounters',),
    'department_rosters': ('outpatient_encounters',),
    'inpatient_admissions': ('patient_registration', 'patient_chronicle', 'wards'),
    'wards': ('patient_chronicle',),
    'bed_management': ('wards',),
    'nursing_workflows': ('patient_chronicle', 'wards'),
    'discharge_workflows': (
        'inpatient_admissions',
        'wards',
        'clinical_notes',
    ),
    'ward_task_board': (
        'patient_chronicle',
        'wards',
        'inpatient_admissions',
        'nursing_workflows',
    ),
    'appointments': ('patient_registration',),
    'billing': ('patient_registration',),
    'insurance_claims': ('billing',),
    'fhir_claims': ('billing', 'insurance_claims'),
    'laboratory': ('patient_chronicle',),
    'pharmacy': ('patient_chronicle',),
    'referrals': ('patient_registration',),
    'clinical_notes': ('patient_chronicle',),
    'problem_list': ('patient_chronicle',),
    'ai_omni_nl': ('patient_chronicle',),
    'ai_chronicle_copilot': ('patient_chronicle', 'clinical_notes'),
}


NON_TOGGLEABLE_FEATURES = tuple(
    feature_key
    for feature_key, contract in FEATURE_CONTRACT.items()
    if not contract['toggleable']
)


SELLABLE_MODULES = tuple(
    feature_key
    for feature_key, contract in FEATURE_CONTRACT.items()
    if contract['sellable']
)


for _feature_key, _contract in FEATURE_CONTRACT.items():
    FEATURE_MANIFEST[_feature_key].update(_contract)

for _feature_key, _dependencies in FEATURE_DEPENDENCIES.items():
    FEATURE_MANIFEST[_feature_key]['depends_on'] = _dependencies


CLINIC_DISABLED_FEATURES = (
    'department_rosters',
    'inpatient_admissions',
    'wards',
    'bed_management',
    'nursing_workflows',
    'discharge_workflows',
    'ward_task_board',
    'cross_facility_referrals',
    'cross_facility_record_exchange',
)

HOSPITAL_NETWORK_ENABLED_FEATURES = (
    'multi_facility',
    'facility_switcher',
    'cross_facility_access',
    'cross_facility_referrals',
    'cross_facility_record_exchange',
)

PRODUCT_TIER_PROFILES = {
    'clinic': {
        'label': 'Clinic',
        'facility_scope': 'single',
        'description': 'Lean single-site outpatient deployment.',
        'features': {
            'outpatient_active_clinic_required': False,
            **{feature_key: False for feature_key in CLINIC_DISABLED_FEATURES},
        },
    },
    'hospital': {
        'label': 'Hospital',
        'facility_scope': 'single',
        'description': 'Single hospital deployment with full inpatient and outpatient workflows.',
        'features': {},
    },
    'hospital_network': {
        'label': 'Hospital Network',
        'facility_scope': 'network',
        'description': 'Multi-facility deployment with network-level sharing and administration.',
        'features': {
            feature_key: True
            for feature_key in HOSPITAL_NETWORK_ENABLED_FEATURES
        },
    },
}


PROFILE_FEATURE_OVERRIDES = {
    profile_key: dict(profile['features'])
    for profile_key, profile in PRODUCT_TIER_PROFILES.items()
}


def feature_keys():
    return tuple(FEATURE_MANIFEST.keys())


def base_feature_defaults():
    return {
        key: bool(config.get('profile_default', False))
        for key, config in FEATURE_MANIFEST.items()
    }


def feature_dependency_map():
    return {
        key: tuple(config.get('depends_on', ()))
        for key, config in FEATURE_MANIFEST.items()
        if config.get('depends_on')
    }


def non_toggleable_feature_keys():
    return NON_TOGGLEABLE_FEATURES


def sellable_module_keys():
    return SELLABLE_MODULES


def api_feature_prefixes():
    prefixes = []
    for feature_key, config in FEATURE_MANIFEST.items():
        for prefix in config.get('api_prefixes', ()):
            prefixes.append((prefix, feature_key))
    return tuple(sorted(prefixes, key=lambda item: len(item[0]), reverse=True))
