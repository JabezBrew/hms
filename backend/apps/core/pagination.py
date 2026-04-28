"""
Shared pagination classes for the HMS application.

All viewsets that return lists should use these pagination classes
to ensure consistent pagination behavior and prevent unbounded queries.
"""
from urllib.parse import urlencode

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


class PatientSearchPagination(PageNumberPagination):
    """
    Page-number pagination optimized for patient search.

    By default this avoids a full queryset `COUNT(*)` and instead uses
    next/previous links with an optional exact total when explicitly requested.
    """

    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100
    page_query_param = 'page'

    def paginate_queryset(self, queryset, request, view=None):
        self.request = request
        self.page_size_value = self.get_page_size(request) or self.page_size
        try:
            page_number = int(request.query_params.get(self.page_query_param, 1))
        except (TypeError, ValueError):
            page_number = 1
        self.page_number = max(1, page_number)
        self.offset = (self.page_number - 1) * self.page_size_value
        self.include_total = str(
            request.query_params.get('include_total', 'false')
        ).strip().lower() in {'1', 'true', 'yes', 'on'}

        batch = list(queryset[self.offset:self.offset + self.page_size_value + 1])
        self.has_next = len(batch) > self.page_size_value
        self.has_previous = self.page_number > 1
        self.page_items = batch[:self.page_size_value]

        if self.include_total:
            self.total_count = queryset.count()
            self.total_is_exact = True
        elif not self.has_next:
            self.total_count = self.offset + len(self.page_items)
            self.total_is_exact = True
        else:
            self.total_count = None
            self.total_is_exact = False

        return self.page_items

    def _replace_page(self, page_number: int):
        url = self.request.build_absolute_uri()
        query_dict = self.request.query_params.copy()
        query_dict[self.page_query_param] = str(page_number)
        separator = '&' if '?' in url else '?'
        base_url = url.split('?', 1)[0]
        return f"{base_url}{separator}{urlencode(list(query_dict.lists()), doseq=True)}"

    def get_next_link(self):
        if not getattr(self, 'has_next', False):
            return None
        return self._replace_page(self.page_number + 1)

    def get_previous_link(self):
        if not getattr(self, 'has_previous', False):
            return None
        return self._replace_page(self.page_number - 1)
