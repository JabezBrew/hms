import re
from rest_framework.exceptions import PermissionDenied

from apps.ai.constants import FEATURE_OMNI_NL
from apps.ai.services import policy
from apps.core.security import check_clinical_access, check_demographics_access, check_lab_access
from apps.users.models import PatientProfile


_UUID_PATTERN = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
)
_MRN_PATTERN = re.compile(r"\b[A-Z]{2,6}-?\d{4,}\b")
_PATIENT_QUERY_PATTERN = re.compile(r"(?:patient|pt)\s+(?P<query>[^,;]+)", re.IGNORECASE)

CLINICAL_ROLES = {
    'doctor',
    'nurse',
    'head_nurse',
    'nurse_practitioner',
    'physician',
    'practitioner',
    'inpatient_doctor',
}

ROUTE_SCOPE_BY_PATH_PREFIX = {
    '/patients': 'patients',
    '/laboratory': 'laboratory',
    '/encounters': 'encounters',
    '/appointments': 'appointments',
    '/admissions': 'admissions',
    '/wards': 'wards',
    '/billing': 'billing',
    '/inbox': 'inbox',
    '/staff': 'staff',
    '/settings': 'settings',
    '/workflows': 'workflows',
}

_ALLOWED_ROUTE_SCOPES_BY_ROLE = {
    'admin': {
        'patients',
        'laboratory',
        'encounters',
        'appointments',
        'admissions',
        'wards',
        'billing',
        'inbox',
        'staff',
        'settings',
        'workflows',
    },
    'doctor': {'patients', 'laboratory', 'encounters', 'appointments', 'admissions', 'wards', 'inbox', 'settings', 'workflows'},
    'nurse': {'patients', 'laboratory', 'encounters', 'appointments', 'admissions', 'wards', 'inbox', 'settings', 'workflows'},
    'head_nurse': {'patients', 'laboratory', 'encounters', 'appointments', 'admissions', 'wards', 'inbox', 'settings', 'workflows'},
    'nurse_practitioner': {'patients', 'laboratory', 'encounters', 'appointments', 'admissions', 'wards', 'inbox', 'settings', 'workflows'},
    'physician': {'patients', 'laboratory', 'encounters', 'appointments', 'admissions', 'wards', 'inbox', 'settings', 'workflows'},
    'practitioner': {'patients', 'laboratory', 'encounters', 'appointments', 'admissions', 'wards', 'inbox', 'settings', 'workflows'},
    'inpatient_doctor': {'patients', 'laboratory', 'encounters', 'appointments', 'admissions', 'wards', 'inbox', 'settings', 'workflows'},
    'receptionist': {'patients', 'appointments', 'admissions', 'settings'},
    'lab_technician': {'laboratory', 'settings'},
    'billing': {'patients', 'billing', 'settings'},
    'patient': {'patients', 'settings'},
}


def normalize_omni_text(raw_text: str) -> str:
    return ' '.join(str(raw_text or '').strip().split())


def _resolve_route_scope(path: str) -> str | None:
    for prefix, scope in ROUTE_SCOPE_BY_PATH_PREFIX.items():
        if path.startswith(prefix):
            return scope
    return None


def _extract_entities(normalized_text: str) -> dict:
    entities = {}

    uuid_match = _UUID_PATTERN.search(normalized_text)
    if uuid_match:
        entities['patient_id'] = uuid_match.group(0)

    mrn_match = _MRN_PATTERN.search(normalized_text.upper())
    if mrn_match:
        entities['mrn'] = mrn_match.group(0)

    patient_query_match = _PATIENT_QUERY_PATTERN.search(normalized_text)
    if patient_query_match:
        patient_query = patient_query_match.group('query').strip()
        if patient_query:
            entities['patient_query'] = patient_query

    return entities


