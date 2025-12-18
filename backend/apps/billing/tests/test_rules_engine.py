"""
Tests for the Billing Rules Engine.

Tests cover:
- BillingRule model validation and creation
- FacilityBillingSettings model validation
- BillingRulesEngine evaluation logic for all rule types
- Rule stacking behavior
- Insurance vs self-pay filtering
- Rule caching and invalidation
- Performance considerations
"""
import pytest
from datetime import date, datetime, timedelta, time
from decimal import Decimal
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.core.cache import cache
from django.utils import timezone

from apps.billing.models import BillingRule, FacilityBillingSettings
from apps.billing.services import (
    BillingRulesEngine,
    PatientContext,
    BillingContext,
    RuleAdjustment,
    RuleEvaluationResult,
)
from apps.billing.tests.factories import (
    BillingRuleFactory,
    SeniorDiscountRuleFactory,
    ChildDiscountRuleFactory,
    StaffDiscountRuleFactory,
    BulkDiscountRuleFactory,
    EmergencySurchargeRuleFactory,
    AfterHoursSurchargeRuleFactory,
    WeekendSurchargeRuleFactory,
    HolidaySurchargeRuleFactory,
    MinimumChargeRuleFactory,
    FacilityBillingSettingsFactory,
    ServiceFactory,
)
from apps.core.tests.factories import FacilityFactory


pytestmark = pytest.mark.django_db


# =============================================================================
# BillingRule Model Tests
# =============================================================================

