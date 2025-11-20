from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import WorkflowViewSet, ConsultationWorkflowViewSet, WorkflowTemplateViewSet

router = DefaultRouter()
router.register(r'workflows', WorkflowViewSet, basename='workflow')
router.register(r'consultation-workflows', ConsultationWorkflowViewSet, basename='consultation-workflow')
router.register(r'workflow-templates', WorkflowTemplateViewSet, basename='workflow-template')

urlpatterns = [
    path('', include(router.urls)),
]
