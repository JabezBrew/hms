"""
Shared pagination classes for the HMS application.

All viewsets that return lists should use these pagination classes
to ensure consistent pagination behavior and prevent unbounded queries.
"""
from rest_framework.pagination import PageNumberPagination


class StandardResultsSetPagination(PageNumberPagination):
    """
    Standard pagination for most list endpoints.

    Defaults:
        - page_size: 100 items per page
        - max_page_size: 1000 items (to prevent abuse)

    Usage:
        class MyViewSet(viewsets.ModelViewSet):
            pagination_class = StandardResultsSetPagination
    """
    page_size = 100
    page_size_query_param = 'page_size'
    max_page_size = 1000


class SmallResultsSetPagination(PageNumberPagination):
    """
    Pagination for endpoints with expensive serialization or large payloads.

    Defaults:
        - page_size: 20 items per page
        - max_page_size: 100 items

    Use for: Patient monitoring, detailed clinical data, etc.
    """
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


class LargeResultsSetPagination(PageNumberPagination):
    """
    Pagination for catalog/lookup endpoints with lightweight payloads.

    Defaults:
        - page_size: 200 items per page
        - max_page_size: 2000 items

    Use for: Lab test catalogs, medication lists, etc.
    """
    page_size = 200
    page_size_query_param = 'page_size'
    max_page_size = 2000