class TestBillingRuleModel:
    """Unit tests for BillingRule model."""

    def test_create_senior_discount_rule(self):
        """Test creating a senior discount rule with valid parameters."""
        rule = SeniorDiscountRuleFactory(
            parameters={'min_age': 60},
            adjustment_value=Decimal('15.00')
        )

        assert rule.rule_type == 'senior_discount'
        assert rule.parameters['min_age'] == 60
        assert rule.adjustment_value == Decimal('15.00')
        assert rule.adjustment_type == 'percentage'
        assert rule.is_active is True

    def test_create_emergency_surcharge_rule(self):
        """Test creating an emergency surcharge rule."""
        rule = EmergencySurchargeRuleFactory(
            adjustment_value=Decimal('30.00')
        )

        assert rule.rule_type == 'emergency_surcharge'
        assert rule.adjustment_value == Decimal('30.00')

    def test_rule_priority_ordering(self):
        """Test that rules are ordered by priority."""
        rule1 = BillingRuleFactory(priority=50)
        rule2 = BillingRuleFactory(priority=100)
        rule3 = BillingRuleFactory(priority=25)

        rules = list(BillingRule.objects.all().order_by('priority'))

        assert rules[0].priority == 25
        assert rules[1].priority == 50
        assert rules[2].priority == 100

    def test_rule_parameters_validation_missing_required(self):
        """Test that missing required parameters raise validation error."""
        with pytest.raises(ValidationError) as exc_info:
            BillingRuleFactory(
                rule_type='senior_discount',
                parameters={}  # Missing required 'min_age'
            )

        assert 'min_age' in str(exc_info.value)

    def test_rule_parameters_validation_wrong_type(self):
        """Test that wrong parameter types raise validation error."""
        with pytest.raises(ValidationError) as exc_info:
            BillingRuleFactory(
                rule_type='senior_discount',
                parameters={'min_age': 'not_a_number'}  # Should be int
            )

        assert 'min_age' in str(exc_info.value)

    def test_rule_parameters_validation_unknown_parameter(self):
        """Test that unknown parameters raise validation error (security)."""
        with pytest.raises(ValidationError) as exc_info:
            BillingRuleFactory(
                rule_type='senior_discount',
                parameters={
                    'min_age': 65,
                    'malicious_param': 'eval("os.system()")'  # Unknown param
                }
            )

        assert 'Unknown parameters' in str(exc_info.value)

    def test_rule_scope_facility_specific(self):
        """Test creating a facility-specific rule."""
        facility = FacilityFactory()
        rule = BillingRuleFactory(facility=facility)

        assert rule.facility == facility
        assert str(facility.code) in str(rule)

    def test_rule_scope_global(self):
        """Test creating a global rule (no facility)."""
        rule = BillingRuleFactory(facility=None)

        assert rule.facility is None
        assert 'Global' in str(rule)

    def test_rule_effective_dates_validation(self):
        """Test that effective_until must be after effective_from."""
        with pytest.raises(ValidationError):
            BillingRuleFactory(
                effective_from=date.today(),
                effective_until=date.today() - timedelta(days=1)
            )

    def test_rule_is_currently_effective_active(self):
        """Test is_currently_effective for an active rule."""
        rule = BillingRuleFactory(
            effective_from=date.today() - timedelta(days=1),
            effective_until=date.today() + timedelta(days=30),
            is_active=True
        )

        assert rule.is_currently_effective is True

    def test_rule_is_currently_effective_inactive(self):
        """Test is_currently_effective for an inactive rule."""
        rule = BillingRuleFactory(is_active=False)

        assert rule.is_currently_effective is False

    def test_rule_is_currently_effective_future(self):
        """Test is_currently_effective for a future rule."""
        rule = BillingRuleFactory(
            effective_from=date.today() + timedelta(days=1)
        )

        assert rule.is_currently_effective is False

    def test_rule_is_currently_effective_expired(self):
        """Test is_currently_effective for an expired rule."""
        rule = BillingRuleFactory(
            effective_from=date.today() - timedelta(days=30),
            effective_until=date.today() - timedelta(days=1)
        )

        assert rule.is_currently_effective is False

    def test_rule_get_adjustment_amount_percentage(self):
        """Test calculating adjustment amount for percentage type."""
        rule = BillingRuleFactory(
            adjustment_type='percentage',
            adjustment_value=Decimal('10.00')
        )

        result = rule.get_adjustment_amount(Decimal('100.00'))

        assert result == Decimal('10.00')

    def test_rule_get_adjustment_amount_fixed(self):
        """Test calculating adjustment amount for fixed type."""
        rule = BillingRuleFactory(
            adjustment_type='fixed',
            adjustment_value=Decimal('25.00')
        )

        result = rule.get_adjustment_amount(Decimal('100.00'))

        assert result == Decimal('25.00')

    def test_rule_code_auto_generation(self):
        """Test that rule code is auto-generated if not provided."""
        from apps.users.tests.factories import UserFactory

        admin_user = UserFactory(user_type='admin')
        rule = BillingRule(
            name='Test Rule',
            rule_type='senior_discount',
            parameters={'min_age': 65},
            effective_from=date.today(),
            created_by=admin_user,
            updated_by=admin_user
        )
        rule.save()

        assert rule.code is not None
        assert len(rule.code) > 0


# =============================================================================
# FacilityBillingSettings Model Tests
# =============================================================================

