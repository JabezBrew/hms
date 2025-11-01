from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import NoteTemplateViewSet, NoteEntryViewSet

router = DefaultRouter()
router.register(r'templates', NoteTemplateViewSet)
router.register(r'entries', NoteEntryViewSet)

urlpatterns = [
    path('', include(router.urls)),
]