def parse_omni_intent(raw_text: str) -> dict:
    normalized_text = normalize_omni_text(raw_text)
    lowered = normalized_text.lower()
    entities = _extract_entities(normalized_text)

    intent_type = 'search.global'
    target_route = {'path': '/patients', 'query': {'q': normalized_text}}
    confidence = 0.55

    # Sensitive intents first.
    if 'break glass' in lowered:
        intent_type = 'break_glass.open'
        target_route = {'path': '/patients', 'query': {'q': entities.get('patient_query', '')}}
        confidence = 0.92
    elif re.search(r'\b(submit|file|send)\s+claim\b', lowered):
        intent_type = 'billing_submit.claim'
        target_route = {'path': '/billing/claims', 'query': {}}
        confidence = 0.90
    elif re.search(r'\b(change|grant|revoke)\s+role\b|\bgrant\s+admin\b', lowered):
        intent_type = 'role_change.update'
        target_route = {'path': '/staff', 'query': {}}
        confidence = 0.88
    elif re.search(r'\b(change|update)\s+admin\s+permission', lowered):
        intent_type = 'admin_change.permissions'
        target_route = {'path': '/staff', 'query': {}}
        confidence = 0.88
    elif re.search(r'\b(export|share|print)\b.*\b(record|chart|patient|phi)\b', lowered):
        intent_type = 'phi_export.records'
        target_route = {'path': '/patients', 'query': {'q': entities.get('patient_query', '')}}
        confidence = 0.88
    elif re.search(r'\b(delete|remove|cancel)\b', lowered):
        intent_type = 'delete.record'
        confidence = 0.84
        if 'appointment' in lowered:
            target_route = {'path': '/appointments', 'query': {'q': entities.get('patient_query', normalized_text)}}
        elif 'encounter' in lowered:
            target_route = {'path': '/encounters', 'query': {'q': entities.get('patient_query', normalized_text)}}
        else:
            target_route = {'path': '/patients', 'query': {'q': entities.get('patient_query', normalized_text)}}
    elif re.search(r'\b(sign|approve)\b', lowered):
        intent_type = 'sign.record'
        target_route = {'path': '/inbox', 'query': {}}
        confidence = 0.84
    elif re.search(r'\b(prescrib|medication|rx\b)\b', lowered):
        intent_type = 'medication.create'
        target_route = {'path': '/patients', 'query': {'q': entities.get('patient_query', normalized_text)}}
        confidence = 0.86
    elif re.search(r'\border\b', lowered):
        intent_type = 'order.create'
        if 'lab' in lowered or 'test' in lowered:
            target_route = {'path': '/laboratory/orders', 'query': {'q': entities.get('patient_query', normalized_text)}}
        else:
            target_route = {'path': '/encounters/new', 'query': {}}
        confidence = 0.80
    elif re.search(r'\b(edit|update|modify)\b', lowered):
        intent_type = 'update.record'
        target_route = {'path': '/patients', 'query': {'q': entities.get('patient_query', normalized_text)}}
        confidence = 0.80
    elif re.search(r'\b(write|document|add)\s+note\b', lowered):
        intent_type = 'write.note'
        target_route = {'path': '/patients', 'query': {'q': entities.get('patient_query', normalized_text)}}
        confidence = 0.86

    # Non-sensitive navigation/search intents.
    elif re.search(r'\blab|result|test\b', lowered):
        intent_type = 'navigate.laboratory.results'
        target_route = {'path': '/laboratory/results', 'query': {'q': entities.get('patient_query', '')}}
        confidence = 0.86
    elif re.search(r'\bappointment|schedule\b', lowered):
        intent_type = 'navigate.appointments'
        target_route = {'path': '/appointments', 'query': {'q': entities.get('patient_query', normalized_text)}}
        confidence = 0.84
    elif re.search(r'\badmission|admit\b', lowered):
        intent_type = 'navigate.admissions'
        target_route = {'path': '/admissions/new', 'query': {'q': entities.get('patient_query', normalized_text)}}
        confidence = 0.82
    elif re.search(r'\bward\b', lowered):
        intent_type = 'navigate.wards'
        target_route = {'path': '/wards', 'query': {'q': entities.get('patient_query', normalized_text)}}
        confidence = 0.82
    elif re.search(r'\bencounter|consult\b', lowered):
        intent_type = 'navigate.encounters'
        target_route = {'path': '/encounters', 'query': {'q': entities.get('patient_query', normalized_text)}}
        confidence = 0.82
    elif re.search(r'\bbilling|invoice|payment\b', lowered):
        intent_type = 'navigate.billing'
        target_route = {'path': '/billing', 'query': {'q': normalized_text}}
        confidence = 0.80
    elif re.search(r'\binbox|task\b', lowered):
        intent_type = 'navigate.inbox'
        target_route = {'path': '/inbox', 'query': {}}
        confidence = 0.84
    elif re.search(r'\bstaff\b', lowered):
        intent_type = 'navigate.staff'
        target_route = {'path': '/staff', 'query': {'q': normalized_text}}
        confidence = 0.80
    elif re.search(r'\bsetting|preference|profile\b', lowered):
        intent_type = 'navigate.settings'
        target_route = {'path': '/settings', 'query': {}}
        confidence = 0.80
    elif re.search(r'\bpatient|mrn\b', lowered):
        intent_type = 'navigate.patients'
        patient_query = entities.get('patient_query') or entities.get('mrn') or normalized_text
        target_route = {'path': '/patients', 'query': {'q': patient_query}}
        confidence = 0.84
    requires_confirmation = policy.requires_confirmation(intent_type)
    confidence = round(max(0.0, min(1.0, confidence)), 3)
    fallback_to_legacy = policy.confidence_band(confidence, feature=FEATURE_OMNI_NL) == 'fallback'

    return {
        'intent_type': intent_type,
        'entities': entities,
        'target_route': target_route,
        'normalized_query': normalized_text,
        'requires_confirmation': requires_confirmation,
        'fallback_to_legacy': fallback_to_legacy,
        'confidence': confidence,
    }


