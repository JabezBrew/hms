from rest_framework.routers import DefaultRouter

from .views import RecordExportViewSet

router = DefaultRouter()
router.register(r'exports', RecordExportViewSet, basename='record-export')

urlpatterns = router.urls
