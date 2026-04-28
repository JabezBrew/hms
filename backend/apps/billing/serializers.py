from decimal import Decimal
from rest_framework import serializers
from .models import (
    ServiceCategory, Service, ServicePrice, InsuranceProvider, InsurancePlan,
    PayerServiceCode,
    PatientInsurance, Invoice, InvoiceItem, Payment, Claim, Receipt,
    ClaimValidationIssue, NHISClaimBatch, NHISClaimExportJob,
    RemittanceImportJob, RemittanceLine, InsurancePosting,
    PayerServiceCodeImportJob,
    BillingRule, FacilityBillingSettings,
    CashDrawer, CashSession, CashMovement,
    PaymentIntent, PSPWebhookEvent, SettlementBatch, SettlementLine
)
from ..users.serializers import PatientProfileSerializer, UserSerializer


class ServiceCategorySerializer(serializers.ModelSerializer):
    """
    Serializer for the ServiceCategory model.
    """
    class Meta:
        model = ServiceCategory
        fields = ['id', 'facility', 'name', 'description', 'is_active',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'facility', 'created_at', 'updated_at', 'created_by', 'updated_by']


class ServiceSerializer(serializers.ModelSerializer):
    """
    Serializer for the Service model.
    """
    category_name = serializers.ReadOnlyField(source='category.name')
    total_price = serializers.ReadOnlyField()
    
    class Meta:
        model = Service
        fields = ['id', 'facility', 'name', 'description', 'category', 'category_name',
                  'code', 'base_price', 'tax_rate', 'is_active', 'total_price',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'facility', 'created_at', 'updated_at', 'created_by', 'updated_by']


class InsuranceProviderSerializer(serializers.ModelSerializer):
    """
    Serializer for the InsuranceProvider model.
    """
    class Meta:
        model = InsuranceProvider
        fields = ['id', 'facility', 'name', 'code', 'payer_type', 'contact_person', 'email', 'phone',
                  'address', 'is_active', 'created_at', 'updated_at',
                  'created_by', 'updated_by']
        read_only_fields = ['id', 'facility', 'created_at', 'updated_at', 'created_by', 'updated_by']