def preview_omni_intent(intent: dict, *, user, facility) -> dict:
    intent_type = str(intent.get('intent_type') or '').strip().lower()
    entities = intent.get('entities') or {}
    target_route = intent.get('target_route') or {}
    route_path = str(target_route.get('path') or '')
    route_scope = _resolve_route_scope(route_path)
    user_type = str(getattr(user, 'user_type', '') or '').strip().lower()

    denial_reasons: list[str] = []
    requires_confirmation = policy.requires_confirmation(intent_type)

    allowed_scopes = _ALLOWED_ROUTE_SCOPES_BY_ROLE.get(user_type, {'settings'})
    if route_scope and route_scope not in allowed_scopes:
        denial_reasons.append(f"Role '{user_type}' cannot access route scope '{route_scope}'.")

    if intent_type.startswith(('role_change', 'admin_change')) and user_type != 'admin':
        denial_reasons.append('Only admin users can change roles or administrative permissions.')
    elif intent_type.startswith('billing_submit') and user_type not in {'admin', 'billing'}:
        denial_reasons.append('Only billing/admin users can submit billing actions.')
    elif intent_type.startswith('phi_export') and user_type != 'admin':
        denial_reasons.append('Only admin users can export/share PHI data.')
    elif intent_type.startswith('break_glass') and user_type not in (CLINICAL_ROLES | {'admin'}):
        denial_reasons.append('Break-glass operations are restricted to clinical/admin roles.')
    elif intent_type.startswith(('order', 'medication', 'write', 'update', 'delete', 'sign')) and user_type not in (
        CLINICAL_ROLES | {'admin'}
    ):
        denial_reasons.append('This action requires a clinical or admin role.')

    patient_id = entities.get('patient_id')
    if patient_id:
        patient = PatientProfile.objects.select_related('facility', 'user').filter(id=patient_id).first()
        if not patient:
            denial_reasons.append('Referenced patient was not found.')
        else:
            if patient.facility_id != facility.id:
                denial_reasons.append('Referenced patient is outside the active facility.')
            else:
                try:
                    if intent_type.startswith(('order', 'medication', 'write', 'update', 'delete', 'sign', 'break_glass')):
                        check_clinical_access(user, patient)
                    elif route_scope == 'laboratory':
                        check_lab_access(user, patient)
                    else:
                        check_demographics_access(user, patient)
                except PermissionDenied:
                    denial_reasons.append('User does not have the required patient-level access for this action.')

    return {
        'allowed': len(denial_reasons) == 0,
        'denial_reasons': denial_reasons,
        'requires_confirmation': requires_confirmation,
        'dry_run': True,
        'route_scope': route_scope,
    }
