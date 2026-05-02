from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ProblemCodeViewSet, ProblemLinkViewSet, ProblemViewSet

router = DefaultRouter()
router.register(r'codes', ProblemCodeViewSet, basename='problem-code')
router.register(r'links', ProblemLinkViewSet, basename='problem-link')
router.register(r'', ProblemViewSet, basename='problem')

urlpatterns = [
    path('', include(router.urls)),
]
