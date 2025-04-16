import uuid
from rest_framework import viewsets, permissions, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction
from django.utils import timezone
from django.db.models import Sum, F, Q
from fhir_client.client import fhir_client
from fhir_client.utils import generate_fhir_id, create_reference

from .models import (
    ServiceCategory, Service, InsuranceProvider, InsurancePlan,
    PatientInsurance, Invoice, InvoiceItem, Payment, Claim, Receipt
)
from .serializers import (
    ServiceCategorySerializer, ServiceSerializer, InsuranceProviderSerializer,
    InsurancePlanSerializer, PatientInsuranceSerializer, InvoiceSerializer,
    InvoiceItemSerializer, PaymentSerializer, ClaimSerializer, ReceiptSerializer,
    InvoiceCreateUpdateSerializer
)
from users.permissions import IsAdminOrOwner


class ServiceCategoryViewSet(viewsets.ModelViewSet):
    """
    API endpoint for service categories.
    """
    queryset = ServiceCategory.objects.all()
    serializer_class = ServiceCategorySerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class ServiceViewSet(viewsets.ModelViewSet):
    """
    API endpoint for services.
    """
    queryset = Service.objects.all()
    serializer_class = ServiceSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'description', 'code', 'category__name']
    ordering_fields = ['name', 'base_price', 'category__name', 'created_at']
    ordering = ['category__name', 'name']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['get'])
    def by_category(self, request):
        """
        Get services grouped by category.
        """
        categories = ServiceCategory.objects.filter(is_active=True)
        result = []

        for category in categories:
            services = self.get_queryset().filter(category=category, is_active=True)
            if services.exists():
                result.append({
                    'category': ServiceCategorySerializer(category).data,
                    'services': ServiceSerializer(services, many=True).data
                })

        return Response(result)


class InsuranceProviderViewSet(viewsets.ModelViewSet):
    """
    API endpoint for insurance providers.
    """
    queryset = InsuranceProvider.objects.all()
    serializer_class = InsuranceProviderSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'code', 'contact_person', 'email', 'phone']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['get'])
    def plans(self, request, pk=None):
        """
        Get all plans for an insurance provider.
        """
        provider = self.get_object()
        plans = provider.plans.all()

        # Filter by active status if requested
        active_only = request.query_params.get('active_only', 'false').lower() == 'true'
        if active_only:
            plans = plans.filter(is_active=True)

        serializer = InsurancePlanSerializer(plans, many=True)
        return Response(serializer.data)


