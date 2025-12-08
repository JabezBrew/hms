"""
Tests for laboratory app models.

Tests cover:
- LabTestCatalog model (creation, reference ranges, system defaults)
- LabPanel model (creation, test associations)
- LabOrder model (creation, order number generation, status transitions)
- LabOrderTest model
- LabSpecimen model (collection, rejection)
- LabResult model (flags, interpretation)
"""
import pytest
from decimal import Decimal
from django.utils import timezone
from datetime import timedelta

from apps.laboratory.models import (
    LabTestCatalog, LabPanel, LabOrder, LabOrderTest, LabSpecimen, LabResult,
    LabOrderStatus, LabOrderPriority
)
from .factories import (
    LabTestCatalogFactory, LabPanelFactory, LabOrderFactory,
    LabOrderTestFactory, LabSpecimenFactory, LabResultFactory
)
from apps.users.tests.factories import PatientProfileFactory, PractitionerProfileFactory


@pytest.mark.tier1
class TestLabTestCatalogModel:
    """Tests for the LabTestCatalog model."""

    def test_create_lab_test(self, db):
        """Test basic lab test creation."""
        test = LabTestCatalogFactory(
            code='CBC',
            name='Complete Blood Count',
            short_name='CBC',
            category='hematology'
        )
        assert test.code == 'CBC'
        assert test.name == 'Complete Blood Count'
        assert test.category == 'hematology'
        assert test.is_active is True

    def test_lab_test_str(self, db):
        """Test lab test string representation."""
        test = LabTestCatalogFactory(short_name='GLU', name='Glucose')
        assert str(test) == 'GLU - Glucose'

    def test_lab_test_categories(self, db):
        """Test all lab test categories."""
        categories = ['hematology', 'chemistry', 'microbiology', 'immunology',
                      'urinalysis', 'coagulation', 'serology', 'molecular',
                      'pathology', 'toxicology', 'endocrine', 'cardiac', 'other']
        for category in categories:
            test = LabTestCatalogFactory(category=category)
            assert test.category == category

    def test_lab_test_reference_ranges(self, db):
        """Test lab test with reference ranges."""
        test = LabTestCatalogFactory(
            reference_ranges={
                'adult_male': {'low': 4.5, 'high': 5.5, 'unit': 'million/uL'},
                'adult_female': {'low': 4.0, 'high': 5.0, 'unit': 'million/uL'},
                'pediatric': {'low': 4.0, 'high': 5.5, 'unit': 'million/uL'}
            }
        )
        assert 'adult_male' in test.reference_ranges
        assert test.reference_ranges['adult_male']['low'] == 4.5

    def test_lab_test_reset_to_system_defaults(self, db):
        """Test resetting lab test to system defaults."""
        test = LabTestCatalogFactory(
            is_system_default=True,
            is_facility_modified=True,
            price=Decimal('100.00'),
            system_defaults={'price': '50.00', 'tat_hours': 24}
        )
        result = test.reset_to_system_defaults()
        assert result is True
        test.refresh_from_db()
        assert test.price == Decimal('50.00')
        assert test.is_facility_modified is False

    def test_lab_test_reset_non_system_default(self, db):
        """Test reset fails for non-system default tests."""
        test = LabTestCatalogFactory(is_system_default=False)
        result = test.reset_to_system_defaults()
        assert result is False


@pytest.mark.tier1
class TestLabPanelModel:
    """Tests for the LabPanel model."""

    def test_create_panel(self, db):
        """Test basic panel creation."""
        panel = LabPanelFactory(
            code='CMP',
            name='Comprehensive Metabolic Panel',
            price=Decimal('120.00')
        )
        assert panel.code == 'CMP'
        assert panel.name == 'Comprehensive Metabolic Panel'
        assert panel.price == Decimal('120.00')

    def test_panel_str(self, db):
        """Test panel string representation."""
        panel = LabPanelFactory(code='BMP', name='Basic Metabolic Panel')
        assert str(panel) == 'BMP - Basic Metabolic Panel'

    def test_panel_with_tests(self, db):
        """Test panel with associated tests."""
        test1 = LabTestCatalogFactory(code='GLU')
        test2 = LabTestCatalogFactory(code='BUN')
        test3 = LabTestCatalogFactory(code='CREAT')

        panel = LabPanelFactory(code='RFT', tests=[test1, test2, test3])
        assert panel.tests.count() == 3
        assert test1 in panel.tests.all()

    def test_panel_reset_to_system_defaults(self, db):
        """Test resetting panel to system defaults."""
        panel = LabPanelFactory(
            is_system_default=True,
            is_facility_modified=True,
            price=Decimal('200.00'),
            system_defaults={'price': '150.00'}
        )
        result = panel.reset_to_system_defaults()
        assert result is True
        panel.refresh_from_db()
        assert panel.price == Decimal('150.00')


