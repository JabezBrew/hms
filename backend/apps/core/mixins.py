"""
Reusable mixins for ViewSets implementing list/detail serializer pattern.

Example usage:
    from apps.core.mixins import ListDetailSerializerMixin

    class MyViewSet(ListDetailSerializerMixin, viewsets.ModelViewSet):
        serializer_class = MyDetailSerializer
        list_serializer_class = MyListSerializer
"""


class ListDetailSerializerMixin:
    """
    Mixin that switches between list and detail serializers automatically.

    Attributes:
        serializer_class: The default (detail) serializer
        list_serializer_class: The serializer to use for list action

    Usage:
        class MyViewSet(ListDetailSerializerMixin, viewsets.ModelViewSet):
            serializer_class = MyDetailSerializer
            list_serializer_class = MyListSerializer
    """
    list_serializer_class = None

    def get_serializer_class(self):
        if self.action == 'list' and self.list_serializer_class:
            return self.list_serializer_class
        return super().get_serializer_class()


class ActionSerializerMixin:
    """
    Mixin that allows mapping multiple actions to different serializers.

    Attributes:
        serializer_class: The default serializer
        action_serializers: Dict mapping action names to serializer classes

    Usage:
        class MyViewSet(ActionSerializerMixin, viewsets.ModelViewSet):
            serializer_class = MyDetailSerializer
            action_serializers = {
                'list': MyListSerializer,
                'create': MyCreateSerializer,
                'update': MyUpdateSerializer,
            }
    """
    action_serializers = {}

    def get_serializer_class(self):
        if self.action in self.action_serializers:
            return self.action_serializers[self.action]
        return super().get_serializer_class()


class OptimizedQuerysetMixin:
    """
    Mixin that provides optimized querysets for list vs detail actions.

    Reduces database queries by using different select_related/prefetch_related
    configurations for list views (which need fewer relationships) vs detail views.

    Attributes:
        list_select_related: Fields to select_related for list action
        list_prefetch_related: Fields to prefetch_related for list action
        detail_select_related: Fields to select_related for detail actions
        detail_prefetch_related: Fields to prefetch_related for detail actions

    Usage:
        class MyViewSet(OptimizedQuerysetMixin, viewsets.ModelViewSet):
            list_select_related = ['patient__user']
            list_prefetch_related = []
            detail_select_related = ['patient__user', 'created_by']
            detail_prefetch_related = ['items', 'payments', 'notes']
    """
    list_select_related = []
    list_prefetch_related = []
    detail_select_related = []
    detail_prefetch_related = []

    def get_queryset(self):
        queryset = super().get_queryset()

        if self.action == 'list':
            if self.list_select_related:
                queryset = queryset.select_related(*self.list_select_related)
            if self.list_prefetch_related:
                queryset = queryset.prefetch_related(*self.list_prefetch_related)
        else:
            if self.detail_select_related:
                queryset = queryset.select_related(*self.detail_select_related)
            if self.detail_prefetch_related:
                queryset = queryset.prefetch_related(*self.detail_prefetch_related)

        return queryset