class InsurancePlanViewSet(viewsets.ModelViewSet):
    """
    API endpoint for insurance plans.
    """
    queryset = InsurancePlan.objects.all()
    serializer_class = InsurancePlanSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'code', 'description', 'provider__name']
    ordering_fields = ['name', 'provider__name', 'coverage_percentage', 'created_at']
    ordering = ['provider__name', 'name']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class PatientInsuranceViewSet(viewsets.ModelViewSet):
    """
    API endpoint for patient insurance.
    """
    queryset = PatientInsurance.objects.all()
    serializer_class = PatientInsuranceSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['patient__user__first_name', 'patient__user__last_name', 'policy_number', 'plan__name', 'plan__provider__name']
    ordering_fields = ['valid_from', 'valid_until', 'created_at']
    ordering = ['-valid_from']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['get'])
    def for_patient(self, request):
        """
        Get insurance for a specific patient.
        """
        patient_id = request.query_params.get('patient_id', None)
        if not patient_id:
            return Response(
                {"error": "patient_id parameter is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        insurances = self.get_queryset().filter(patient_id=patient_id)

        # Filter by active status if requested
        active_only = request.query_params.get('active_only', 'false').lower() == 'true'
        if active_only:
            insurances = insurances.filter(is_active=True)
            # Also filter by validity date
            today = timezone.now().date()
            insurances = insurances.filter(
                valid_from__lte=today
            ).filter(
                Q(valid_until__isnull=True) | Q(valid_until__gte=today)
            )

        serializer = self.get_serializer(insurances, many=True)
        return Response(serializer.data)


class InvoiceViewSet(viewsets.ModelViewSet):
    """
    API endpoint for invoices.
    """
    queryset = Invoice.objects.all()
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['invoice_number', 'patient__user__first_name', 'patient__user__last_name', 'status']
    ordering_fields = ['invoice_date', 'due_date', 'total_amount', 'status', 'created_at']
    ordering = ['-invoice_date']

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return InvoiceCreateUpdateSerializer
        return InvoiceSerializer

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=False, methods=['get'])
    def for_patient(self, request):
        """
        Get invoices for a specific patient.
        """
        patient_id = request.query_params.get('patient_id', None)
        if not patient_id:
            return Response(
                {"error": "patient_id parameter is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        invoices = self.get_queryset().filter(patient_id=patient_id)

        # Filter by status if requested
        status_filter = request.query_params.get('status', None)
        if status_filter:
            invoices = invoices.filter(status=status_filter)

        serializer = InvoiceSerializer(invoices, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def generate_claim(self, request, pk=None):
        """
        Generate an insurance claim for an invoice.
        """
        invoice = self.get_object()

        # Check if invoice has insurance
        if not invoice.patient_insurance or invoice.insurance_amount <= 0:
            return Response(
                {"error": "Invoice has no valid insurance or insurance amount is zero."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check if claim already exists
        if hasattr(invoice, 'claim'):
            return Response(
                {"error": "Claim already exists for this invoice."},
                status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():
            # Generate claim number
            claim_number = f"CLM-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"

            # Create FHIR Claim resource if FHIR integration is enabled
            fhir_claim_id = None
            if invoice.patient.fhir_patient_id:
                try:
                    # Create FHIR Claim
                    claim_data = {
                        "resourceType": "Claim",
                        "id": generate_fhir_id(),
                        "status": "active",
                        "type": {
                            "coding": [
                                {
                                    "system": "http://terminology.hl7.org/CodeSystem/claim-type",
                                    "code": "professional",
                                    "display": "Professional"
                                }
                            ]
                        },
                        "use": "claim",
                        "patient": create_reference("Patient", invoice.patient.fhir_patient_id),
                        "created": invoice.invoice_date.isoformat(),
                        "provider": {
                            "display": "Hospital Management System"
                        },
                        "priority": {
                            "coding": [
                                {
                                    "system": "http://terminology.hl7.org/CodeSystem/processpriority",
                                    "code": "normal"
                                }
                            ]
                        },
                        "insurance": [
                            {
                                "sequence": 1,
                                "focal": True,
                                "coverage": {
                                    "display": f"{invoice.patient_insurance.plan.provider.name} - {invoice.patient_insurance.plan.name}"
                                }
                            }
                        ],
                        "item": []
                    }

                    # Add items
                    for idx, item in enumerate(invoice.items.all()):
                        claim_data["item"].append({
                            "sequence": idx + 1,
                            "productOrService": {
                                "coding": [
                                    {
                                        "system": "http://hospital.example.org/fhir/service",
                                        "code": item.service.code,
                                        "display": item.service.name
                                    }
                                ]
                            },
                            "unitPrice": {
                                "value": float(item.unit_price),
                                "currency": "USD"
                            },
                            "net": {
                                "value": float(item.total_price),
                                "currency": "USD"
                            }
                        })

                    # Create the claim in FHIR
                    fhir_claim = fhir_client.create_resource("Claim", claim_data)
                    fhir_claim_id = fhir_claim["id"]

                except Exception as e:
                    # Log the error but continue (we don't want to roll back the claim creation)
                    print(f"Failed to create FHIR Claim: {str(e)}")

            # Create the claim
            claim = Claim.objects.create(
                claim_number=claim_number,
                invoice=invoice,
                claimed_amount=invoice.insurance_amount,
                fhir_claim_id=fhir_claim_id,
                created_by=request.user,
                updated_by=request.user
            )

            # Update the invoice with the FHIR claim ID
            if fhir_claim_id:
                invoice.fhir_claim_id = fhir_claim_id
                invoice.save()

            return Response(ClaimSerializer(claim).data)

    @action(detail=True, methods=['post'])
    def mark_as_paid(self, request, pk=None):
        """
        Mark an invoice as paid.
        """
        invoice = self.get_object()

        # Check if invoice is already paid
        if invoice.status == 'paid':
            return Response(
                {"error": "Invoice is already marked as paid."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get payment details from request
        payment_method = request.data.get('payment_method', 'cash')
        reference_number = request.data.get('reference_number', '')
        notes = request.data.get('notes', '')

        # If amount is not provided, use the balance due
        amount = request.data.get('amount', None)
        if amount is None:
            amount = invoice.balance_due
        else:
            amount = float(amount)

        with transaction.atomic():
            # Create payment
            payment = Payment.objects.create(
                invoice=invoice,
                amount=amount,
                payment_method=payment_method,
                reference_number=reference_number,
                notes=notes,
                created_by=request.user,
                updated_by=request.user
            )

            # Generate receipt number
            receipt_number = f"RCP-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"

            # Create receipt
            receipt = Receipt.objects.create(
                receipt_number=receipt_number,
                payment=payment,
                created_by=request.user,
                updated_by=request.user
            )

            return Response({
                "message": "Invoice marked as paid.",
                "payment": PaymentSerializer(payment).data,
                "receipt": ReceiptSerializer(receipt).data
            })


class InvoiceItemViewSet(viewsets.ModelViewSet):
    """
    API endpoint for invoice items.
    """
    queryset = InvoiceItem.objects.all()
    serializer_class = InvoiceItemSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['service__name', 'description', 'invoice__invoice_number']
    ordering_fields = ['service__name', 'quantity', 'unit_price', 'created_at']
    ordering = ['service__name']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)


class PaymentViewSet(viewsets.ModelViewSet):
    """
    API endpoint for payments.
    """
    queryset = Payment.objects.all()
    serializer_class = PaymentSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['invoice__invoice_number', 'reference_number', 'payment_method']
    ordering_fields = ['payment_date', 'amount', 'created_at']
    ordering = ['-payment_date']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['post'])
    def generate_receipt(self, request, pk=None):
        """
        Generate a receipt for a payment.
        """
        payment = self.get_object()

        # Check if receipt already exists
        if hasattr(payment, 'receipt'):
            return Response(
                {"error": "Receipt already exists for this payment."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Generate receipt number
        receipt_number = f"RCP-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"

        # Create receipt
        receipt = Receipt.objects.create(
            receipt_number=receipt_number,
            payment=payment,
            created_by=request.user,
            updated_by=request.user
        )

        return Response(ReceiptSerializer(receipt).data)


class ClaimViewSet(viewsets.ModelViewSet):
    """
    API endpoint for claims.
    """
    queryset = Claim.objects.all()
    serializer_class = ClaimSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['claim_number', 'invoice__invoice_number', 'status', 'invoice__patient__user__first_name', 'invoice__patient__user__last_name']
    ordering_fields = ['submission_date', 'status', 'claimed_amount', 'approved_amount', 'created_at']
    ordering = ['-submission_date']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)

    @action(detail=True, methods=['post'])
    def update_status(self, request, pk=None):
        """
        Update the status of a claim.
        """
        claim = self.get_object()

        # Get status from request
        new_status = request.data.get('status', None)
        if not new_status:
            return Response(
                {"error": "status parameter is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validate status
        valid_statuses = [status for status, _ in Claim.STATUS_CHOICES]
        if new_status not in valid_statuses:
            return Response(
                {"error": f"Invalid status. Must be one of: {', '.join(valid_statuses)}"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Get additional fields
        approved_amount = request.data.get('approved_amount', None)
        rejection_reason = request.data.get('rejection_reason', None)

        # Update claim
        claim.status = new_status
        claim.response_date = timezone.now().date()

        if approved_amount is not None:
            claim.approved_amount = float(approved_amount)

        if rejection_reason is not None:
            claim.rejection_reason = rejection_reason

        claim.updated_by = request.user
        claim.save()

        # If claim is approved or partially approved, create a payment from insurance
        if new_status in ['approved', 'partially_approved'] and claim.approved_amount > 0:
            # Create payment
            payment = Payment.objects.create(
                invoice=claim.invoice,
                amount=claim.approved_amount,
                payment_method='insurance',
                reference_number=f"INS-{claim.claim_number}",
                notes=f"Insurance payment for claim {claim.claim_number}",
                created_by=request.user,
                updated_by=request.user
            )

            # Generate receipt number
            receipt_number = f"RCP-{timezone.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"

            # Create receipt
            Receipt.objects.create(
                receipt_number=receipt_number,
                payment=payment,
                created_by=request.user,
                updated_by=request.user
            )

        return Response(ClaimSerializer(claim).data)


class ReceiptViewSet(viewsets.ModelViewSet):
    """
    API endpoint for receipts.
    """
    queryset = Receipt.objects.all()
    serializer_class = ReceiptSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrOwner]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['receipt_number', 'payment__invoice__invoice_number', 'payment__reference_number']
    ordering_fields = ['receipt_date', 'created_at']
    ordering = ['-receipt_date']

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        serializer.save(updated_by=self.request.user)
