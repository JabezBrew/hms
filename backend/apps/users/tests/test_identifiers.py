import pytest
from zoneinfo import ZoneInfo
from django.utils import timezone

from apps.core.tests.factories import DefaultFacilityFactory
from apps.users.identifiers import generate_unique_employee_id, generate_unique_mrn
from apps.users.models import IdentifierSequence


@pytest.mark.tier1
class TestIdentifierGeneration:
    def test_employee_id_format_includes_facility_code(self, db):
        facility = DefaultFacilityFactory(code='BRANCH-A')

        employee_id = generate_unique_employee_id(facility)

        assert employee_id.startswith('EMP-BRANCH-A-')
        year, sequence = employee_id.rsplit('-', 2)[1:]
        expected_year = str(timezone.now().astimezone(ZoneInfo(facility.timezone)).year)
        assert year == expected_year
        assert len(sequence) == 7
        assert sequence.isdigit()

    def test_employee_id_uniqueness_same_facility(self, db):
        facility = DefaultFacilityFactory(code='MAIN')
        generated = set()

        for _ in range(100):
            employee_id = generate_unique_employee_id(facility)
            assert employee_id not in generated
            generated.add(employee_id)

    def test_sequences_are_scoped_by_facility_and_identifier_type(self, db):
        facility_a = DefaultFacilityFactory(code='MAIN')
        facility_b = DefaultFacilityFactory(code='EAST')

        employee_a_1 = generate_unique_employee_id(facility_a)
        employee_a_2 = generate_unique_employee_id(facility_a)
        employee_b_1 = generate_unique_employee_id(facility_b)
        mrn_a_1 = generate_unique_mrn(facility_a)

        assert employee_a_1.endswith('-0000001')
        assert employee_a_2.endswith('-0000002')
        assert employee_b_1.endswith('-0000001')
        assert mrn_a_1.endswith('-0000001')

        assert IdentifierSequence.objects.count() == 3
