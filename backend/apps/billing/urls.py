from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ServiceCategoryViewSet, ServiceViewSet, InsuranceProviderViewSet,
    InsurancePlanViewSet, PatientInsuranceViewSet, InvoiceViewSet,
    InvoiceItemViewSet, PaymentViewSet, ClaimViewSet, ReceiptViewSet
)

router = DefaultRouter()
router.register(r'service-categories', ServiceCategoryViewSet)
router.register(r'services', ServiceViewSet)
router.register(r'insurance-providers', InsuranceProviderViewSet)
router.register(r'insurance-plans', InsurancePlanViewSet)
router.register(r'patient-insurances', PatientInsuranceViewSet)
router.register(r'invoices', InvoiceViewSet)
router.register(r'invoice-items', InvoiceItemViewSet)
router.register(r'payments', PaymentViewSet)
router.register(r'claims', ClaimViewSet)
router.register(r'receipts', ReceiptViewSet)

urlpatterns = [
    path('', include(router.urls)),
]