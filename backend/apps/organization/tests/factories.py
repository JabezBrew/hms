"""
Factories for creating test Organization instances.
"""
import factory
from factory.django import DjangoModelFactory

from apps.organization.models import (
    UnitTypeConfig, ClinicalUnit, StaffAssignmentTypeConfig, StaffUnitAssignment
)
from apps.users.tests.factories import PractitionerProfileFactory


class UnitTypeConfigFactory(DjangoModelFactory):
    """Factory for creating UnitTypeConfig instances."""

    class Meta:
        model = UnitTypeConfig

    code = factory.Sequence(lambda n: f'unit_type_{n}')
    name = factory.Sequence(lambda n: f'Unit Type {n}')
    depth_level = 2  # Department level
    can_admit_patients = True
    can_consult = True
    is_active = True


class ClinicalUnitFactory(DjangoModelFactory):
    """Factory for creating ClinicalUnit instances."""

    class Meta:
        model = ClinicalUnit

    code = factory.Sequence(lambda n: f'UNIT{n}')
    name = factory.Sequence(lambda n: f'Clinical Unit {n}')
    unit_type = factory.SubFactory(UnitTypeConfigFactory)
    is_active = True
    accepts_referrals = True
    accepts_admissions = True
    ward_assignment_policy = 'flexible'


class StaffAssignmentTypeConfigFactory(DjangoModelFactory):
    """Factory for creating StaffAssignmentTypeConfig instances."""

    class Meta:
        model = StaffAssignmentTypeConfig

    code = factory.Sequence(lambda n: f'assignment_type_{n}')
    name = factory.Sequence(lambda n: f'Assignment Type {n}')


class StaffUnitAssignmentFactory(DjangoModelFactory):
    """Factory for creating StaffUnitAssignment instances."""

    class Meta:
        model = StaffUnitAssignment

    unit = factory.SubFactory(ClinicalUnitFactory)
    practitioner = factory.SubFactory(PractitionerProfileFactory)
    assignment_type = factory.SubFactory(StaffAssignmentTypeConfigFactory)
    is_primary = True
    is_active = True
