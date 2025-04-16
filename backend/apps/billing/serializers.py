from rest_framework import serializers
from .models import (
    ServiceCategory, Service, InsuranceProvider, InsurancePlan,
    PatientInsurance, Invoice, InvoiceItem, Payment, Claim, Receipt
)
from ..users.serializers import PatientProfileSerializer, UserSerializer


class ServiceCategorySerializer(serializers.ModelSerializer):
    """
    Serializer for the ServiceCategory model.
    """
    class Meta:
        model = ServiceCategory
        fields = ['id', 'name', 'description', 'is_active',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class ServiceSerializer(serializers.ModelSerializer):
    """
    Serializer for the Service model.
    """
    category_name = serializers.ReadOnlyField(source='category.name')
    total_price = serializers.ReadOnlyField()
    
    class Meta:
        model = Service
        fields = ['id', 'name', 'description', 'category', 'category_name',
                  'code', 'base_price', 'tax_rate', 'is_active', 'total_price',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class InsuranceProviderSerializer(serializers.ModelSerializer):
    """
    Serializer for the InsuranceProvider model.
    """
    class Meta:
        model = InsuranceProvider
        fields = ['id', 'name', 'code', 'contact_person', 'email', 'phone',
                  'address', 'is_active', 'created_at', 'updated_at',
                  'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


class InsurancePlanSerializer(serializers.ModelSerializer):
    """
    Serializer for the InsurancePlan model.
    """
    provider_name = serializers.ReadOnlyField(source='provider.name')
    
    class Meta:
        model = InsurancePlan
        fields = ['id', 'provider', 'provider_name', 'name', 'code',
                  'description', 'coverage_percentage', 'annual_limit',
                  'is_active', 'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


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


class PaymentSerializer(serializers.ModelSerializer):
    """
    Serializer for the Payment model.
    """
    created_by_details = UserSerializer(source='created_by', read_only=True)
    
    class Meta:
        model = Payment
        fields = ['id', 'invoice', 'payment_date', 'amount', 'payment_method',
                  'reference_number', 'notes', 'created_at', 'updated_at',
                  'created_by', 'created_by_details', 'updated_by']
        read_only_fields = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by']


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
                  'submission_date', 'fhir_claim_id', 'fhir_explanation_of_benefit_id',
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
    
    class Meta:
        model = Invoice
        fields = ['id', 'invoice_number', 'patient', 'patient_details',
                  'invoice_date', 'due_date', 'admission', 'appointment_type',
                  'fhir_encounter_id', 'fhir_claim_id', 'subtotal', 'tax_amount',
                  'discount_amount', 'total_amount', 'patient_insurance',
                  'patient_insurance_details', 'insurance_amount',
                  'patient_responsibility', 'status', 'notes', 'items', 'payments',
                  'amount_paid', 'balance_due', 'is_fully_paid',
                  'created_at', 'updated_at', 'created_by', 'updated_by']
        read_only_fields = ['id', 'subtotal', 'tax_amount', 'total_amount',
                           'insurance_amount', 'patient_responsibility',
                           'created_at', 'updated_at', 'created_by', 'updated_by']


class InvoiceCreateUpdateSerializer(serializers.ModelSerializer):
    """
    Serializer for creating and updating Invoice with nested items.
    """
    items = InvoiceItemSerializer(many=True)
    
    class Meta:
        model = Invoice
        fields = ['id', 'invoice_number', 'patient', 'invoice_date', 'due_date',
                  'admission', 'appointment_type', 'fhir_encounter_id',
                  'fhir_claim_id', 'discount_amount', 'patient_insurance',
                  'status', 'notes', 'items']
        read_only_fields = ['id']
    
    def create(self, validated_data):
        items_data = validated_data.pop('items')
        invoice = Invoice.objects.create(**validated_data)
        
        for item_data in items_data:
            InvoiceItem.objects.create(
                invoice=invoice,
                created_by=validated_data.get('created_by'),
                updated_by=validated_data.get('updated_by'),
                **item_data
            )
        
        # Calculate totals
        invoice.calculate_totals()
        invoice.save()
        
        return invoice
    
    def update(self, instance, validated_data):
        items_data = validated_data.pop('items', None)
        
        # Update invoice fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        
        if items_data is not None:
            # Delete existing items
            instance.items.all().delete()
            
            # Create new items
            for item_data in items_data:
                InvoiceItem.objects.create(
                    invoice=instance,
                    created_by=validated_data.get('updated_by'),
                    updated_by=validated_data.get('updated_by'),
                    **item_data
                )
        
        # Calculate totals
        instance.calculate_totals()
        instance.save()
        
        return instance