import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.core.management.commands.preflight_migration_checks import Command


def _patch_common_defaults(monkeypatch):
    monkeypatch.setattr(Command, "_facility_table_exists", lambda self: True)
    monkeypatch.setattr(Command, "_count_facilities", lambda self: 1)
    monkeypatch.setattr(Command, "_get_default_facility_code", lambda self: None)
    monkeypatch.setattr(Command, "_default_facility_exists", lambda self, code: False)
    monkeypatch.setattr(Command, "_count_users_0016_unresolved_patients", lambda self: 0)


def test_preflight_passes_without_pending_migrations(monkeypatch):
    _patch_common_defaults(monkeypatch)
    monkeypatch.setattr(Command, "_get_pending_migrations", lambda self: [])

    call_command("preflight_migration_checks", strict=True)


def test_preflight_fails_when_users_0016_has_unresolved_rows_and_no_fallback(monkeypatch):
    _patch_common_defaults(monkeypatch)
    monkeypatch.setattr(Command, "_get_pending_migrations", lambda self: [("users", "0016_patient_facility")])
    monkeypatch.setattr(Command, "_count_facilities", lambda self: 2)
    monkeypatch.setattr(Command, "_count_users_0016_unresolved_patients", lambda self: 4)

    with pytest.raises(CommandError, match="users.0016_patient_facility"):
        call_command("preflight_migration_checks", strict=True)


def test_preflight_passes_when_default_facility_is_valid(monkeypatch):
    _patch_common_defaults(monkeypatch)
    monkeypatch.setattr(Command, "_get_pending_migrations", lambda self: [("users", "0016_patient_facility")])
    monkeypatch.setattr(Command, "_count_facilities", lambda self: 3)
    monkeypatch.setattr(Command, "_get_default_facility_code", lambda self: "MAIN")
    monkeypatch.setattr(Command, "_default_facility_exists", lambda self, code: True)
    monkeypatch.setattr(Command, "_count_users_0016_unresolved_patients", lambda self: 7)

    call_command("preflight_migration_checks", strict=True)


def test_preflight_strict_requires_default_code_for_multi_facility_backfills(monkeypatch):
    _patch_common_defaults(monkeypatch)
    monkeypatch.setattr(Command, "_get_pending_migrations", lambda self: [("billing", "0011_facility_scoping")])
    monkeypatch.setattr(Command, "_count_facilities", lambda self: 2)

    with pytest.raises(CommandError, match="DEFAULT_FACILITY_CODE is required in strict mode"):
        call_command("preflight_migration_checks", strict=True)


def test_preflight_skips_default_facility_validation_when_table_missing(monkeypatch):
    _patch_common_defaults(monkeypatch)
    monkeypatch.setattr(Command, "_get_pending_migrations", lambda self: [("users", "0016_patient_facility")])
    monkeypatch.setattr(Command, "_facility_table_exists", lambda self: False)
    monkeypatch.setattr(Command, "_count_facilities", lambda self: 0)
    monkeypatch.setattr(Command, "_get_default_facility_code", lambda self: "MAIN")
    monkeypatch.setattr(Command, "_default_facility_exists", lambda self, code: False)

    call_command("preflight_migration_checks", strict=True)