class TestFacilityBillingSettingsModel:
    """Unit tests for FacilityBillingSettings model."""

    def test_create_settings_for_facility(self):
        """Test creating billing settings for a facility."""
        settings = FacilityBillingSettingsFactory()

        assert settings.facility is not None
        assert settings.invoice_prefix == 'INV'
        assert settings.invoice_due_days == 30

    def test_operating_hours_validation(self):
        """Test that end time must be after start time."""
        with pytest.raises(ValidationError):
            FacilityBillingSettingsFactory(
                regular_hours_start='17:00',
                regular_hours_end='08:00'  # End before start
            )

    def test_weekend_hours_validation(self):
        """Test weekend hours validation."""
        with pytest.raises(ValidationError):
            FacilityBillingSettingsFactory(
                weekend_hours_start='12:00',
                weekend_hours_end='10:00'  # End before start
            )

    def test_payment_methods_validation_invalid(self):
        """Test that invalid payment methods raise error."""
        with pytest.raises(ValidationError) as exc_info:
            FacilityBillingSettingsFactory(
                accepted_payment_methods=['cash', 'invalid_method']
            )

        assert 'invalid_method' in str(exc_info.value)

    def test_holidays_format_validation(self):
        """Test that holidays must be in ISO format."""
        with pytest.raises(ValidationError) as exc_info:
            FacilityBillingSettingsFactory(
                holidays=['2025-12-25', 'invalid-date']
            )

        assert 'invalid-date' in str(exc_info.value)

    def test_is_within_operating_hours_weekday_inside(self):
        """Test is_within_operating_hours during business hours on weekday."""
        settings = FacilityBillingSettingsFactory(
            regular_hours_start='08:00',
            regular_hours_end='17:00'
        )

        # Monday at 10:00
        test_time = timezone.make_aware(datetime(2025, 12, 15, 10, 0))

        assert settings.is_within_operating_hours(test_time) is True

    def test_is_within_operating_hours_weekday_outside(self):
        """Test is_within_operating_hours outside business hours on weekday."""
        settings = FacilityBillingSettingsFactory(
            regular_hours_start='08:00',
            regular_hours_end='17:00'
        )

        # Monday at 19:00
        test_time = timezone.make_aware(datetime(2025, 12, 15, 19, 0))

        assert settings.is_within_operating_hours(test_time) is False

    def test_is_within_operating_hours_weekend_closed(self):
        """Test is_within_operating_hours on weekend when closed."""
        settings = FacilityBillingSettingsFactory(
            weekend_hours_start=None,
            weekend_hours_end=None
        )

        # Saturday at 10:00
        test_time = timezone.make_aware(datetime(2025, 12, 13, 10, 0))

        assert settings.is_within_operating_hours(test_time) is False

    def test_is_within_operating_hours_weekend_open(self):
        """Test is_within_operating_hours on weekend when open."""
        settings = FacilityBillingSettingsFactory(
            weekend_hours_start='09:00',
            weekend_hours_end='13:00'
        )

        # Saturday at 10:00
        test_time = timezone.make_aware(datetime(2025, 12, 13, 10, 0))

        assert settings.is_within_operating_hours(test_time) is True

    def test_is_holiday(self):
        """Test holiday detection."""
        settings = FacilityBillingSettingsFactory(
            holidays=['2025-12-25', '2025-01-01']
        )

        assert settings.is_holiday(date(2025, 12, 25)) is True
        assert settings.is_holiday(date(2025, 12, 26)) is False

    def test_get_price_context_emergency(self):
        """Test price context determination for emergency."""
        settings = FacilityBillingSettingsFactory()

        context = settings.get_price_context(is_emergency=True)

        assert context == 'emergency'

    def test_get_price_context_holiday(self):
        """Test price context determination for holiday."""
        settings = FacilityBillingSettingsFactory(
            holidays=['2025-12-25']
        )

        test_time = timezone.make_aware(datetime(2025, 12, 25, 10, 0))
        context = settings.get_price_context(timestamp=test_time)

        assert context == 'holiday'

    def test_get_price_context_weekend(self):
        """Test price context determination for weekend."""
        settings = FacilityBillingSettingsFactory()

        # Saturday
        test_time = timezone.make_aware(datetime(2025, 12, 13, 10, 0))
        context = settings.get_price_context(timestamp=test_time)

        assert context == 'weekend'

    def test_get_price_context_after_hours(self):
        """Test price context determination for after hours."""
        settings = FacilityBillingSettingsFactory(
            regular_hours_start='08:00',
            regular_hours_end='17:00'
        )

        # Monday at 20:00
        test_time = timezone.make_aware(datetime(2025, 12, 15, 20, 0))
        context = settings.get_price_context(timestamp=test_time)

        assert context == 'after_hours'

    def test_get_price_context_regular(self):
        """Test price context determination for regular hours."""
        settings = FacilityBillingSettingsFactory(
            regular_hours_start='08:00',
            regular_hours_end='17:00'
        )

        # Monday at 10:00
        test_time = timezone.make_aware(datetime(2025, 12, 15, 10, 0))
        context = settings.get_price_context(timestamp=test_time)

        assert context == 'regular'

    def test_currency_override(self):
        """Test currency override property."""
        facility = FacilityFactory(currency='GHS')
        settings = FacilityBillingSettingsFactory(
            facility=facility,
            currency_override='USD'
        )

        assert settings.currency == 'USD'

    def test_currency_from_facility(self):
        """Test currency defaults to facility currency."""
        facility = FacilityFactory(currency='GHS')
        settings = FacilityBillingSettingsFactory(
            facility=facility,
            currency_override=''
        )

        assert settings.currency == 'GHS'


