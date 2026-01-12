"""
Record bundle exporters for cross-facility sharing.
"""
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from django.apps import apps as django_apps
from django.utils import timezone

from apps.encounters.models import Encounter
from apps.users.models import PatientProfile, User
from apps.wards.models import Admission

EXCLUDED_APPS = {
    'admin',
    'auth',
    'contenttypes',
    'sessions',
    'token_blacklist',
    'mpi',
    'consent',
    'audit',
}

_RELATION_CACHE = None


def _serialize_value(value):
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def _serialize_instance(instance, exclude_fields=None):
    exclude_fields = set(exclude_fields or [])
    data = {}
    for field in instance._meta.fields:
        if field.name in exclude_fields:
            continue
        value = getattr(instance, field.name)
        if hasattr(field, 'attname') and field.attname.endswith('_id') and field.attname != field.name:
            value = getattr(instance, field.attname)
        data[field.name] = _serialize_value(value)

    for field in instance._meta.many_to_many:
        if field.name in exclude_fields:
            continue
        data[field.name] = list(getattr(instance, field.name).values_list('id', flat=True))

    return data


def _build_relation_cache():
    patient_relations = []
    encounter_relations = []
    admission_relations = []

    for model in django_apps.get_models():
        if model._meta.app_label in EXCLUDED_APPS:
            continue
        if model in (PatientProfile, User):
            continue
        for field in model._meta.fields:
            if not field.is_relation:
                continue
            related = field.related_model
            if related == PatientProfile:
                patient_relations.append((model, field.name))
            elif related == Encounter:
                encounter_relations.append((model, field.name))
            elif related == Admission:
                admission_relations.append((model, field.name))

    return {
        'patient': patient_relations,
        'encounter': encounter_relations,
        'admission': admission_relations,
    }


def _get_relation_cache():
    global _RELATION_CACHE
    if _RELATION_CACHE is None:
        _RELATION_CACHE = _build_relation_cache()
    return _RELATION_CACHE


def build_patient_record_bundle(patient: PatientProfile) -> dict:
    admissions = list(Admission.objects.filter(patient=patient))
    encounters = list(Encounter.objects.filter(patient=patient))

    records = {}
    relations = _get_relation_cache()

    for model, field_name in relations['patient']:
        queryset = model.objects.filter(**{field_name: patient})
        if queryset.exists():
            records[model._meta.label] = [
                _serialize_instance(obj) for obj in queryset
            ]

    if encounters:
        encounter_ids = [e.id for e in encounters]
        for model, field_name in relations['encounter']:
            queryset = model.objects.filter(**{f"{field_name}__in": encounter_ids})
            if queryset.exists():
                records[model._meta.label] = [
                    _serialize_instance(obj) for obj in queryset
                ]

    if admissions:
        admission_ids = [a.id for a in admissions]
        for model, field_name in relations['admission']:
            queryset = model.objects.filter(**{f"{field_name}__in": admission_ids})
            if queryset.exists():
                records[model._meta.label] = [
                    _serialize_instance(obj) for obj in queryset
                ]

    bundle = {
        'schema_version': 1,
        'generated_at': timezone.now().isoformat(),
        'patient_identity_id': str(patient.patient_identity_id) if patient.patient_identity_id else None,
        'patient': _serialize_instance(patient, exclude_fields={'user'}),
        'user': _serialize_instance(patient.user, exclude_fields={'password', 'last_login'}),
        'admissions': [_serialize_instance(a) for a in admissions],
        'encounters': [_serialize_instance(e) for e in encounters],
        'records': records,
    }

    return bundle