@pytest.mark.tier1
class TestLabOrderModel:
    """Tests for the LabOrder model."""

    def test_create_order(self, db):
        """Test basic lab order creation."""
        patient = PatientProfileFactory()
        provider = PractitionerProfileFactory()
        order = LabOrderFactory(
            patient=patient,
            ordering_provider=provider,
            priority='routine',
            status='ordered'
        )
        assert order.patient == patient
        assert order.ordering_provider == provider
        assert order.priority == 'routine'
        assert order.status == 'ordered'

    def test_order_number_auto_generation(self, db):
        """Test order number is auto-generated."""
        order = LabOrderFactory()
        assert order.order_number is not None
        assert order.order_number.startswith('LAB-')

    def test_order_number_sequential(self, db):
        """Test order numbers are sequential."""
        order1 = LabOrderFactory()
        order2 = LabOrderFactory()
        # Extract sequence numbers
        num1 = int(order1.order_number.split('-')[-1])
        num2 = int(order2.order_number.split('-')[-1])
        assert num2 == num1 + 1

    def test_order_str(self, db):
        """Test order string representation."""
        order = LabOrderFactory()
        string_repr = str(order)
        assert 'Lab Order' in string_repr
        assert order.order_number in string_repr

    def test_order_priority_choices(self, db):
        """Test all order priority choices."""
        priorities = ['routine', 'urgent', 'stat']
        for priority in priorities:
            order = LabOrderFactory(priority=priority)
            assert order.priority == priority

    def test_order_status_choices(self, db):
        """Test all order status choices."""
        statuses = ['draft', 'ordered', 'collected', 'received',
                    'processing', 'completed', 'cancelled']
        for status in statuses:
            order = LabOrderFactory(status=status)
            assert order.status == status

    def test_order_with_clinical_notes(self, db):
        """Test order with clinical notes."""
        order = LabOrderFactory(
            clinical_notes='Suspected diabetes, check fasting glucose',
            fasting_required=True
        )
        assert order.clinical_notes == 'Suspected diabetes, check fasting glucose'
        assert order.fasting_required is True


@pytest.mark.tier2
class TestLabOrderTestModel:
    """Tests for the LabOrderTest model."""

    def test_create_order_test(self, db):
        """Test creating an order test relationship."""
        order = LabOrderFactory()
        test = LabTestCatalogFactory(code='HGB')
        order_test = LabOrderTestFactory(order=order, test=test)
        assert order_test.order == order
        assert order_test.test == test
        assert order_test.status == 'ordered'

    def test_order_test_str(self, db):
        """Test order test string representation."""
        order = LabOrderFactory()
        test = LabTestCatalogFactory(short_name='HGB')
        order_test = LabOrderTestFactory(order=order, test=test)
        string_repr = str(order_test)
        assert order.order_number in string_repr
        assert 'HGB' in string_repr


@pytest.mark.tier2
class TestLabSpecimenModel:
    """Tests for the LabSpecimen model."""

    def test_create_specimen(self, db):
        """Test basic specimen creation."""
        order = LabOrderFactory()
        collector = PractitionerProfileFactory()
        specimen = LabSpecimenFactory(
            order=order,
            specimen_type='Whole Blood',
            container_type='Lavender Top',
            collected_by=collector
        )
        assert specimen.order == order
        assert specimen.specimen_type == 'Whole Blood'
        assert specimen.container_type == 'Lavender Top'
        assert specimen.status == 'collected'

    def test_specimen_barcode_unique(self, db):
        """Test specimen barcode is unique."""
        specimen1 = LabSpecimenFactory()
        specimen2 = LabSpecimenFactory()
        assert specimen1.barcode != specimen2.barcode

    def test_specimen_str(self, db):
        """Test specimen string representation."""
        specimen = LabSpecimenFactory(
            barcode='SPEC-00001234',
            specimen_type='Serum'
        )
        string_repr = str(specimen)
        assert 'SPEC-00001234' in string_repr
        assert 'Serum' in string_repr

    def test_specimen_status_choices(self, db):
        """Test all specimen status choices."""
        statuses = ['collected', 'in_transit', 'received', 'processing',
                    'stored', 'disposed', 'rejected']
        for status in statuses:
            specimen = LabSpecimenFactory(status=status)
            assert specimen.status == status

    def test_specimen_rejection(self, db):
        """Test specimen rejection."""
        specimen = LabSpecimenFactory(
            status='rejected',
            is_rejected=True,
            rejection_reason='Hemolyzed sample'
        )
        assert specimen.is_rejected is True
        assert specimen.rejection_reason == 'Hemolyzed sample'

    def test_specimen_lab_receipt(self, db):
        """Test specimen receipt in lab."""
        receiver = PractitionerProfileFactory()
        specimen = LabSpecimenFactory(
            status='received',
            received_by=receiver,
            received_at=timezone.now(),
            storage_location='Freezer A-12'
        )
        assert specimen.received_by == receiver
        assert specimen.received_at is not None
        assert specimen.storage_location == 'Freezer A-12'


@pytest.mark.tier2
class TestLabResultModel:
    """Tests for the LabResult model."""

    def test_create_result(self, db):
        """Test basic result creation."""
        order_test = LabOrderTestFactory()
        specimen = LabSpecimenFactory(order=order_test.order)
        performer = PractitionerProfileFactory()

        result = LabResultFactory(
            order_test=order_test,
            specimen=specimen,
            value='45.2',
            unit='mg/dL',
            flag='normal',
            performed_by=performer
        )
        assert result.value == '45.2'
        assert result.flag == 'normal'

    def test_result_flag_choices(self, db):
        """Test all result flag choices."""
        flags = ['normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal']
        for flag in flags:
            result = LabResultFactory(flag=flag)
            assert result.flag == flag

    def test_result_critical_high(self, db):
        """Test critical high result."""
        result = LabResultFactory(
            value='150',
            reference_high=Decimal('50'),
            flag='critical_high',
            interpretation='Critical value - notify physician immediately'
        )
        assert result.flag == 'critical_high'
        assert 'Critical' in result.interpretation

    def test_result_verification(self, db):
        """Test result verification."""
        verifier = PractitionerProfileFactory()
        result = LabResultFactory(
            verified_by=verifier,
            verified_at=timezone.now(),
            is_verified=True
        )
        assert result.verified_by == verifier
        assert result.is_verified is True

    def test_unverified_result(self, db):
        """Test unverified result."""
        result = LabResultFactory(
            is_verified=False,
            verified_by=None,
            verified_at=None
        )
        assert result.is_verified is False
        assert result.verified_by is None