# =============================================================================
# BillingRulesEngine Tests - Discount Rules
# =============================================================================

class TestBillingRulesEngineDiscounts:
    """Tests for discount rule evaluation."""

    def test_senior_discount_applies_for_patient_over_65(self):
        """Test senior discount applies for eligible patient."""
        SeniorDiscountRuleFactory(
            parameters={'min_age': 65},
            adjustment_value=Decimal('10.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=date.today() - timedelta(days=70*365)  # 70 years old
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_discount == Decimal('10.00')
        assert result.adjusted_amount == Decimal('90.00')
        assert len(result.applied_adjustments) == 1
        assert result.applied_adjustments[0].adjustment_type == 'discount'

    def test_senior_discount_does_not_apply_for_patient_under_65(self):
        """Test senior discount doesn't apply for ineligible patient."""
        SeniorDiscountRuleFactory(
            parameters={'min_age': 65},
            adjustment_value=Decimal('10.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=date.today() - timedelta(days=40*365)  # 40 years old
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_discount == Decimal('0')
        assert result.adjusted_amount == Decimal('100.00')
        assert len(result.applied_adjustments) == 0

    def test_senior_discount_with_max_discount_cap(self):
        """Test senior discount respects max_discount cap."""
        SeniorDiscountRuleFactory(
            parameters={'min_age': 65, 'max_discount': 50},
            adjustment_value=Decimal('20.00')  # Would be 200.00 on 1000.00
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=date.today() - timedelta(days=70*365)
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('1000.00'),
            patient_context=patient,
            billing_context=billing
        )

        # Should be capped at 50, not 200
        assert result.total_discount == Decimal('50')
        assert result.adjusted_amount == Decimal('950.00')

    def test_child_discount_applies_for_patient_under_12(self):
        """Test child discount applies for eligible patient."""
        ChildDiscountRuleFactory(
            parameters={'max_age': 12},
            adjustment_value=Decimal('15.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=date.today() - timedelta(days=5*365)  # 5 years old
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_discount == Decimal('15.00')
        assert result.adjusted_amount == Decimal('85.00')

    def test_child_discount_does_not_apply_for_adult(self):
        """Test child discount doesn't apply for adults."""
        ChildDiscountRuleFactory(
            parameters={'max_age': 12},
            adjustment_value=Decimal('15.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=date.today() - timedelta(days=30*365)  # 30 years old
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_discount == Decimal('0')
        assert result.adjusted_amount == Decimal('100.00')

    def test_staff_discount_applies_for_employee_patient(self):
        """Test staff discount applies for staff members."""
        StaffDiscountRuleFactory(
            adjustment_value=Decimal('20.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            is_staff_member=True
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_discount == Decimal('20.00')
        assert result.adjusted_amount == Decimal('80.00')

    def test_staff_discount_does_not_apply_for_non_staff(self):
        """Test staff discount doesn't apply for non-staff."""
        StaffDiscountRuleFactory(
            adjustment_value=Decimal('20.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            is_staff_member=False
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_discount == Decimal('0')

    def test_bulk_discount_applies_when_quantity_exceeds_threshold(self):
        """Test bulk discount applies when quantity meets threshold."""
        BulkDiscountRuleFactory(
            parameters={'min_quantity': 5},
            adjustment_value=Decimal('10.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(patient_id='123')
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('500.00'),
            patient_context=patient,
            billing_context=billing,
            quantity=10
        )

        assert result.total_discount == Decimal('50.00')
        assert result.adjusted_amount == Decimal('450.00')

    def test_bulk_discount_does_not_apply_below_threshold(self):
        """Test bulk discount doesn't apply below threshold."""
        BulkDiscountRuleFactory(
            parameters={'min_quantity': 5},
            adjustment_value=Decimal('10.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(patient_id='123')
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('300.00'),
            patient_context=patient,
            billing_context=billing,
            quantity=3
        )

        assert result.total_discount == Decimal('0')
        assert result.adjusted_amount == Decimal('300.00')


# =============================================================================
# BillingRulesEngine Tests - Surcharge Rules
# =============================================================================

class TestBillingRulesEngineSurcharges:
    """Tests for surcharge rule evaluation."""

    def test_emergency_surcharge_applies_in_emergency_context(self):
        """Test emergency surcharge applies for emergency encounters."""
        EmergencySurchargeRuleFactory(
            adjustment_value=Decimal('25.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(patient_id='123')
        billing = BillingContext(
            is_emergency=True,
            price_context='emergency'
        )

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_surcharge == Decimal('25.00')
        assert result.adjusted_amount == Decimal('125.00')

    def test_emergency_surcharge_does_not_apply_for_regular(self):
        """Test emergency surcharge doesn't apply for regular encounters."""
        EmergencySurchargeRuleFactory(
            adjustment_value=Decimal('25.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(patient_id='123')
        billing = BillingContext(
            is_emergency=False,
            price_context='regular'
        )

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_surcharge == Decimal('0')
        assert result.adjusted_amount == Decimal('100.00')

    def test_after_hours_surcharge_applies_outside_operating_hours(self):
        """Test after-hours surcharge applies for after-hours encounters."""
        AfterHoursSurchargeRuleFactory(
            adjustment_value=Decimal('15.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(patient_id='123')
        billing = BillingContext(price_context='after_hours')

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_surcharge == Decimal('15.00')
        assert result.adjusted_amount == Decimal('115.00')

    def test_weekend_surcharge_applies_on_weekend(self):
        """Test weekend surcharge applies for weekend encounters."""
        WeekendSurchargeRuleFactory(
            parameters={'include_saturday': True, 'include_sunday': True},
            adjustment_value=Decimal('10.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(patient_id='123')
        # Saturday
        billing = BillingContext(
            price_context='weekend',
            timestamp=timezone.make_aware(datetime(2025, 12, 13, 10, 0))
        )

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_surcharge == Decimal('10.00')
        assert result.adjusted_amount == Decimal('110.00')

    def test_weekend_surcharge_saturday_only(self):
        """Test weekend surcharge when only Saturday is configured."""
        WeekendSurchargeRuleFactory(
            parameters={'include_saturday': True, 'include_sunday': False},
            adjustment_value=Decimal('10.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(patient_id='123')
        # Sunday (should not apply)
        billing = BillingContext(
            price_context='weekend',
            timestamp=timezone.make_aware(datetime(2025, 12, 14, 10, 0))
        )

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_surcharge == Decimal('0')

    def test_holiday_surcharge_applies_on_holiday(self):
        """Test holiday surcharge applies for holiday encounters."""
        HolidaySurchargeRuleFactory(
            adjustment_value=Decimal('20.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(patient_id='123')
        billing = BillingContext(price_context='holiday')

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_surcharge == Decimal('20.00')
        assert result.adjusted_amount == Decimal('120.00')

    def test_minimum_charge_adjustment(self):
        """Test minimum charge applies when amount is below threshold."""
        MinimumChargeRuleFactory(
            parameters={'minimum_amount': 50}
        )

        engine = BillingRulesEngine()
        patient = PatientContext(patient_id='123')
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('30.00'),
            patient_context=patient,
            billing_context=billing
        )

        # Should add 20 to reach minimum of 50
        assert result.total_surcharge == Decimal('20.00')
        assert result.adjusted_amount == Decimal('50.00')

    def test_minimum_charge_does_not_apply_when_above_threshold(self):
        """Test minimum charge doesn't apply when amount is above threshold."""
        MinimumChargeRuleFactory(
            parameters={'minimum_amount': 50}
        )

        engine = BillingRulesEngine()
        patient = PatientContext(patient_id='123')
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_surcharge == Decimal('0')
        assert result.adjusted_amount == Decimal('100.00')


# =============================================================================
# BillingRulesEngine Tests - Rule Combination
# =============================================================================

class TestBillingRulesEngineCombination:
    """Tests for rule combination and stacking behavior."""

    def test_non_stackable_rules_apply_highest_priority_only(self):
        """Test that non-stackable rules apply only the highest priority."""
        SeniorDiscountRuleFactory(
            parameters={'min_age': 65},
            adjustment_value=Decimal('10.00'),
            priority=50,
            is_stackable=False
        )
        ChildDiscountRuleFactory(
            parameters={'max_age': 100},  # Will match everyone
            adjustment_value=Decimal('20.00'),
            priority=100,  # Lower priority
            is_stackable=False
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=date.today() - timedelta(days=70*365)  # 70 years old
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        # Only senior discount should apply (higher priority)
        assert result.total_discount == Decimal('10.00')
        assert len(result.applied_adjustments) == 1
        assert result.applied_adjustments[0].rule_type == 'senior_discount'

    def test_stackable_rules_combine_discounts(self):
        """Test that stackable rules combine their discounts."""
        SeniorDiscountRuleFactory(
            parameters={'min_age': 65},
            adjustment_value=Decimal('10.00'),
            is_stackable=True
        )
        StaffDiscountRuleFactory(
            adjustment_value=Decimal('15.00'),
            is_stackable=True
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=date.today() - timedelta(days=70*365),
            is_staff_member=True  # Both rules apply
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        # Both discounts should apply: 10 + 15 = 25
        assert result.total_discount == Decimal('25.00')
        assert result.adjusted_amount == Decimal('75.00')
        assert len(result.applied_adjustments) == 2

    def test_surcharge_and_discount_both_applied(self):
        """Test that surcharges and discounts are both applied."""
        SeniorDiscountRuleFactory(
            parameters={'min_age': 65},
            adjustment_value=Decimal('10.00'),
            is_stackable=True
        )
        EmergencySurchargeRuleFactory(
            adjustment_value=Decimal('25.00'),
            is_stackable=True
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=date.today() - timedelta(days=70*365)
        )
        billing = BillingContext(
            is_emergency=True,
            price_context='emergency'
        )

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        # Discount: 10, Surcharge: 25
        # Net: 100 - 10 + 25 = 115
        assert result.total_discount == Decimal('10.00')
        assert result.total_surcharge == Decimal('25.00')
        assert result.adjusted_amount == Decimal('115.00')

    def test_no_rules_returns_original_amount(self):
        """Test that no rules returns original amount unchanged."""
        engine = BillingRulesEngine()
        patient = PatientContext(patient_id='123')
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.original_amount == Decimal('100.00')
        assert result.adjusted_amount == Decimal('100.00')
        assert result.total_discount == Decimal('0')
        assert result.total_surcharge == Decimal('0')
        assert len(result.applied_adjustments) == 0

    def test_inactive_rules_not_evaluated(self):
        """Test that inactive rules are not evaluated."""
        SeniorDiscountRuleFactory(
            parameters={'min_age': 65},
            adjustment_value=Decimal('10.00'),
            is_active=False
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=date.today() - timedelta(days=70*365)
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_discount == Decimal('0')
        assert result.adjusted_amount == Decimal('100.00')

    def test_facility_specific_rules_override_global(self):
        """Test that facility-specific rules are evaluated alongside global rules."""
        facility = FacilityFactory()

        # Global rule
        SeniorDiscountRuleFactory(
            parameters={'min_age': 65},
            adjustment_value=Decimal('5.00'),
            facility=None,  # Global
            priority=100
        )

        # Facility-specific rule (higher priority)
        SeniorDiscountRuleFactory(
            parameters={'min_age': 65},
            adjustment_value=Decimal('15.00'),
            facility=facility,
            priority=50  # Higher priority
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=date.today() - timedelta(days=70*365)
        )
        billing = BillingContext(facility_id=str(facility.id))

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        # Should apply facility-specific rule (15%) due to higher priority
        assert result.total_discount == Decimal('15.00')

    def test_adjusted_amount_never_negative(self):
        """Test that adjusted amount is never negative."""
        SeniorDiscountRuleFactory(
            parameters={'min_age': 65},
            adjustment_value=Decimal('200.00'),  # 200% discount
            is_stackable=True
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=date.today() - timedelta(days=70*365)
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        # Should be capped at 0, not -100
        assert result.adjusted_amount == Decimal('0')


# =============================================================================
# BillingRulesEngine Tests - Filtering
# =============================================================================

class TestBillingRulesEngineFiltering:
    """Tests for rule filtering by insurance/self-pay status."""

    def test_insurance_only_rule_applies_to_insured(self):
        """Test that insurance-only rules apply to insured patients."""
        SeniorDiscountRuleFactory(
            parameters={'min_age': 65},
            adjustment_value=Decimal('10.00'),
            applies_to_insurance=True,
            applies_to_self_pay=False
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=date.today() - timedelta(days=70*365),
            has_insurance=True
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_discount == Decimal('10.00')

    def test_insurance_only_rule_does_not_apply_to_self_pay(self):
        """Test that insurance-only rules don't apply to self-pay patients."""
        SeniorDiscountRuleFactory(
            parameters={'min_age': 65},
            adjustment_value=Decimal('10.00'),
            applies_to_insurance=True,
            applies_to_self_pay=False
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=date.today() - timedelta(days=70*365),
            has_insurance=False
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_discount == Decimal('0')

    def test_self_pay_only_rule_applies_to_self_pay(self):
        """Test that self-pay-only rules apply to self-pay patients."""
        SeniorDiscountRuleFactory(
            parameters={'min_age': 65},
            adjustment_value=Decimal('10.00'),
            applies_to_insurance=False,
            applies_to_self_pay=True
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=date.today() - timedelta(days=70*365),
            has_insurance=False
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_discount == Decimal('10.00')


# =============================================================================
# BillingRulesEngine Tests - Caching
# =============================================================================

class TestBillingRulesEngineCaching:
    """Tests for rules caching behavior."""

    def test_rules_are_cached(self):
        """Test that rules are cached after first load."""
        SeniorDiscountRuleFactory()

        engine = BillingRulesEngine()
        patient = PatientContext(patient_id='123')
        billing = BillingContext()

        # First call loads from DB
        engine.evaluate(Decimal('100.00'), patient, billing)

        # Second call should use cache
        with patch.object(BillingRule.objects, 'filter') as mock_filter:
            engine.evaluate(Decimal('100.00'), patient, billing)
            mock_filter.assert_not_called()

    def test_cache_invalidation(self):
        """Test that cache is invalidated properly."""
        SeniorDiscountRuleFactory()

        engine = BillingRulesEngine()
        patient = PatientContext(patient_id='123')
        billing = BillingContext()

        # First call loads from DB
        engine.evaluate(Decimal('100.00'), patient, billing)

        # Invalidate cache
        BillingRulesEngine.invalidate_cache()

        # Next call should reload from DB
        # We verify by checking the rule is still applied
        result = engine.evaluate(
            Decimal('100.00'),
            PatientContext(
                patient_id='123',
                date_of_birth=date.today() - timedelta(days=70*365)
            ),
            billing
        )

        # Rule should still work after cache invalidation
        assert result.total_discount == Decimal('10.00')


# =============================================================================
# BillingRulesEngine Tests - Edge Cases
# =============================================================================

class TestBillingRulesEngineEdgeCases:
    """Tests for edge cases and boundary conditions."""

    def test_patient_without_date_of_birth(self):
        """Test handling patient without date of birth for age-based rules."""
        SeniorDiscountRuleFactory(parameters={'min_age': 65})

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=None  # No DOB
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        # Should not crash, just not apply the age-based discount
        assert result.total_discount == Decimal('0')
        assert result.adjusted_amount == Decimal('100.00')

    def test_zero_amount(self):
        """Test handling zero amount."""
        SeniorDiscountRuleFactory(
            parameters={'min_age': 65},
            adjustment_value=Decimal('10.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            date_of_birth=date.today() - timedelta(days=70*365)
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('0.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.original_amount == Decimal('0.00')
        assert result.adjusted_amount == Decimal('0.00')

    def test_fixed_amount_discount(self):
        """Test fixed amount discount calculation."""
        BillingRuleFactory(
            rule_type='staff_discount',
            parameters={},
            adjustment_type='fixed',
            adjustment_value=Decimal('50.00')
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            is_staff_member=True
        )
        billing = BillingContext()

        result = engine.evaluate(
            amount=Decimal('200.00'),
            patient_context=patient,
            billing_context=billing
        )

        assert result.total_discount == Decimal('50.00')
        assert result.adjusted_amount == Decimal('150.00')

    def test_multiple_rule_types_mixed(self):
        """Test multiple different rule types applied together."""
        # Discount rule
        StaffDiscountRuleFactory(
            adjustment_value=Decimal('10.00'),
            is_stackable=True,
            priority=100
        )

        # Surcharge rule
        EmergencySurchargeRuleFactory(
            adjustment_value=Decimal('20.00'),
            is_stackable=True,
            priority=50
        )

        engine = BillingRulesEngine()
        patient = PatientContext(
            patient_id='123',
            is_staff_member=True
        )
        billing = BillingContext(
            is_emergency=True,
            price_context='emergency'
        )

        result = engine.evaluate(
            amount=Decimal('100.00'),
            patient_context=patient,
            billing_context=billing
        )

        # Staff discount: -10 (10% of 100)
        # Emergency surcharge: +20 (20% of 100)
        # Net: 100 - 10 + 20 = 110
        assert result.total_discount == Decimal('10.00')
        assert result.total_surcharge == Decimal('20.00')
        assert result.adjusted_amount == Decimal('110.00')
        assert len(result.applied_adjustments) == 2


# =============================================================================
# RuleEvaluationResult Tests
# =============================================================================

class TestRuleEvaluationResult:
    """Tests for RuleEvaluationResult dataclass."""

    def test_net_adjustment_calculation(self):
        """Test net_adjustment property calculation."""
        result = RuleEvaluationResult(
            original_amount=Decimal('100.00'),
            adjusted_amount=Decimal('110.00'),
            total_discount=Decimal('10.00'),
            total_surcharge=Decimal('20.00')
        )

        assert result.net_adjustment == Decimal('10.00')  # 20 - 10

    def test_adjustment_percentage_calculation(self):
        """Test adjustment_percentage property calculation."""
        result = RuleEvaluationResult(
            original_amount=Decimal('100.00'),
            adjusted_amount=Decimal('110.00'),
            total_discount=Decimal('10.00'),
            total_surcharge=Decimal('20.00')
        )

        assert result.adjustment_percentage == Decimal('10.00')  # 10%

    def test_adjustment_percentage_zero_original(self):
        """Test adjustment_percentage when original is zero."""
        result = RuleEvaluationResult(
            original_amount=Decimal('0.00'),
            adjusted_amount=Decimal('0.00'),
            total_discount=Decimal('0.00'),
            total_surcharge=Decimal('0.00')
        )

        assert result.adjustment_percentage == Decimal('0')


# =============================================================================
# RuleAdjustment Tests
# =============================================================================

class TestRuleAdjustment:
    """Tests for RuleAdjustment dataclass."""

    def test_is_discount_property(self):
        """Test is_discount property."""
        adjustment = RuleAdjustment(
            rule_id='123',
            rule_code='SENIOR001',
            rule_name='Senior Discount',
            rule_type='senior_discount',
            adjustment_amount=Decimal('10.00'),
            adjustment_type='discount',
            description='Senior discount',
            is_stackable=False,
            priority=100
        )

        assert adjustment.is_discount is True
        assert adjustment.is_surcharge is False

    def test_is_surcharge_property(self):
        """Test is_surcharge property."""
        adjustment = RuleAdjustment(
            rule_id='123',
            rule_code='EMERG001',
            rule_name='Emergency Surcharge',
            rule_type='emergency_surcharge',
            adjustment_amount=Decimal('25.00'),
            adjustment_type='surcharge',
            description='Emergency surcharge',
            is_stackable=False,
            priority=100
        )

        assert adjustment.is_surcharge is True
        assert adjustment.is_discount is False
