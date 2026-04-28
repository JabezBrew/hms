from __future__ import annotations

import os
from dataclasses import dataclass

from django.conf import settings
from django.core.management import call_command
from django.db import transaction
from django.utils import timezone

from apps.core.models import Facility
from apps.organization.models import ClinicalUnit, UnitTypeConfig


def _normalize_code(value):
    if not value:
        return ""
    return str(value).strip().upper()


def _normalize_text(value):
    return str(value).strip()


def _normalize_lower(value):
    return str(value).strip().lower()


def _normalize_upper(value):
    return str(value).strip().upper()


def _parse_bool(value, default=False):
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
        return True
    if normalized in {"0", "false", "no", "n", "off"}:
        return False
    return default


def _env_value(name, default, *, normalizer=_normalize_text):
    raw = os.getenv(name)
    explicit = raw is not None and str(raw).strip() != ""
    value = raw if explicit else default
    return normalizer(value), explicit


def get_default_facility_code():
    return _normalize_code(getattr(settings, "DEFAULT_FACILITY_CODE", None))


@dataclass(frozen=True)
class FacilityProvisioningResult:
    facility: Facility
    facility_created: bool
    facility_updated: bool
    root_unit: ClinicalUnit
    root_created: bool
    root_updated: bool


def ensure_organization_config():
    call_command("seed_organization")


def _default_facility_payload(code):
    facility_type, _ = _env_value(
        "DEFAULT_FACILITY_TYPE",
        "hospital",
        normalizer=_normalize_lower,
    )
    valid_types = {key for key, _ in Facility.FACILITY_TYPE_CHOICES}
    if facility_type not in valid_types:
        raise ValueError(
            f"Invalid DEFAULT_FACILITY_TYPE={facility_type!r}. "
            f"Valid values: {', '.join(sorted(valid_types))}"
        )

    name, name_explicit = _env_value("DEFAULT_FACILITY_NAME", f"{code} Facility")
    address, address_explicit = _env_value("DEFAULT_FACILITY_ADDRESS", "Bootstrap Address")
    city, city_explicit = _env_value("DEFAULT_FACILITY_CITY", "Bootstrap City")
    region, region_explicit = _env_value("DEFAULT_FACILITY_REGION", "")
    country, country_explicit = _env_value("DEFAULT_FACILITY_COUNTRY", "Ghana")
    postal_code, postal_code_explicit = _env_value("DEFAULT_FACILITY_POSTAL_CODE", "")
    phone, phone_explicit = _env_value("DEFAULT_FACILITY_PHONE", "+0000000000")
    email, email_explicit = _env_value(
        "DEFAULT_FACILITY_EMAIL",
        f"{code.lower()}@example.invalid",
        normalizer=_normalize_lower,
    )
    timezone_value, timezone_explicit = _env_value("DEFAULT_FACILITY_TIMEZONE", "Africa/Accra")
    currency, currency_explicit = _env_value(
        "DEFAULT_FACILITY_CURRENCY",
        "GHS",
        normalizer=_normalize_upper,
    )
    is_headquarters_raw = os.getenv("DEFAULT_FACILITY_IS_HEADQUARTERS")
    is_headquarters_explicit = (
        is_headquarters_raw is not None and str(is_headquarters_raw).strip() != ""
    )
    is_headquarters = _parse_bool(is_headquarters_raw, default=True)

    payload = {
        "code": code,
        "name": name,
        "facility_type": facility_type,
        "address": address,
        "city": city,
        "region": region,
        "country": country,
        "postal_code": postal_code,
        "phone": phone,
        "email": email,
        "timezone": timezone_value,
        "currency": currency,
        "status": "ready",
        "is_active": True,
        "is_headquarters": is_headquarters,
    }
    explicit_fields = {
        field_name
        for field_name, was_explicit in (
            ("name", name_explicit),
            ("facility_type", True),
            ("address", address_explicit),
            ("city", city_explicit),
            ("region", region_explicit),
            ("country", country_explicit),
            ("postal_code", postal_code_explicit),
            ("phone", phone_explicit),
            ("email", email_explicit),
            ("timezone", timezone_explicit),
            ("currency", currency_explicit),
            ("is_headquarters", is_headquarters_explicit),
        )
        if was_explicit
    }
    return payload, explicit_fields


@transaction.atomic
def ensure_default_facility():
    code = get_default_facility_code()
    if not code:
        return None, False, False

    payload, explicit_fields = _default_facility_payload(code)
    facility = Facility.objects.filter(code=code).first()
    facility_created = False
    facility_updated = False

    if facility is None:
        facility = Facility.objects.create(
            **payload,
            provisioned_at=timezone.now(),
        )
        facility_created = True
        return facility, facility_created, facility_updated

    for field_name in explicit_fields:
        desired_value = payload[field_name]
        if getattr(facility, field_name) != desired_value:
            setattr(facility, field_name, desired_value)
            facility_updated = True

    if facility.provisioned_at is None and facility.status == "ready":
        facility.provisioned_at = timezone.now()
        facility_updated = True

    if facility_updated:
        facility.save()

    return facility, facility_created, facility_updated


@transaction.atomic
def ensure_facility_root_unit(facility):
    facility_type = UnitTypeConfig.objects.filter(code="facility", is_active=True).first()
    if not facility_type:
        raise RuntimeError("Organization facility unit type is missing. Run seed_organization first.")

    root = ClinicalUnit.objects.filter(parent__isnull=True, code=facility.code).first()
    root_created = False
    root_updated = False

    if root is None:
        root = ClinicalUnit.objects.create(
            code=facility.code,
            name=facility.name,
            unit_type=facility_type,
            parent=None,
            short_name=facility.code,
            timezone=facility.timezone or "",
            currency=facility.currency or "",
            staffing_mode="mixed",
            unit_category="clinical",
            is_active=facility.is_active,
            accepts_admissions=False,
        )
        root_created = True
        return root, root_created, root_updated

    if root.unit_type_id != facility_type.id:
        raise RuntimeError(
            f"Root organization unit {root.id} for facility {facility.code} "
            "must use unit_type='facility'."
        )

    placeholder_names = {"", facility.code, f"{facility.code} Facility"}
    if root.name in placeholder_names and root.name != facility.name:
        root.name = facility.name
        root_updated = True
    if not root.short_name:
        root.short_name = facility.code
        root_updated = True
    if not root.timezone and facility.timezone:
        root.timezone = facility.timezone
        root_updated = True
    if not root.currency and facility.currency:
        root.currency = facility.currency
        root_updated = True
    if root.is_active != facility.is_active:
        root.is_active = facility.is_active
        root_updated = True

    if root_updated:
        root.save()

    return root, root_created, root_updated


def provision_default_facility_structure():
    code = get_default_facility_code()
    if not code:
        return None

    ensure_organization_config()
    facility, facility_created, facility_updated = ensure_default_facility()
    if facility is None:
        return None
    root_unit, root_created, root_updated = ensure_facility_root_unit(facility)
    return FacilityProvisioningResult(
        facility=facility,
        facility_created=facility_created,
        facility_updated=facility_updated,
        root_unit=root_unit,
        root_created=root_created,
        root_updated=root_updated,
    )