class InsurancePlanSerializer(serializers.ModelSerializer):
    """
    Serializer for the InsurancePlan model.
    """
    provider_name = serializers.ReadOnlyField(source='provider.name')
    
    class Meta:
        model = InsurancePlan
        fields = ['id', 'facility', 'provider', 'provider_name', 'name', 'code',
                  'description', 'coverage_percentage', 'annual_limit',
                  'is_active', 'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'facility', 'created_at', 'updated_at', 'created_by', 'updated_by']


class PayerServiceCodeSerializer(serializers.ModelSerializer):
    payer_name = serializers.ReadOnlyField(source='payer.name')
    payer_code = serializers.ReadOnlyField(source='payer.code')
    service_name = serializers.ReadOnlyField(source='service.name')
    service_code = serializers.ReadOnlyField(source='service.code')

    class Meta:
        model = PayerServiceCode
        fields = [
            'id', 'facility',
            'payer', 'payer_name', 'payer_code',
            'service', 'service_name', 'service_code',
            'external_code',
            'effective_from', 'effective_until',
            'is_active',
            'created_at', 'updated_at', 'created_by', 'updated_by',
        ]
        read_only_fields = ['id', 'facility', 'created_at', 'updated_at', 'created_by', 'updated_by']


class PatientInsuranceSerializer(serializers.ModelSerializer):
    """
    Serializer for the PatientInsurance model.
    """
    patient_details = PatientProfileSerializer(source='patient', read_only=True)
    plan_details = InsurancePlanSerializer(source='plan', read_only=True)
    is_valid = serializers.ReadOnlyField()
    
    class Meta:
        model = PatientInsurance
        fields = ['id', 'patient', 'patient_details', 'plan', 'plan_details',
                  'policy_number', 'valid_from', 'valid_until', 'is_active',
                  'is_valid', 'notes', 'created_at', 'updated_at',
                  'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class InvoiceItemSerializer(serializers.ModelSerializer):
    """
    Serializer for the InvoiceItem model.
    """
    service_name = serializers.ReadOnlyField(source='service.name')
    subtotal = serializers.ReadOnlyField()
    discount_amount = serializers.ReadOnlyField()
    tax_amount = serializers.ReadOnlyField()
    total_price = serializers.ReadOnlyField()
    
    class Meta:
        model = InvoiceItem
        fields = ['id', 'invoice', 'service', 'service_name', 'quantity',
                  'unit_price', 'tax_rate', 'discount_percentage', 'description',
                  'subtotal', 'discount_amount', 'tax_amount', 'total_price',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class InvoiceItemCreateSerializer(serializers.ModelSerializer):
    """
    Minimal serializer for creating invoice line items.

    SECURITY:
    - unit_price is not accepted from the client; server resolves pricing.
    """
    class Meta:
        model = InvoiceItem
        fields = ['service', 'quantity', 'description']


class PaymentSerializer(serializers.ModelSerializer):
    """
    Serializer for the Payment model.
    """
    created_by_details = UserSerializer(source='created_by', read_only=True)
    receipt_number = serializers.CharField(source='receipt.receipt_number', read_only=True, default=None)
    receipt_id = serializers.UUIDField(source='receipt.id', read_only=True, default=None)
    receipt_date = serializers.DateField(source='receipt.receipt_date', read_only=True, default=None)

    class Meta:
        model = Payment
        fields = ['id', 'invoice', 'payment_date', 'amount', 'payment_method',
                  'payer', 'status',
                  'reference_number', 'notes',
                  'cash_session',
                  'voided_at', 'voided_by', 'void_reason',
                  'created_at', 'updated_at',
                  'created_by', 'created_by_details', 'updated_by',
                  'receipt_number', 'receipt_id', 'receipt_date']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class PaymentIntentListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for payment intents list.
    """
    invoice_number = serializers.ReadOnlyField(source='invoice.invoice_number')

    class Meta:
        model = PaymentIntent
        fields = [
            'id', 'invoice', 'invoice_number',
            'amount', 'currency', 'payment_method',
            'status', 'provider', 'provider_reference',
            'created_at',
        ]


class PaymentIntentSerializer(serializers.ModelSerializer):
    invoice_number = serializers.ReadOnlyField(source='invoice.invoice_number')
    payment_id = serializers.UUIDField(source='payment.id', read_only=True, default=None)

    class Meta:
        model = PaymentIntent
        fields = [
            'id', 'facility', 'invoice', 'invoice_number',
            'payer', 'amount', 'currency', 'payment_method',
            'status', 'provider', 'client_reference', 'provider_reference',
            'checkout_url', 'expires_at',
            'cash_session', 'initiated_by',
            'payment_id', 'paid_amount', 'fee_amount', 'paid_at',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'facility', 'payer', 'status',
            'provider_reference', 'checkout_url', 'expires_at',
            'client_reference',
            'initiated_by', 'payment_id', 'paid_amount', 'fee_amount', 'paid_at',
            'created_at', 'updated_at',
        ]


class PaymentIntentCreateSerializer(serializers.Serializer):
    """
    Create a PSP payment intent.

    SECURITY:
    - Amount is capped server-side by invoice.patient_balance_due.
    """
    invoice_id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    payment_method = serializers.ChoiceField(choices=[
        'mobile_money',
        'credit_card',
        'debit_card',
    ])
    mobile_number = serializers.CharField(max_length=30)


class SettlementLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = SettlementLine
        fields = [
            'id',
            'provider_reference', 'client_reference', 'status',
            'amount_gross', 'fee_amount', 'amount_net', 'paid_at',
            'match_status', 'matched_intent', 'matched_payment', 'mismatch_reason',
            'created_at',
        ]
        read_only_fields = fields


class SettlementBatchSerializer(serializers.ModelSerializer):
    uploaded_by_email = serializers.ReadOnlyField(source='uploaded_by.email', default=None)

    class Meta:
        model = SettlementBatch
        fields = [
            'id', 'facility', 'provider', 'statement_date',
            'status', 'file_name', 'error_message',
            'uploaded_by', 'uploaded_by_email', 'processed_at',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'facility', 'status',
            'error_message', 'uploaded_by', 'uploaded_by_email', 'processed_at',
            'created_at', 'updated_at',
        ]


class ReceiptSerializer(serializers.ModelSerializer):
    """
    Serializer for the Receipt model.
    """
    payment_details = PaymentSerializer(source='payment', read_only=True)
    
    class Meta:
        model = Receipt
        fields = ['id', 'receipt_number', 'payment', 'payment_details',
                  'receipt_date', 'notes', 'created_at', 'updated_at',
                  'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class ClaimSerializer(serializers.ModelSerializer):
    """
    Serializer for the Claim model.
    """
    invoice_number = serializers.ReadOnlyField(source='invoice.invoice_number')
    patient_name = serializers.ReadOnlyField(source='invoice.patient.user.get_full_name')
    is_fully_approved = serializers.ReadOnlyField()
    is_partially_approved = serializers.ReadOnlyField()
    
    class Meta:
        model = Claim
        fields = ['id', 'claim_number', 'invoice', 'invoice_number', 'patient_name',
                  'batch', 'submission_date', 'submitted_at', 'submitted_by', 'submission_reference',
                  'paid_amount_total', 'last_paid_at',
                  'fhir_claim_id', 'fhir_explanation_of_benefit_id',
                  'status', 'claimed_amount', 'approved_amount', 'response_date',
                  'rejection_reason', 'is_fully_approved', 'is_partially_approved',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class InvoiceSerializer(serializers.ModelSerializer):
    """
    Serializer for the Invoice model.
    """
    patient_details = PatientProfileSerializer(source='patient', read_only=True)
    items = InvoiceItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    patient_insurance_details = PatientInsuranceSerializer(source='patient_insurance', read_only=True)
    amount_paid = serializers.ReadOnlyField()
    balance_due = serializers.ReadOnlyField()
    is_fully_paid = serializers.ReadOnlyField()
    # CFO-grade breakdown (minimal fields; no PHI)
    patient_paid = serializers.ReadOnlyField()
    insurance_paid = serializers.ReadOnlyField()
    total_paid = serializers.ReadOnlyField()
    patient_balance_due = serializers.ReadOnlyField()
    insurance_balance_due = serializers.ReadOnlyField()
    total_balance_due = serializers.ReadOnlyField()
    is_patient_paid = serializers.ReadOnlyField()
    
    class Meta:
        model = Invoice
        fields = ['id', 'invoice_number', 'patient', 'patient_details',
                  'invoice_date', 'due_date', 'admission', 'appointment_type',
                  'fhir_encounter_id', 'fhir_claim_id', 'subtotal', 'tax_amount',
                  'discount_amount', 'total_amount', 'patient_insurance',
                  'patient_insurance_details', 'insurance_amount',
                  'patient_responsibility', 'status', 'auto_update_enabled', 'notes', 'items', 'payments',
                  'amount_paid', 'balance_due', 'is_fully_paid',
                  'patient_paid', 'insurance_paid', 'total_paid',
                  'patient_balance_due', 'insurance_balance_due', 'total_balance_due',
                  'is_patient_paid',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'subtotal', 'tax_amount', 'total_amount',
                           'insurance_amount', 'patient_responsibility',
                           'created_at', 'updated_at', 'created_by', 'updated_by']


class InvoiceCreateUpdateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating and updating Invoice with nested items.
    """
    items = InvoiceItemCreateSerializer(many=True)
    
    class Meta:
        model = Invoice
        fields = ['id', 'patient', 'invoice_date', 'due_date',
                  'admission', 'appointment_type', 'fhir_encounter_id',
                  'fhir_claim_id', 'discount_amount', 'patient_insurance',
                  'status', 'notes', 'items']
        read_only_fields = ['id']
    
    def create(self, validated_data):
        """
        Create invoice from services (server generates invoice_number and resolves pricing).

        SECURITY:
        - facility is derived from active facility context, not client input
        - unit_price from client is ignored; PricingService resolves the authoritative price
        """
        from apps.core.security import get_user_facility
        from apps.billing.services import InvoiceGenerationService, ServiceLine
        from rest_framework.exceptions import PermissionDenied

        request = self.context.get('request')
        facility = get_user_facility(request)
        if not facility:
            raise PermissionDenied("Facility context is required.")

        patient = validated_data.get('patient')
        if patient and getattr(patient, 'facility_id', None) and patient.facility_id != facility.id:
            raise PermissionDenied("Patient does not belong to the active facility.")

        items_data = validated_data.pop('items')
        services = []
        for item in items_data:
            service = item.get('service')
            if not service:
                raise serializers.ValidationError({'items': 'Each item must include a service.'})
            if getattr(service, 'facility_id', None) != facility.id:
                raise PermissionDenied("Service does not belong to the active facility.")
            if not getattr(service, 'is_active', True):
                raise serializers.ValidationError({'items': f"Service is inactive: {service.id}"})

            try:
                quantity = int(item.get('quantity') or 1)
            except (TypeError, ValueError):
                raise serializers.ValidationError({'items': 'quantity must be an integer.'})
            if quantity <= 0:
                raise serializers.ValidationError({'items': 'quantity must be greater than zero.'})

            services.append(ServiceLine(
                service=service,
                quantity=quantity,
                description=item.get('description') or None,
            ))

        created_by = (
            validated_data.get('created_by') or
            (request.user if request and getattr(request, 'user', None) and request.user.is_authenticated else None)
        )

        service = InvoiceGenerationService()
        result = service.create_invoice(
            patient=patient,
            facility=facility,
            services=services,
            created_by=created_by,
            notes=validated_data.get('notes'),
            patient_insurance=validated_data.get('patient_insurance'),
        )
        if not result.success:
            raise serializers.ValidationError({'detail': result.error_message or 'Failed to create invoice'})
        invoice = result.invoice

        # Allow explicit due_date override for manual invoice creation.
        due_date = validated_data.get('due_date')
        if due_date:
            invoice.due_date = due_date
            invoice.save(update_fields=['due_date', 'updated_at'])

        return invoice
    
    def update(self, instance, validated_data):
        # For v1 cash controls, treat invoice line items as immutable once created.
        validated_data.pop('items', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        instance.save()
        return instance


# =============================================================================
# LIST SERIALIZERS - Lightweight serializers for list views
# These reduce payload sizes by 50-85% compared to full serializers
# =============================================================================

class ServiceListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for service lists.
    Removes timestamps and audit fields.

    Payload reduction: ~40% (8 fields vs 14)
    """
    category_name = serializers.ReadOnlyField(source='category.name')
    total_price = serializers.ReadOnlyField()

    class Meta:
        model = Service
        fields = [
            'id', 'name', 'code', 'category', 'category_name',
            'base_price', 'total_price', 'is_active'
        ]


class InvoiceListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for invoice lists.
    Removes nested items, payments, and patient details.

    Payload reduction: ~85% (~1.5KB vs ~10KB per item)
    """
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    facility_name = serializers.CharField(source='facility.name', read_only=True, default=None)
    facility_code = serializers.CharField(source='facility.code', read_only=True, default=None)
    items_count = serializers.SerializerMethodField()
    payments_count = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = [
            'id', 'invoice_number', 'patient', 'patient_name', 'patient_mrn',
            'facility', 'facility_name', 'facility_code',
            'invoice_date', 'due_date', 'total_amount', 'status', 'auto_update_enabled',
            'amount_paid', 'balance_due', 'is_fully_paid',
            'items_count', 'payments_count', 'price_context'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return None

    def get_items_count(self, obj):
        annotated = getattr(obj, 'items_count', None)
        if annotated is not None:
            return annotated
        return obj.items.count()

    def get_payments_count(self, obj):
        annotated = getattr(obj, 'payments_count', None)
        if annotated is not None:
            return annotated
        return obj.payments.count()


class PaymentListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for payment lists.
    Flattens invoice/patient/receipt info for efficient listing.

    Payload reduction: ~50% (12 fields vs full nested details)
    """
    invoice_number = serializers.CharField(source='invoice.invoice_number', read_only=True)
    patient_name = serializers.SerializerMethodField()
    patient_id = serializers.UUIDField(source='invoice.patient.id', read_only=True)
    patient_mrn = serializers.CharField(source='invoice.patient.medical_record_number', read_only=True)
    receipt_number = serializers.CharField(source='receipt.receipt_number', read_only=True, default=None)
    receipt_id = serializers.UUIDField(source='receipt.id', read_only=True, default=None)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            'id', 'invoice', 'invoice_number', 'patient_id', 'patient_name',
            'patient_mrn', 'payment_date', 'amount', 'payment_method',
            'payer', 'status',
            'reference_number', 'receipt_number', 'receipt_id',
            'created_by_name', 'created_at'
        ]

    def get_patient_name(self, obj):
        if obj.invoice and obj.invoice.patient and obj.invoice.patient.user:
            return obj.invoice.patient.user.get_full_name()
        return None

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name()
        return None


class ClaimListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for claim lists.

    Payload reduction: ~40% (12 fields vs 20)
    """
    invoice_number = serializers.ReadOnlyField(source='invoice.invoice_number')
    patient_name = serializers.ReadOnlyField(source='invoice.patient.user.get_full_name')

    class Meta:
        model = Claim
        fields = [
            'id', 'claim_number', 'invoice', 'invoice_number', 'patient_name',
            'batch', 'submission_date', 'status', 'claimed_amount', 'approved_amount',
            'response_date', 'is_fully_approved', 'is_partially_approved'
        ]


class ClaimValidationIssueSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClaimValidationIssue
        fields = ['id', 'claim', 'severity', 'code', 'message', 'field', 'created_at']
        read_only_fields = fields


class NHISClaimBatchListSerializer(serializers.ModelSerializer):
    claim_count = serializers.IntegerField(read_only=True)
    total_claimed_amount = serializers.DecimalField(
        read_only=True, max_digits=10, decimal_places=2, default=Decimal('0.00')
    )

    class Meta:
        model = NHISClaimBatch
        fields = [
            'id', 'facility',
            'period_start', 'period_end',
            'status',
            'claim_count', 'total_claimed_amount',
            'created_at',
        ]
        read_only_fields = fields


class NHISClaimBatchSerializer(serializers.ModelSerializer):
    class Meta:
        model = NHISClaimBatch
        fields = [
            'id', 'facility',
            'period_start', 'period_end',
            'status', 'notes',
            'created_by', 'updated_by',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'facility', 'created_by', 'updated_by', 'created_at', 'updated_at']


class NHISClaimExportJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = NHISClaimExportJob
        fields = [
            'id', 'facility', 'batch',
            'status', 'payload_checksum', 'error_message', 'expires_at',
            'created_by', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'facility', 'status', 'payload_checksum', 'error_message',
            'created_by', 'created_at', 'updated_at',
        ]


class RemittanceImportJobSerializer(serializers.ModelSerializer):
    payer_name = serializers.ReadOnlyField(source='payer.name')

    class Meta:
        model = RemittanceImportJob
        fields = [
            'id', 'facility', 'payer', 'payer_name',
            'status', 'file_name', 'payload_checksum', 'error_message',
            'processed_at',
            'created_by', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'facility', 'status', 'payload_checksum', 'error_message',
            'processed_at',
            'created_by', 'created_at', 'updated_at',
        ]


class RemittanceLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = RemittanceLine
        fields = [
            'id', 'job',
            'claim_number', 'invoice_number',
            'paid_amount', 'paid_date',
            'match_status',
            'matched_claim', 'matched_invoice',
            'error_message',
            'created_at',
        ]
        read_only_fields = fields


class PayerServiceCodeImportJobSerializer(serializers.ModelSerializer):
    payer_name = serializers.ReadOnlyField(source='payer.name')
    payer_code = serializers.ReadOnlyField(source='payer.code')

    class Meta:
        model = PayerServiceCodeImportJob
        fields = [
            'id', 'facility',
            'payer', 'payer_name', 'payer_code',
            'status', 'seed_services',
            'file_name', 'payload_checksum',
            'summary', 'issues', 'error_message',
            'processed_at', 'applied_at',
            'created_by', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'facility',
            'status',
            'file_name', 'payload_checksum',
            'summary', 'issues', 'error_message',
            'processed_at', 'applied_at',
            'created_by', 'created_at', 'updated_at',
        ]


class PatientInsuranceListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for patient insurance lists.
    Removes nested patient and plan details.

    Payload reduction: ~60% (10 fields vs full nested details)
    """
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(source='patient.medical_record_number', read_only=True)
    plan_name = serializers.CharField(source='plan.name', read_only=True)
    provider_name = serializers.CharField(source='plan.provider.name', read_only=True)
    coverage_percentage = serializers.DecimalField(
        source='plan.coverage_percentage', read_only=True,
        max_digits=5, decimal_places=2
    )

    class Meta:
        model = PatientInsurance
        fields = [
            'id', 'patient', 'patient_name', 'patient_mrn',
            'plan', 'plan_name', 'provider_name', 'coverage_percentage',
            'policy_number', 'valid_from', 'valid_until', 'is_active', 'is_valid'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return None


# =============================================================================
# BILLING RULES SERIALIZERS
# =============================================================================

class BillingRuleListSerializer(serializers.ModelSerializer):
    """
    Lightweight serializer for billing rule lists.
    """
    facility_name = serializers.CharField(source='facility.name', read_only=True, default='Global')
    facility_code = serializers.CharField(source='facility.code', read_only=True, default=None)

    class Meta:
        model = BillingRule
        fields = [
            'id', 'code', 'name', 'rule_type', 'adjustment_type',
            'adjustment_value', 'priority', 'is_stackable', 'is_active',
            'facility', 'facility_name', 'facility_code',
            'effective_from', 'effective_until'
        ]


class BillingRuleSerializer(serializers.ModelSerializer):
    """
    Full serializer for billing rule details.
    """
    facility_name = serializers.CharField(source='facility.name', read_only=True, default='Global')
    is_currently_effective = serializers.ReadOnlyField()

    class Meta:
        model = BillingRule
        fields = [
            'id', 'code', 'name', 'description', 'rule_type', 'parameters',
            'adjustment_type', 'adjustment_value', 'priority', 'is_stackable',
            'applies_to_insurance', 'applies_to_self_pay',
            'facility', 'facility_name',
            'effective_from', 'effective_until', 'is_active',
            'is_currently_effective',
            'created_at', 'updated_at', 'created_by', 'updated_by'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class FacilityBillingSettingsSerializer(serializers.ModelSerializer):
    """
    Serializer for facility billing settings.
    """
    facility_name = serializers.CharField(source='facility.name', read_only=True)
    currency = serializers.ReadOnlyField()

    class Meta:
        model = FacilityBillingSettings
        fields = [
            'id', 'facility', 'facility_name',
            'invoice_prefix', 'invoice_number_length', 'invoice_due_days',
            'invoice_footer_text',
            'default_tax_rate', 'tax_inclusive_pricing', 'tax_registration_number',
            'accepted_payment_methods', 'default_payment_method',
            'auto_generate_invoice_on_encounter_complete',
            'auto_generate_invoice_on_discharge',
            'default_consultation_service',
            'ward_stay_service',
            'lab_charge_trigger',
            'require_deposit_for_admission',
            'minimum_deposit_amount', 'minimum_deposit_percentage',
            'regular_hours_start', 'regular_hours_end',
            'weekend_hours_start', 'weekend_hours_end',
            'holidays', 'currency', 'decimal_places', 'rounding_method',
            'cash_control_enabled', 'cash_variance_threshold_amount',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


# =============================================================================
# CASH CONTROL SERIALIZERS
# =============================================================================

class CashDrawerSerializer(serializers.ModelSerializer):
    class Meta:
        model = CashDrawer
        fields = [
            'id', 'facility', 'code', 'name', 'location', 'is_active',
            'created_at', 'updated_at', 'created_by', 'updated_by'
        ]
        read_only_fields = ['id', 'facility', 'created_at', 'updated_at', 'created_by', 'updated_by']


class CashMovementSerializer(serializers.ModelSerializer):
    class Meta:
        model = CashMovement
        fields = [
            'id', 'session', 'direction', 'movement_type', 'amount',
            'reference', 'notes', 'created_at', 'created_by'
        ]
        read_only_fields = ['id', 'created_at', 'created_by']


class CashSessionSerializer(serializers.ModelSerializer):
    opened_by_name = serializers.SerializerMethodField()
    closed_by_name = serializers.SerializerMethodField()
    drawer_code = serializers.CharField(source='drawer.code', read_only=True, default=None)
    drawer_name = serializers.CharField(source='drawer.name', read_only=True, default=None)

    class Meta:
        model = CashSession
        fields = [
            'id', 'facility', 'drawer', 'drawer_code', 'drawer_name',
            'status',
            'opened_by', 'opened_by_name', 'opened_at', 'opening_float_amount',
            'closed_by', 'closed_by_name', 'closed_at',
            'expected_totals', 'expected_cash_amount',
            'counted_cash_amount', 'variance_cash_amount',
            'is_flagged',
            'reviewed_by', 'reviewed_at', 'review_notes',
            'notes',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'facility', 'status',
            'opened_by', 'opened_at',
            'closed_by', 'closed_at',
            'expected_totals', 'expected_cash_amount',
            'variance_cash_amount', 'is_flagged',
            'reviewed_by', 'reviewed_at',
            'created_at', 'updated_at'
        ]

    def get_opened_by_name(self, obj):
        if obj.opened_by:
            return obj.opened_by.get_full_name()
        return None

    def get_closed_by_name(self, obj):
        if obj.closed_by:
            return obj.closed_by.get_full_name()
        return None


# =============================================================================
# DASHBOARD METRICS SERIALIZERS
# =============================================================================

class BillingDashboardMetricsSerializer(serializers.Serializer):
    """
    Serializer for billing dashboard metrics.
    """
    # Revenue metrics
    revenue_today = serializers.DecimalField(max_digits=12, decimal_places=2)
    revenue_this_week = serializers.DecimalField(max_digits=12, decimal_places=2)
    revenue_this_month = serializers.DecimalField(max_digits=12, decimal_places=2)
    revenue_trend = serializers.DecimalField(max_digits=5, decimal_places=2)  # % change

    # Invoice metrics
    total_invoices = serializers.IntegerField()
    pending_invoices = serializers.IntegerField()
    overdue_invoices = serializers.IntegerField()
    paid_invoices = serializers.IntegerField()

    # Outstanding amounts
    outstanding_amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    outstanding_invoices = serializers.IntegerField()
    total_overdue = serializers.DecimalField(max_digits=12, decimal_places=2)

    # Claims metrics
    pending_claims = serializers.IntegerField()
    pending_claims_amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    approved_claims_amount = serializers.DecimalField(max_digits=12, decimal_places=2)

    # Today's activity
    invoices_created_today = serializers.IntegerField()
    payments_received_today = serializers.IntegerField()

    # Other metrics
    unique_patients_billed = serializers.IntegerField()
    average_invoice_amount = serializers.DecimalField(max_digits=12, decimal_places=2)

    # Payment method breakdown
    payment_methods = serializers.ListField(child=serializers.DictField())


class RecentInvoiceSerializer(serializers.ModelSerializer):
    """
    Minimal serializer for recent invoices on dashboard.
    """
    patient_name = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = [
            'id', 'invoice_number', 'patient_name',
            'total_amount', 'status', 'invoice_date'
        ]

    def get_patient_name(self, obj):
        if obj.patient and obj.patient.user:
            return obj.patient.user.get_full_name()
        return None


class RecentPaymentSerializer(serializers.ModelSerializer):
    """
    Minimal serializer for recent payments on dashboard.
    """
    invoice_number = serializers.CharField(source='invoice.invoice_number', read_only=True)

    class Meta:
        model = Payment
        fields = [
            'id', 'invoice_number', 'amount',
            'payment_method', 'payment_date'
        ]


class ReceiptDetailSerializer(serializers.ModelSerializer):
    """
    Full receipt serializer for printing receipts.
    Includes invoice items to show what was paid for.
    """
    payment_details = PaymentSerializer(source='payment', read_only=True)
    invoice_number = serializers.CharField(source='payment.invoice.invoice_number', read_only=True)
    invoice_date = serializers.DateField(source='payment.invoice.invoice_date', read_only=True)
    patient_name = serializers.SerializerMethodField()
    patient_mrn = serializers.CharField(
        source='payment.invoice.patient.medical_record_number', read_only=True
    )
    facility_name = serializers.SerializerMethodField()
    invoice_items = serializers.SerializerMethodField()
    invoice_subtotal = serializers.DecimalField(
        source='payment.invoice.subtotal', max_digits=10, decimal_places=2, read_only=True
    )
    invoice_tax = serializers.DecimalField(
        source='payment.invoice.tax_amount', max_digits=10, decimal_places=2, read_only=True
    )
    invoice_discount = serializers.DecimalField(
        source='payment.invoice.discount_amount', max_digits=10, decimal_places=2, read_only=True
    )
    invoice_total = serializers.DecimalField(
        source='payment.invoice.total_amount', max_digits=10, decimal_places=2, read_only=True
    )
    invoice_balance_due = serializers.DecimalField(
        source='payment.invoice.balance_due', max_digits=10, decimal_places=2, read_only=True
    )

    class Meta:
        model = Receipt
        fields = [
            'id', 'receipt_number', 'receipt_date', 'notes',
            'payment_details', 'invoice_number', 'invoice_date',
            'patient_name', 'patient_mrn', 'facility_name',
            'invoice_items', 'invoice_subtotal', 'invoice_tax',
            'invoice_discount', 'invoice_total', 'invoice_balance_due',
            'created_at'
        ]

    def get_patient_name(self, obj):
        if obj.payment and obj.payment.invoice and obj.payment.invoice.patient:
            return obj.payment.invoice.patient.user.get_full_name()
        return None

    def get_facility_name(self, obj):
        if obj.payment and obj.payment.invoice and obj.payment.invoice.facility:
            return obj.payment.invoice.facility.name
        return 'Hospital Management System'

    def get_invoice_items(self, obj):
        if obj.payment and obj.payment.invoice:
            items = obj.payment.invoice.items.all().select_related('service')
            return [
                {
                    'service_name': item.service.name if item.service else 'Service',
                    'description': item.description,
                    'quantity': item.quantity,
                    'unit_price': str(item.unit_price),
                    'total_price': str(item.total_price),
                }
                for item in items
            ]
        return []
