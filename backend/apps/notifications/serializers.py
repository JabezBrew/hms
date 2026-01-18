from rest_framework import serializers

from .models import InboxItem


class InboxItemListSerializer(serializers.ModelSerializer):
    class Meta:
        model = InboxItem
        fields = [
            'id',
            'source_type',
            'source_id',
            'title',
            'summary',
            'action_url',
            'priority',
            'status',
            'is_action_required',
            'is_read',
            'occurred_at',
        ]
        read_only_fields = ['__all__']
