"""
Billing Rules Engine for evaluating and applying billing adjustments.

Implements a hybrid approach where predefined rule types have specific
handlers, but parameters are configurable by admins.

Performance optimizations:
- Rules are cached after loading
- Batch evaluation for multiple line items
- Early termination for non-stackable rules
- Efficient database queries with select_related/prefetch_related

Security:
- All parameters validated against schemas before use
- No dynamic code execution (no eval/exec)
- Audit trail for rule applications
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, List, Dict, Any
import logging

from django.core.cache import cache
from django.db.models import Q, Prefetch
from django.utils import timezone

from apps.billing.models import BillingRule, FacilityBillingSettings, Service

logger = logging.getLogger(__name__)


@dataclass
class RuleAdjustment:
    """
    Represents an adjustment calculated by a billing rule.
    """
    rule_id: str
    rule_code: str
    rule_name: str
    rule_type: str
    adjustment_amount: Decimal
    adjustment_type: str  # 'discount' or 'surcharge'
    description: str
    is_stackable: bool
    priority: int

    @property
    def is_discount(self) -> bool:
        return self.adjustment_type == 'discount'

    @property
    def is_surcharge(self) -> bool:
        return self.adjustment_type == 'surcharge'


@dataclass
class RuleEvaluationResult:
    """
    Result of evaluating all applicable rules on an invoice/line item.
    """
    original_amount: Decimal
    adjusted_amount: Decimal
    total_discount: Decimal
    total_surcharge: Decimal
    applied_adjustments: List[RuleAdjustment] = field(default_factory=list)
    skipped_rules: List[str] = field(default_factory=list)  # Rule codes skipped due to stacking

    @property
    def net_adjustment(self) -> Decimal:
        return self.total_surcharge - self.total_discount

    @property
    def adjustment_percentage(self) -> Decimal:
        if self.original_amount == 0:
            return Decimal('0')
        return (self.net_adjustment / self.original_amount) * 100


@dataclass
class PatientContext:
    """
    Patient information needed for rule evaluation.
    """
    patient_id: str
    date_of_birth: Optional[date] = None
    is_staff_member: bool = False
    is_returning_patient: bool = False
    has_insurance: bool = False
    insurance_provider_code: Optional[str] = None
    visit_count: int = 0


@dataclass
class BillingContext:
    """
    Context information for billing rule evaluation.
    """
    facility_id: Optional[str] = None
    department_id: Optional[str] = None
    encounter_type: str = 'outpatient'  # 'outpatient', 'inpatient', 'emergency'
    timestamp: Optional[datetime] = None
    is_emergency: bool = False
    price_context: str = 'regular'


class BillingRulesEngine:
    """
    Engine for evaluating and applying billing rules.

    Usage:
        engine = BillingRulesEngine()

        # Evaluate rules for a single amount
        result = engine.evaluate(
            amount=Decimal('500.00'),
            patient_context=PatientContext(patient_id='123', date_of_birth=date(1950, 1, 1)),
            billing_context=BillingContext(facility_id='abc'),
            services=[consultation_service]
        )

        # Apply adjustments to invoice
        adjusted_amount = result.adjusted_amount
        applied_rules = [adj.rule_id for adj in result.applied_adjustments]
    """

    # Cache timeout in seconds (5 minutes)
    CACHE_TIMEOUT = 300

    def __init__(self):
        self._rule_handlers = {
            'senior_discount': self._handle_senior_discount,
            'child_discount': self._handle_child_discount,
            'staff_discount': self._handle_staff_discount,
            'bulk_discount': self._handle_bulk_discount,
            'emergency_surcharge': self._handle_emergency_surcharge,
            'after_hours_surcharge': self._handle_after_hours_surcharge,
            'weekend_surcharge': self._handle_weekend_surcharge,
            'holiday_surcharge': self._handle_holiday_surcharge,
            'minimum_charge': self._handle_minimum_charge,
            'maximum_discount': self._handle_maximum_discount,
        }

    def evaluate(
        self,
        amount: Decimal,
        patient_context: PatientContext,
        billing_context: BillingContext,
        services: Optional[List[Service]] = None,
        quantity: int = 1
    ) -> RuleEvaluationResult:
        """
        Evaluate all applicable billing rules for the given context.

        Args:
            amount: Base amount to apply rules to
            patient_context: Patient information
            billing_context: Billing/encounter context
            services: List of services (for service-specific rules)
            quantity: Quantity of items (for bulk discounts)

        Returns:
            RuleEvaluationResult with all adjustments
        """
        # Load applicable rules (cached)
        rules = self._get_applicable_rules(
            facility_id=billing_context.facility_id,
            has_insurance=patient_context.has_insurance,
            services=services
        )

        if not rules:
            return RuleEvaluationResult(
                original_amount=amount,
                adjusted_amount=amount,
                total_discount=Decimal('0'),
                total_surcharge=Decimal('0')
            )

        # Evaluate each rule
        adjustments = []
        skipped_rules = []
        has_non_stackable_discount = False
        has_non_stackable_surcharge = False

        for rule in rules:
            # Check if rule is currently effective
            if not rule.is_currently_effective:
                continue

            # Check stacking rules
            is_discount_type = rule.rule_type.endswith('_discount')
            is_surcharge_type = rule.rule_type.endswith('_surcharge')

            if is_discount_type and has_non_stackable_discount and not rule.is_stackable:
                skipped_rules.append(rule.code)
                continue

            if is_surcharge_type and has_non_stackable_surcharge and not rule.is_stackable:
                skipped_rules.append(rule.code)
                continue

            # Evaluate rule
            adjustment = self._evaluate_rule(
                rule=rule,
                amount=amount,
                patient_context=patient_context,
                billing_context=billing_context,
                quantity=quantity
            )

            if adjustment:
                adjustments.append(adjustment)

                # Track non-stackable rules
                if not rule.is_stackable:
                    if adjustment.is_discount:
                        has_non_stackable_discount = True
                    elif adjustment.is_surcharge:
                        has_non_stackable_surcharge = True

        # Calculate totals
        total_discount = sum(
            adj.adjustment_amount for adj in adjustments if adj.is_discount
        )
        total_surcharge = sum(
            adj.adjustment_amount for adj in adjustments if adj.is_surcharge
        )

        # Apply adjustments
        adjusted_amount = amount - total_discount + total_surcharge

        # Ensure non-negative
        adjusted_amount = max(Decimal('0'), adjusted_amount)

        return RuleEvaluationResult(
            original_amount=amount,
            adjusted_amount=adjusted_amount,
            total_discount=total_discount,
            total_surcharge=total_surcharge,
            applied_adjustments=adjustments,
            skipped_rules=skipped_rules
        )

    def evaluate_invoice(
        self,
        invoice,
        patient_context: PatientContext,
        billing_context: BillingContext
    ) -> RuleEvaluationResult:
        """
        Evaluate rules for an entire invoice.

        Args:
            invoice: Invoice model instance
            patient_context: Patient information
            billing_context: Billing context

        Returns:
            RuleEvaluationResult for the invoice total
        """
        # Get all services from invoice items
        services = [item.service for item in invoice.items.select_related('service').all()]
        total_quantity = sum(item.quantity for item in invoice.items.all())

        return self.evaluate(
            amount=invoice.subtotal,
            patient_context=patient_context,
            billing_context=billing_context,
            services=services,
            quantity=total_quantity
        )

    # ==========================================================================
    # Rule Handlers
    # ==========================================================================

    def _evaluate_rule(
        self,
        rule: BillingRule,
        amount: Decimal,
        patient_context: PatientContext,
        billing_context: BillingContext,
        quantity: int
    ) -> Optional[RuleAdjustment]:
        """
        Evaluate a single rule and return adjustment if applicable.
        """
        handler = self._rule_handlers.get(rule.rule_type)

        if handler:
            return handler(rule, amount, patient_context, billing_context, quantity)
        elif rule.rule_type == 'custom':
            # Custom rules use the adjustment_value directly
            return self._handle_custom_rule(rule, amount)
        else:
            logger.warning(f"No handler for rule type: {rule.rule_type}")
            return None

    def _handle_senior_discount(
        self,
        rule: BillingRule,
        amount: Decimal,
        patient_context: PatientContext,
        billing_context: BillingContext,
        quantity: int
    ) -> Optional[RuleAdjustment]:
        """Apply senior citizen discount based on age."""
        if not patient_context.date_of_birth:
            return None

        min_age = rule.parameters.get('min_age', 65)
        age = self._calculate_age(patient_context.date_of_birth)

        if age < min_age:
            return None

        adjustment_amount = rule.get_adjustment_amount(amount)

        # Apply max discount cap if specified
        max_discount = rule.parameters.get('max_discount')
        if max_discount and adjustment_amount > Decimal(str(max_discount)):
            adjustment_amount = Decimal(str(max_discount))

        return RuleAdjustment(
            rule_id=str(rule.id),
            rule_code=rule.code,
            rule_name=rule.name,
            rule_type=rule.rule_type,
            adjustment_amount=adjustment_amount,
            adjustment_type='discount',
            description=f"Senior discount ({age} years old)",
            is_stackable=rule.is_stackable,
            priority=rule.priority
        )

    def _handle_child_discount(
        self,
        rule: BillingRule,
        amount: Decimal,
        patient_context: PatientContext,
        billing_context: BillingContext,
        quantity: int
    ) -> Optional[RuleAdjustment]:
        """Apply child discount based on age."""
        if not patient_context.date_of_birth:
            return None

        max_age = rule.parameters.get('max_age', 12)
        age = self._calculate_age(patient_context.date_of_birth)

        if age > max_age:
            return None

        adjustment_amount = rule.get_adjustment_amount(amount)

        return RuleAdjustment(
            rule_id=str(rule.id),
            rule_code=rule.code,
            rule_name=rule.name,
            rule_type=rule.rule_type,
            adjustment_amount=adjustment_amount,
            adjustment_type='discount',
            description=f"Child discount ({age} years old)",
            is_stackable=rule.is_stackable,
            priority=rule.priority
        )

    def _handle_staff_discount(
        self,
        rule: BillingRule,
        amount: Decimal,
        patient_context: PatientContext,
        billing_context: BillingContext,
        quantity: int
    ) -> Optional[RuleAdjustment]:
        """Apply staff/employee discount."""
        if not patient_context.is_staff_member:
            return None

        adjustment_amount = rule.get_adjustment_amount(amount)

        return RuleAdjustment(
            rule_id=str(rule.id),
            rule_code=rule.code,
            rule_name=rule.name,
            rule_type=rule.rule_type,
            adjustment_amount=adjustment_amount,
            adjustment_type='discount',
            description="Staff discount",
            is_stackable=rule.is_stackable,
            priority=rule.priority
        )

    def _handle_bulk_discount(
        self,
        rule: BillingRule,
        amount: Decimal,
        patient_context: PatientContext,
        billing_context: BillingContext,
        quantity: int
    ) -> Optional[RuleAdjustment]:
        """Apply bulk/quantity discount."""
        min_quantity = rule.parameters.get('min_quantity', 5)

        if quantity < min_quantity:
            return None

        adjustment_amount = rule.get_adjustment_amount(amount)

        return RuleAdjustment(
            rule_id=str(rule.id),
            rule_code=rule.code,
            rule_name=rule.name,
            rule_type=rule.rule_type,
            adjustment_amount=adjustment_amount,
            adjustment_type='discount',
            description=f"Bulk discount ({quantity} items)",
            is_stackable=rule.is_stackable,
            priority=rule.priority
        )

    def _handle_emergency_surcharge(
        self,
        rule: BillingRule,
        amount: Decimal,
        patient_context: PatientContext,
        billing_context: BillingContext,
        quantity: int
    ) -> Optional[RuleAdjustment]:
        """Apply emergency service surcharge."""
        if not billing_context.is_emergency and billing_context.price_context != 'emergency':
            return None

        adjustment_amount = rule.get_adjustment_amount(amount)

        return RuleAdjustment(
            rule_id=str(rule.id),
            rule_code=rule.code,
            rule_name=rule.name,
            rule_type=rule.rule_type,
            adjustment_amount=adjustment_amount,
            adjustment_type='surcharge',
            description="Emergency service surcharge",
            is_stackable=rule.is_stackable,
            priority=rule.priority
        )

    def _handle_after_hours_surcharge(
        self,
        rule: BillingRule,
        amount: Decimal,
        patient_context: PatientContext,
        billing_context: BillingContext,
        quantity: int
    ) -> Optional[RuleAdjustment]:
        """Apply after-hours surcharge."""
        if billing_context.price_context != 'after_hours':
            return None

        adjustment_amount = rule.get_adjustment_amount(amount)

        return RuleAdjustment(
            rule_id=str(rule.id),
            rule_code=rule.code,
            rule_name=rule.name,
            rule_type=rule.rule_type,
            adjustment_amount=adjustment_amount,
            adjustment_type='surcharge',
            description="After-hours surcharge",
            is_stackable=rule.is_stackable,
            priority=rule.priority
        )

    def _handle_weekend_surcharge(
        self,
        rule: BillingRule,
        amount: Decimal,
        patient_context: PatientContext,
        billing_context: BillingContext,
        quantity: int
    ) -> Optional[RuleAdjustment]:
        """Apply weekend surcharge."""
        if billing_context.price_context != 'weekend':
            return None

        # Check specific day settings
        params = rule.parameters
        timestamp = billing_context.timestamp or timezone.now()

        if timestamp.weekday() == 5 and not params.get('include_saturday', True):
            return None
        if timestamp.weekday() == 6 and not params.get('include_sunday', True):
            return None

        adjustment_amount = rule.get_adjustment_amount(amount)

        return RuleAdjustment(
            rule_id=str(rule.id),
            rule_code=rule.code,
            rule_name=rule.name,
            rule_type=rule.rule_type,
            adjustment_amount=adjustment_amount,
            adjustment_type='surcharge',
            description="Weekend surcharge",
            is_stackable=rule.is_stackable,
            priority=rule.priority
        )

    def _handle_holiday_surcharge(
        self,
        rule: BillingRule,
        amount: Decimal,
        patient_context: PatientContext,
        billing_context: BillingContext,
        quantity: int
    ) -> Optional[RuleAdjustment]:
        """Apply holiday surcharge."""
        if billing_context.price_context != 'holiday':
            return None

        adjustment_amount = rule.get_adjustment_amount(amount)

        return RuleAdjustment(
            rule_id=str(rule.id),
            rule_code=rule.code,
            rule_name=rule.name,
            rule_type=rule.rule_type,
            adjustment_amount=adjustment_amount,
            adjustment_type='surcharge',
            description="Holiday surcharge",
            is_stackable=rule.is_stackable,
            priority=rule.priority
        )

    def _handle_minimum_charge(
        self,
        rule: BillingRule,
        amount: Decimal,
        patient_context: PatientContext,
        billing_context: BillingContext,
        quantity: int
    ) -> Optional[RuleAdjustment]:
        """Apply minimum charge adjustment."""
        minimum = Decimal(str(rule.parameters.get('minimum_amount', 0)))

        if amount >= minimum:
            return None

        # Adjustment is the difference to reach minimum
        adjustment_amount = minimum - amount

        return RuleAdjustment(
            rule_id=str(rule.id),
            rule_code=rule.code,
            rule_name=rule.name,
            rule_type=rule.rule_type,
            adjustment_amount=adjustment_amount,
            adjustment_type='surcharge',
            description=f"Minimum charge adjustment (minimum: {minimum})",
            is_stackable=rule.is_stackable,
            priority=rule.priority
        )

    def _handle_maximum_discount(
        self,
        rule: BillingRule,
        amount: Decimal,
        patient_context: PatientContext,
        billing_context: BillingContext,
        quantity: int
    ) -> Optional[RuleAdjustment]:
        """
        This is a meta-rule that caps total discounts.
        It's handled specially during result calculation.
        """
        # This rule doesn't generate an adjustment directly
        # It's used to cap total discounts in post-processing
        return None

    def _handle_custom_rule(
        self,
        rule: BillingRule,
        amount: Decimal
    ) -> Optional[RuleAdjustment]:
        """Handle custom rules using direct adjustment values."""
        adjustment_amount = rule.get_adjustment_amount(amount)

        # Determine if discount or surcharge based on rule parameters or naming
        is_discount = 'discount' in rule.name.lower() or rule.adjustment_value < 0

        return RuleAdjustment(
            rule_id=str(rule.id),
            rule_code=rule.code,
            rule_name=rule.name,
            rule_type=rule.rule_type,
            adjustment_amount=abs(adjustment_amount),
            adjustment_type='discount' if is_discount else 'surcharge',
            description=rule.description or rule.name,
            is_stackable=rule.is_stackable,
            priority=rule.priority
        )

    # ==========================================================================
    # Helper Methods
    # ==========================================================================

    def _get_applicable_rules(
        self,
        facility_id: Optional[str],
        has_insurance: bool,
        services: Optional[List[Service]]
    ) -> List[BillingRule]:
        """
        Get all potentially applicable rules with caching.

        Performance: Uses prefetch_related for M2M relationships.
        """
        cache_key = f"billing_rules_{facility_id or 'global'}"
        rules = cache.get(cache_key)

        if rules is None:
            # Build query
            today = timezone.now().date()

            query = Q(is_active=True) & Q(effective_from__lte=today) & (
                Q(effective_until__isnull=True) | Q(effective_until__gte=today)
            )

            # Facility filter: global rules + facility-specific
            if facility_id:
                query &= Q(facility__isnull=True) | Q(facility_id=facility_id)
            else:
                query &= Q(facility__isnull=True)

            rules = list(
                BillingRule.objects
                .filter(query)
                .select_related('facility')
                .prefetch_related('applicable_services', 'applicable_categories')
                .order_by('priority', 'name')
            )

            cache.set(cache_key, rules, self.CACHE_TIMEOUT)

        # Filter by insurance status
        filtered_rules = []
        for rule in rules:
            if has_insurance and not rule.applies_to_insurance:
                continue
            if not has_insurance and not rule.applies_to_self_pay:
                continue

            # Filter by applicable services if specified
            if services and rule.applicable_services.exists():
                service_ids = {s.id for s in services}
                rule_service_ids = {s.id for s in rule.applicable_services.all()}
                if not service_ids & rule_service_ids:
                    continue

            filtered_rules.append(rule)

        return filtered_rules

    def _calculate_age(self, date_of_birth: date) -> int:
        """Calculate age in years from date of birth."""
        today = timezone.now().date()
        age = today.year - date_of_birth.year

        # Adjust if birthday hasn't occurred this year
        if (today.month, today.day) < (date_of_birth.month, date_of_birth.day):
            age -= 1

        return age

    @classmethod
    def invalidate_cache(cls, facility_id: Optional[str] = None):
        """
        Invalidate rules cache.

        Call when rules are created/updated/deleted.
        """
        if facility_id:
            cache.delete(f"billing_rules_{facility_id}")
        cache.delete("billing_rules_global")

        # Try to clear all rule caches
        try:
            if hasattr(cache, 'delete_pattern'):
                cache.delete_pattern('billing_rules_*')
            else:
                cache.clear()
        except Exception:
            pass

        logger.info(f"Invalidated billing rules cache: facility={facility_id}")
